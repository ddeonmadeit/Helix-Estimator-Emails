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

const industries = require(path.join(config.DATA_DIR, 'industries.json'));
const locations  = require(path.join(config.DATA_DIR, 'locations.json'));

const ERROR_LOG = path.join(config.OUTPUT_DIR, 'errors.log');

function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (!fs.existsSync(config.OUTPUT_DIR)) fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
    fs.appendFileSync(ERROR_LOG, line);
  } catch {}
}

// Abort-aware delay — resolves immediately if pipeline is aborted
function abortableDelay(ms, pipeline) {
  return new Promise(resolve => {
    const end = Date.now() + ms;
    const tick = setInterval(() => {
      if (pipeline.aborted || Date.now() >= end) {
        clearInterval(tick);
        resolve();
      }
    }, 150);
  });
}

class ScraperPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.target          = options.target  || config.TARGET_LEADS;
    this.resume          = options.resume  || false;
    this.enabledSources  = options.sources || ['yellowpages', 'truelocal', 'hotfrog', 'duckduckgo', 'bing'];
    this.industryFilter  = options.industry || null;
    this.locationFilter  = options.location || null;
    this.verbose         = options.verbose  || false;

    this.leadCount      = 0;
    this.domainsScraped = 0;
    this.personalCount  = 0;
    this.genericCount   = 0;
    this.phase          = 'idle';
    this.running        = false;
    this.aborted        = false;
    this.startTime      = null;
    this.recentLeads    = [];
  }

  getIndustries() {
    if (!this.industryFilter) return industries.categories;
    const q = this.industryFilter.toLowerCase();
    return industries.categories.filter(c => c.slug.includes(q) || c.label.toLowerCase().includes(q));
  }

  getLocations() {
    if (!this.locationFilter) return locations.locations;
    const q = this.locationFilter.toLowerCase();
    return locations.locations.filter(l => l.slug.includes(q) || l.label.toLowerCase().includes(q));
  }

  getStatus() {
    const elapsed = this.startTime ? Date.now() - this.startTime : 0;
    return {
      running: this.running, phase: this.phase,
      leadCount: this.leadCount, target: this.target,
      domainsScraped: this.domainsScraped,
      personalCount: this.personalCount, genericCount: this.genericCount,
      elapsed, recentLeads: this.recentLeads.slice(-20)
    };
  }

  abort() {
    this.aborted = true;
    this.emit('log', { type: 'warn', message: 'Stop requested — wrapping up current tasks...' });
  }

  // ─── internal helpers ───────────────────────────────────────────
  _tryAddLead(lead, dedup, csvWriter) {
    if (this.leadCount >= this.target) return false;
    if (this.aborted) return false;
    if (!lead || !lead.email) return false;
    if (dedup.hasEmail(lead.email)) return false;

    dedup.addEmail(lead.email);
    csvWriter.writeLead(lead);
    this.leadCount++;
    if (lead.emailType === 'personal') this.personalCount++;
    else this.genericCount++;

    const entry = {
      email: lead.email, ownerName: lead.ownerName || '',
      companyName: lead.companyName || '', website: lead.website || '',
      industry: lead.industry || '', location: lead.location || '',
      emailType: lead.emailType, qualityScore: lead.qualityScore, source: lead.source
    };
    this.recentLeads.push(entry);
    if (this.recentLeads.length > 50) this.recentLeads.shift();
    this.emit('lead', entry);
    this.emit('progress', this.getStatus());
    return true;
  }

  _buildDirectoryLead(company, email, industryLabel, locationLabel, source) {
    const emailType = classifyEmail(email);
    return {
      email, ownerName: '', companyName: company.companyName || '',
      website: company.website || '', industry: industryLabel,
      location: locationLabel, emailType,
      qualityScore: emailType === 'personal' ? 3 : 2, source
    };
  }

  // Scrape a batch of company websites concurrently
  async _scrapeWebsites(companies, dedup, csvWriter) {
    const limit = pLimit(config.SITE_CONCURRENCY);
    const tasks = companies.map(company => limit(async () => {
      if (this.leadCount >= this.target || this.aborted) return;
      try {
        await abortableDelay(
          config.SITE_DELAY_MIN + Math.random() * (config.SITE_DELAY_MAX - config.SITE_DELAY_MIN),
          this
        );
        if (this.aborted) return;
        const lead = await scrapeSite(company, this.verbose);
        this._tryAddLead(lead, dedup, csvWriter);
      } catch (err) {
        logError(`Site ${company.website}: ${err.message}`);
      }
    }));
    await Promise.all(tasks);
    this.domainsScraped = dedup.domainCount;
  }

  // Run a search engine query and return new company domains
  async _searchAndQueue(ind, loc, dedup, round = 1) {
    const newDomains = [];

    const collectResults = (results, source) => {
      for (const r of results) {
        if (dedup.isDomainNew(r.website)) {
          dedup.registerDomain(r.website);
          newDomains.push({ website: r.website, companyName: '', industry: ind.label, location: loc.label, source });
        }
      }
    };

    if (this.enabledSources.includes('duckduckgo') && !this.aborted) {
      try {
        await abortableDelay(
          config.SEARCH_DELAY_MIN + Math.random() * (config.SEARCH_DELAY_MAX - config.SEARCH_DELAY_MIN),
          this
        );
        if (!this.aborted) {
          const results = await searchDuckDuckGo(ind.label, loc.label, this.verbose, round);
          collectResults(results, 'duckduckgo');
        }
      } catch (err) { logError(`DDG ${ind.label}/${loc.label}: ${err.message}`); }
    }

    if (this.enabledSources.includes('bing') && !this.aborted) {
      try {
        await abortableDelay(
          config.SEARCH_DELAY_MIN + Math.random() * (config.SEARCH_DELAY_MAX - config.SEARCH_DELAY_MIN),
          this
        );
        if (!this.aborted) {
          const results = await searchBing(ind.label, loc.label, this.verbose, round);
          collectResults(results, 'bing');
        }
      } catch (err) { logError(`Bing ${ind.label}/${loc.label}: ${err.message}`); }
    }

    return newDomains;
  }

  // ─── main run ───────────────────────────────────────────────────
  async run() {
    if (this.running) throw new Error('Pipeline is already running');
    this.running = true;
    this.aborted = false;
    this.startTime = Date.now();
    this.phase = 'init';

    const dedup     = new Deduplicator();
    const csvWriter = new CsvWriter();

    try {
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

      const companyQueue    = [];
      const targetIndustries = this.getIndustries();
      const targetLocations  = this.getLocations();

      // ═══ PHASE 1 — Directories ══════════════════════════════════
      this.phase = 'phase1';
      this.emit('log', { type: 'phase', message: 'Phase 1 — Scraping directories' });
      this.emit('progress', this.getStatus());

      const dirLimit = pLimit(config.DIRECTORY_CONCURRENCY);
      const scraperMap = {
        yellowpages: { name: 'Yellow Pages', fn: scrapeYellowPages },
        truelocal:   { name: 'TrueLocal',    fn: scrapeTrueLocal   },
        hotfrog:     { name: 'Hotfrog',      fn: scrapeHotfrog     }
      };

      for (const [sourceKey, { name, fn }] of Object.entries(scraperMap)) {
        if (!this.enabledSources.includes(sourceKey) || this.aborted) continue;
        this.emit('log', { type: 'info', message: `Scraping ${name}...` });

        const tasks = [];
        for (const ind of targetIndustries) {
          for (const loc of targetLocations) {
            tasks.push(dirLimit(async () => {
              if (this.aborted) return;
              try {
                const companies = await fn(ind.slug, loc.slug, this.verbose);
                if (companies.length > 0) {
                  this.emit('log', { type: 'success', message: `${name}: ${ind.label}/${loc.label} — ${companies.length} found` });
                }
                for (const c of companies) {
                  if (this.aborted) break;
                  if (c.website && dedup.isDomainNew(c.website)) {
                    dedup.registerDomain(c.website);
                    companyQueue.push({ ...c, industry: ind.label, location: loc.label });
                  }
                  if (c.email && !isFreeDomain(c.email)) {
                    const lead = this._buildDirectoryLead(c, c.email, ind.label, loc.label, sourceKey);
                    this._tryAddLead(lead, dedup, csvWriter);
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

      this.emit('log', { type: 'info', message: `Phase 1 done — ${companyQueue.length} sites queued, ${this.leadCount} leads` });

      // ═══ PHASE 2 — Website email extraction ═════════════════════
      if (companyQueue.length > 0 && !this.done() && !this.aborted) {
        this.phase = 'phase2';
        this.emit('log', { type: 'phase', message: `Phase 2 — Extracting emails from ${companyQueue.length} websites` });
        this.emit('progress', this.getStatus());
        await this._scrapeWebsites(companyQueue, dedup, csvWriter);
        this.emit('log', { type: 'info', message: `Phase 2 done — ${this.leadCount} leads` });
        this.emit('progress', this.getStatus());
      }

      // ═══ PHASE 3+ — Search engine loop (runs until target hit) ══
      if (!this.done() && !this.aborted) {
        this.phase = 'phase3';
        const need = () => this.target - this.leadCount;
        let round = 1;

        // Shuffle industries & locations so different combos get priority each round
        const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

        while (!this.done() && !this.aborted && round <= 4) {
          this.emit('log', { type: 'phase', message: `Phase 3 (round ${round}) — Search engines, need ${need()} more leads` });
          this.emit('progress', this.getStatus());

          const indList = shuffle(targetIndustries);
          const locList = shuffle(targetLocations);

          for (const ind of indList) {
            if (this.done() || this.aborted) break;
            for (const loc of locList) {
              if (this.done() || this.aborted) break;

              const newDomains = await this._searchAndQueue(ind, loc, dedup, round);

              if (newDomains.length > 0) {
                this.emit('log', { type: 'info', message: `Search: ${ind.label}/${loc.label} — ${newDomains.length} new sites` });
                await this._scrapeWebsites(newDomains, dedup, csvWriter);
              }
            }
          }

          round++;
          if (!this.done() && !this.aborted) {
            this.emit('log', { type: 'warn', message: `Round ${round - 1} done — ${this.leadCount}/${this.target} leads. Starting round ${round}...` });
          }
        }

        this.emit('progress', this.getStatus());
      }

      // Done
      csvWriter.close();
      this.phase   = 'done';
      this.running = false;

      const finalStatus = this.getStatus();
      const hitTarget   = this.leadCount >= this.target;
      this.emit('log', {
        type: hitTarget ? 'phase' : 'warn',
        message: `Complete — ${this.leadCount}/${this.target} leads collected${this.aborted ? ' (stopped early)' : ''}`
      });
      this.emit('done', finalStatus);
      return finalStatus;

    } catch (err) {
      csvWriter.close();
      this.phase   = 'error';
      this.running = false;
      logError(`FATAL: ${err.stack}`);
      this.emit('error', err.message);
      throw err;
    }
  }

  done() {
    return this.leadCount >= this.target;
  }
}

module.exports = {
  ScraperPipeline,
  industries: industries.categories,
  locations:  locations.locations
};
