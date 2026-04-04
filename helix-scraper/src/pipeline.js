const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');
const EventEmitter = require('events');

const config = require('./config');
const { scrapeYellowPages } = require('./scrapers/yellowPages');
const { scrapeTrueLocal } = require('./scrapers/trueLocal');
const { scrapeHotfrog } = require('./scrapers/hotfrog');
const { searchDuckDuckGo } = require('./scrapers/duckSearch');
const { searchBing } = require('./scrapers/bingSearch');
const { scrapeSite } = require('./siteScraper');
const Deduplicator = require('./deduplicator');
const CsvWriter = require('./csvWriter');
const { classifyEmail, isFreeDomain } = require('./qualityScorer');
const { randomDelay } = require('./proxyRotator');

const industries = require(path.join(config.DATA_DIR, 'industries.json'));
const locations = require(path.join(config.DATA_DIR, 'locations.json'));

const ERROR_LOG = path.join(config.OUTPUT_DIR, 'errors.log');

function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (!fs.existsSync(config.OUTPUT_DIR)) {
      fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
    }
    fs.appendFileSync(ERROR_LOG, line);
  } catch {}
}

class ScraperPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.target = options.target || config.TARGET_LEADS;
    this.resume = options.resume || false;
    this.enabledSources = options.sources || ['yellowpages', 'truelocal', 'hotfrog', 'duckduckgo', 'bing'];
    this.industryFilter = options.industry || null;
    this.locationFilter = options.location || null;
    this.verbose = options.verbose || false;

    this.leadCount = 0;
    this.domainsScraped = 0;
    this.personalCount = 0;
    this.genericCount = 0;
    this.phase = 'idle';
    this.running = false;
    this.aborted = false;
    this.startTime = null;
    this.recentLeads = [];
  }

  getIndustries() {
    if (!this.industryFilter) return industries.categories;
    const q = this.industryFilter.toLowerCase();
    return industries.categories.filter(c =>
      c.slug.includes(q) || c.label.toLowerCase().includes(q)
    );
  }

  getLocations() {
    if (!this.locationFilter) return locations.locations;
    const q = this.locationFilter.toLowerCase();
    return locations.locations.filter(l =>
      l.slug.includes(q) || l.label.toLowerCase().includes(q)
    );
  }

  getStatus() {
    const elapsed = this.startTime ? Date.now() - this.startTime : 0;
    return {
      running: this.running,
      phase: this.phase,
      leadCount: this.leadCount,
      target: this.target,
      domainsScraped: this.domainsScraped,
      personalCount: this.personalCount,
      genericCount: this.genericCount,
      elapsed,
      recentLeads: this.recentLeads.slice(-20)
    };
  }

  abort() {
    this.aborted = true;
    this.emit('log', { type: 'warn', message: 'Abort requested — finishing current tasks...' });
  }

  async run() {
    if (this.running) throw new Error('Pipeline is already running');
    this.running = true;
    this.aborted = false;
    this.startTime = Date.now();
    this.phase = 'init';

    const dedup = new Deduplicator();
    const csvWriter = new CsvWriter();

    try {
      // Resume
      if (this.resume) {
        try {
          const existing = await csvWriter.loadExisting(dedup);
          if (existing > 0) {
            this.leadCount = existing;
            this.emit('log', { type: 'info', message: `Resumed — ${existing} existing leads loaded` });
          }
        } catch (err) {
          this.emit('log', { type: 'warn', message: `Could not load existing CSV: ${err.message}` });
        }
      }

      csvWriter.init(this.resume);
      this.leadCount = csvWriter.leadCount;

      const companyQueue = [];
      const targetIndustries = this.getIndustries();
      const targetLocations = this.getLocations();

      const self = this;

      function tryAddLead(lead) {
        if (self.leadCount >= self.target) return false;
        if (self.aborted) return false;
        if (!lead || !lead.email) return false;
        if (dedup.hasEmail(lead.email)) return false;

        dedup.addEmail(lead.email);
        csvWriter.writeLead(lead);
        self.leadCount++;

        if (lead.emailType === 'personal') self.personalCount++;
        else self.genericCount++;

        const entry = {
          email: lead.email,
          ownerName: lead.ownerName || '',
          companyName: lead.companyName || '',
          website: lead.website || '',
          industry: lead.industry || '',
          location: lead.location || '',
          emailType: lead.emailType,
          qualityScore: lead.qualityScore,
          source: lead.source
        };
        self.recentLeads.push(entry);
        if (self.recentLeads.length > 50) self.recentLeads.shift();

        self.emit('lead', entry);
        self.emit('progress', self.getStatus());
        return true;
      }

      function buildDirectoryLead(company, email, industryLabel, locationLabel, source) {
        const emailType = classifyEmail(email);
        return {
          email,
          ownerName: '',
          companyName: company.companyName || '',
          website: company.website || '',
          industry: industryLabel,
          location: locationLabel,
          emailType,
          qualityScore: emailType === 'personal' ? 3 : 2,
          source
        };
      }

      // ═══════════ PHASE 1 ═══════════
      this.phase = 'phase1';
      this.emit('log', { type: 'phase', message: 'Phase 1 — Scraping directories' });
      this.emit('progress', this.getStatus());

      const directoryLimit = pLimit(config.DIRECTORY_CONCURRENCY);

      const scraperMap = {
        yellowpages: { name: 'Yellow Pages', fn: scrapeYellowPages },
        truelocal: { name: 'TrueLocal', fn: scrapeTrueLocal },
        hotfrog: { name: 'Hotfrog', fn: scrapeHotfrog }
      };

      for (const [sourceKey, { name, fn }] of Object.entries(scraperMap)) {
        if (!this.enabledSources.includes(sourceKey) || this.leadCount >= this.target || this.aborted) continue;

        this.emit('log', { type: 'info', message: `Scraping ${name}...` });
        const tasks = [];

        for (const ind of targetIndustries) {
          for (const loc of targetLocations) {
            tasks.push(directoryLimit(async () => {
              if (this.leadCount >= this.target || this.aborted) return;
              try {
                const companies = await fn(ind.slug, loc.slug, this.verbose);
                if (companies.length > 0) {
                  this.emit('log', { type: 'success', message: `${sourceKey}: ${ind.slug}/${loc.slug} — ${companies.length} companies` });
                }
                for (const c of companies) {
                  if (c.website && dedup.isDomainNew(c.website)) {
                    dedup.registerDomain(c.website);
                    companyQueue.push({ ...c, industry: ind.label, location: loc.label });
                  }
                  if (c.email && !isFreeDomain(c.email)) {
                    const lead = buildDirectoryLead(c, c.email, ind.label, loc.label, sourceKey);
                    tryAddLead(lead);
                  }
                }
              } catch (err) {
                logError(`${sourceKey} ${ind.slug}/${loc.slug}: ${err.message}`);
              }
            }));
          }
        }

        await Promise.all(tasks);
        this.domainsScraped = dedup.domainCount;
        this.emit('progress', this.getStatus());
      }

      this.emit('log', { type: 'info', message: `Phase 1 complete — ${companyQueue.length} domains queued, ${this.leadCount} leads so far` });

      // ═══════════ PHASE 2 ═══════════
      if (companyQueue.length > 0 && this.leadCount < this.target && !this.aborted) {
        this.phase = 'phase2';
        this.emit('log', { type: 'phase', message: `Phase 2 — Extracting emails from ${companyQueue.length} websites` });
        this.emit('progress', this.getStatus());

        const siteLimit = pLimit(config.SITE_CONCURRENCY);
        const siteTasks = companyQueue.map(company =>
          siteLimit(async () => {
            if (this.leadCount >= this.target || this.aborted) return;
            try {
              await randomDelay(config.SITE_DELAY_MIN, config.SITE_DELAY_MAX);
              const lead = await scrapeSite(company, this.verbose);
              tryAddLead(lead);
            } catch (err) {
              logError(`Site ${company.website}: ${err.message}`);
            }
          })
        );

        await Promise.all(siteTasks);
        this.domainsScraped = dedup.domainCount;
        this.emit('log', { type: 'info', message: `Phase 2 complete — ${this.leadCount} leads` });
        this.emit('progress', this.getStatus());
      }

      // ═══════════ PHASE 3 ═══════════
      if (this.leadCount < this.target && !this.aborted) {
        this.phase = 'phase3';
        this.emit('log', { type: 'phase', message: `Phase 3 — Supplemental search (need ${this.target - this.leadCount} more)` });
        this.emit('progress', this.getStatus());

        const searchIndustries = targetIndustries.slice(0, 10);
        const searchLocations = targetLocations.slice(0, 8);

        for (const ind of searchIndustries) {
          for (const loc of searchLocations) {
            if (this.leadCount >= this.target || this.aborted) break;

            const newDomains = [];

            if (this.enabledSources.includes('duckduckgo')) {
              try {
                const results = await searchDuckDuckGo(ind.label, loc.label, this.verbose);
                for (const r of results) {
                  if (dedup.isDomainNew(r.website)) {
                    dedup.registerDomain(r.website);
                    newDomains.push({ website: r.website, companyName: '', industry: ind.label, location: loc.label, source: 'duckduckgo' });
                  }
                }
              } catch (err) {
                logError(`DDG ${ind.label}/${loc.label}: ${err.message}`);
              }
            }

            if (this.enabledSources.includes('bing')) {
              try {
                const results = await searchBing(ind.label, loc.label, this.verbose);
                for (const r of results) {
                  if (dedup.isDomainNew(r.website)) {
                    dedup.registerDomain(r.website);
                    newDomains.push({ website: r.website, companyName: '', industry: ind.label, location: loc.label, source: 'bing' });
                  }
                }
              } catch (err) {
                logError(`Bing ${ind.label}/${loc.label}: ${err.message}`);
              }
            }

            if (newDomains.length > 0) {
              this.emit('log', { type: 'info', message: `Search: ${ind.label}/${loc.label} — ${newDomains.length} new domains` });
              const siteLimit = pLimit(config.SITE_CONCURRENCY);
              const siteTasks = newDomains.map(company =>
                siteLimit(async () => {
                  if (this.leadCount >= this.target || this.aborted) return;
                  try {
                    await randomDelay(config.SITE_DELAY_MIN, config.SITE_DELAY_MAX);
                    const lead = await scrapeSite(company, this.verbose);
                    tryAddLead(lead);
                  } catch (err) {
                    logError(`Site ${company.website}: ${err.message}`);
                  }
                })
              );
              await Promise.all(siteTasks);
            }
          }
          if (this.leadCount >= this.target || this.aborted) break;
        }

        this.domainsScraped = dedup.domainCount;
        this.emit('progress', this.getStatus());
      }

      // Done
      csvWriter.close();
      this.phase = 'done';
      this.running = false;

      const finalStatus = this.getStatus();
      this.emit('log', { type: 'phase', message: `Complete — ${this.leadCount}/${this.target} leads collected` });
      this.emit('done', finalStatus);
      return finalStatus;

    } catch (err) {
      csvWriter.close();
      this.phase = 'error';
      this.running = false;
      logError(`FATAL: ${err.stack}`);
      this.emit('error', err.message);
      throw err;
    }
  }
}

// Export both the class and data for the web UI
module.exports = {
  ScraperPipeline,
  industries: industries.categories,
  locations: locations.locations
};
