#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');

const config = require('./src/config');
const { scrapeYellowPages } = require('./src/scrapers/yellowPages');
const { scrapeTrueLocal } = require('./src/scrapers/trueLocal');
const { scrapeHotfrog } = require('./src/scrapers/hotfrog');
const { searchDuckDuckGo } = require('./src/scrapers/duckSearch');
const { searchBing } = require('./src/scrapers/bingSearch');
const { scrapeSite } = require('./src/siteScraper');
const Deduplicator = require('./src/deduplicator');
const CsvWriter = require('./src/csvWriter');
const { classifyEmail, isFreeDomain } = require('./src/qualityScorer');
const { randomDelay } = require('./src/proxyRotator');

const industries = require('./data/industries.json');
const locations = require('./data/locations.json');

// Error log
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

program
  .option('--target <number>', 'Target number of leads', parseInt)
  .option('--resume', 'Resume from existing CSV')
  .option('--sources <list>', 'Comma-separated sources: yellowpages,truelocal,hotfrog,duckduckgo,bing')
  .option('--industry <name>', 'Target specific industry slug or label')
  .option('--location <name>', 'Target specific location slug or label')
  .option('--verbose', 'Verbose logging')
  .parse(process.argv);

const opts = program.opts();
const TARGET = opts.target || config.TARGET_LEADS;
const VERBOSE = opts.verbose || config.VERBOSE;
const RESUME = opts.resume || false;

const enabledSources = opts.sources
  ? opts.sources.split(',').map(s => s.trim().toLowerCase())
  : ['yellowpages', 'truelocal', 'hotfrog', 'duckduckgo', 'bing'];

function filterIndustries() {
  if (!opts.industry) return industries.categories;
  const q = opts.industry.toLowerCase();
  return industries.categories.filter(c =>
    c.slug.includes(q) || c.label.toLowerCase().includes(q)
  );
}

function filterLocations() {
  if (!opts.location) return locations.locations;
  const q = opts.location.toLowerCase();
  return locations.locations.filter(l =>
    l.slug.includes(q) || l.label.toLowerCase().includes(q)
  );
}

async function main() {
  const startTime = Date.now();

  console.log(chalk.bold.cyan('\n  Helix Lead Scraper'));
  console.log(chalk.gray(`  Target: ${TARGET} leads\n`));

  const dedup = new Deduplicator();
  const csvWriter = new CsvWriter();

  // Resume handling
  if (RESUME) {
    try {
      const existing = await csvWriter.loadExisting(dedup);
      if (existing > 0) {
        console.log(chalk.yellow(`  Resuming — ${existing} existing leads loaded\n`));
      }
    } catch (err) {
      console.log(chalk.yellow(`  Could not load existing CSV: ${err.message}\n`));
    }
  }

  csvWriter.init(RESUME);

  let leadCount = csvWriter.leadCount;
  const companyQueue = []; // { website, companyName, industry, location, source, email }

  const targetIndustries = filterIndustries();
  const targetLocations = filterLocations();

  // ═══════════════════════════════════
  // PHASE 1 — Directory Scraping
  // ═══════════════════════════════════
  console.log(chalk.bold.white('[Phase 1] Scraping directories...\n'));

  const directoryLimit = pLimit(config.DIRECTORY_CONCURRENCY);

  // Phase 1a — Yellow Pages
  if (enabledSources.includes('yellowpages') && leadCount < TARGET) {
    console.log(chalk.yellow('  → Yellow Pages Australia'));
    const ypTasks = [];

    for (const ind of targetIndustries) {
      for (const loc of targetLocations) {
        ypTasks.push(directoryLimit(async () => {
          if (leadCount >= TARGET) return;
          try {
            const companies = await scrapeYellowPages(ind.slug, loc.slug, VERBOSE);
            if (companies.length > 0) {
              console.log(chalk.green(`    ${ind.slug} / ${loc.slug} — ${companies.length} companies`));
            }
            for (const c of companies) {
              if (c.website && dedup.isDomainNew(c.website)) {
                dedup.registerDomain(c.website);
                companyQueue.push({
                  ...c,
                  industry: ind.label,
                  location: loc.label
                });
              }
              // If directory had an email directly
              if (c.email && !dedup.hasEmail(c.email) && !isFreeDomain(c.email)) {
                dedup.addEmail(c.email);
                const emailType = classifyEmail(c.email);
                const lead = {
                  email: c.email,
                  ownerName: '',
                  companyName: c.companyName,
                  website: c.website || '',
                  industry: ind.label,
                  location: loc.label,
                  emailType,
                  qualityScore: emailType === 'personal' ? 3 : 2,
                  source: 'yellowpages'
                };
                csvWriter.writeLead(lead);
                leadCount++;
                if (VERBOSE) {
                  const symbol = emailType === 'personal' ? chalk.green('✓') : chalk.yellow('~');
                  console.log(`    [${leadCount}/${TARGET}] ${symbol} ${c.email} (${c.companyName})`);
                }
              }
            }
          } catch (err) {
            logError(`YP ${ind.slug}/${loc.slug}: ${err.message}`);
          }
        }));
      }
    }

    await Promise.all(ypTasks);
    console.log(chalk.gray(`    Queue: ${companyQueue.length} domains | Leads: ${leadCount}\n`));
  }

  // Phase 1b — TrueLocal
  if (enabledSources.includes('truelocal') && leadCount < TARGET) {
    console.log(chalk.yellow('  → TrueLocal'));
    const tlTasks = [];

    for (const ind of targetIndustries) {
      for (const loc of targetLocations) {
        tlTasks.push(directoryLimit(async () => {
          if (leadCount >= TARGET) return;
          try {
            const companies = await scrapeTrueLocal(ind.slug, loc.slug, VERBOSE);
            if (companies.length > 0) {
              console.log(chalk.green(`    ${ind.slug} / ${loc.slug} — ${companies.length} companies`));
            }
            for (const c of companies) {
              if (c.website && dedup.isDomainNew(c.website)) {
                dedup.registerDomain(c.website);
                companyQueue.push({
                  ...c,
                  industry: ind.label,
                  location: loc.label
                });
              }
              if (c.email && !dedup.hasEmail(c.email) && !isFreeDomain(c.email)) {
                dedup.addEmail(c.email);
                const emailType = classifyEmail(c.email);
                const lead = {
                  email: c.email,
                  ownerName: '',
                  companyName: c.companyName,
                  website: c.website || '',
                  industry: ind.label,
                  location: loc.label,
                  emailType,
                  qualityScore: emailType === 'personal' ? 3 : 2,
                  source: 'truelocal'
                };
                csvWriter.writeLead(lead);
                leadCount++;
              }
            }
          } catch (err) {
            logError(`TL ${ind.slug}/${loc.slug}: ${err.message}`);
          }
        }));
      }
    }

    await Promise.all(tlTasks);
    console.log(chalk.gray(`    Queue: ${companyQueue.length} domains | Leads: ${leadCount}\n`));
  }

  // Phase 1c — Hotfrog
  if (enabledSources.includes('hotfrog') && leadCount < TARGET) {
    console.log(chalk.yellow('  → Hotfrog'));
    const hfTasks = [];

    for (const ind of targetIndustries) {
      for (const loc of targetLocations) {
        hfTasks.push(directoryLimit(async () => {
          if (leadCount >= TARGET) return;
          try {
            const companies = await scrapeHotfrog(ind.slug, loc.slug, VERBOSE);
            if (companies.length > 0) {
              console.log(chalk.green(`    ${ind.slug} / ${loc.slug} — ${companies.length} companies`));
            }
            for (const c of companies) {
              if (c.website && dedup.isDomainNew(c.website)) {
                dedup.registerDomain(c.website);
                companyQueue.push({
                  ...c,
                  industry: ind.label,
                  location: loc.label
                });
              }
              if (c.email && !dedup.hasEmail(c.email) && !isFreeDomain(c.email)) {
                dedup.addEmail(c.email);
                const emailType = classifyEmail(c.email);
                const lead = {
                  email: c.email,
                  ownerName: '',
                  companyName: c.companyName,
                  website: c.website || '',
                  industry: ind.label,
                  location: loc.label,
                  emailType,
                  qualityScore: emailType === 'personal' ? 3 : 2,
                  source: 'hotfrog'
                };
                csvWriter.writeLead(lead);
                leadCount++;
              }
            }
          } catch (err) {
            logError(`HF ${ind.slug}/${loc.slug}: ${err.message}`);
          }
        }));
      }
    }

    await Promise.all(hfTasks);
    console.log(chalk.gray(`    Queue: ${companyQueue.length} domains | Leads: ${leadCount}\n`));
  }

  // ═══════════════════════════════════
  // PHASE 2 — Website Email Extraction
  // ═══════════════════════════════════
  if (companyQueue.length > 0 && leadCount < TARGET) {
    console.log(chalk.bold.white(`\n[Phase 2] Extracting emails from ${companyQueue.length} company websites...\n`));

    const siteLimit = pLimit(config.SITE_CONCURRENCY);
    const siteTasks = companyQueue.map(company =>
      siteLimit(async () => {
        if (leadCount >= TARGET) return;

        try {
          await randomDelay(config.SITE_DELAY_MIN, config.SITE_DELAY_MAX);
          const lead = await scrapeSite(company, VERBOSE);

          if (lead && lead.email && !dedup.hasEmail(lead.email)) {
            dedup.addEmail(lead.email);
            csvWriter.writeLead(lead);
            leadCount++;

            const symbol = lead.emailType === 'personal'
              ? chalk.green('✓')
              : chalk.yellow('~');
            const domain = dedup.extractDomain(lead.website) || lead.website;
            const nameStr = lead.ownerName ? `, ${lead.ownerName}` : '';
            console.log(`  [${leadCount}/${TARGET}] ${symbol} ${domain} → ${lead.email} (${lead.companyName}${nameStr}, Q:${lead.qualityScore}/5)`);
          } else if (VERBOSE) {
            const domain = dedup.extractDomain(company.website) || company.website;
            console.log(`  [${leadCount}/${TARGET}] ${chalk.red('✗')} ${domain} — No email found`);
          }
        } catch (err) {
          logError(`Site ${company.website}: ${err.message}`);
          if (VERBOSE) {
            console.log(`  ${chalk.red('✗')} ${company.website} — ${err.message}`);
          }
        }
      })
    );

    await Promise.all(siteTasks);
    console.log(chalk.gray(`\n    Leads after Phase 2: ${leadCount}\n`));
  }

  // ═══════════════════════════════════
  // PHASE 3 — Supplemental Search
  // ═══════════════════════════════════
  if (leadCount < TARGET) {
    console.log(chalk.bold.white(`\n[Phase 3] Supplemental search scraping (need ${TARGET - leadCount} more)...\n`));

    const searchIndustries = targetIndustries.slice(0, 10); // Limit search scope
    const searchLocations = targetLocations.slice(0, 8);

    for (const ind of searchIndustries) {
      for (const loc of searchLocations) {
        if (leadCount >= TARGET) break;

        const newDomains = [];

        // DuckDuckGo
        if (enabledSources.includes('duckduckgo')) {
          try {
            const ddgResults = await searchDuckDuckGo(ind.label, loc.label, VERBOSE);
            for (const r of ddgResults) {
              if (dedup.isDomainNew(r.website)) {
                dedup.registerDomain(r.website);
                newDomains.push({
                  website: r.website,
                  companyName: '',
                  industry: ind.label,
                  location: loc.label,
                  source: 'duckduckgo'
                });
              }
            }
            if (ddgResults.length > 0 && VERBOSE) {
              console.log(chalk.blue(`  DDG: "${ind.label} ${loc.label}" — ${ddgResults.length} new domains`));
            }
          } catch (err) {
            logError(`DDG ${ind.label}/${loc.label}: ${err.message}`);
          }
        }

        // Bing
        if (enabledSources.includes('bing')) {
          try {
            const bingResults = await searchBing(ind.label, loc.label, VERBOSE);
            for (const r of bingResults) {
              if (dedup.isDomainNew(r.website)) {
                dedup.registerDomain(r.website);
                newDomains.push({
                  website: r.website,
                  companyName: '',
                  industry: ind.label,
                  location: loc.label,
                  source: 'bing'
                });
              }
            }
            if (bingResults.length > 0 && VERBOSE) {
              console.log(chalk.blue(`  Bing: "${ind.label} ${loc.label}" — ${bingResults.length} new domains`));
            }
          } catch (err) {
            logError(`Bing ${ind.label}/${loc.label}: ${err.message}`);
          }
        }

        // Process new domains through Phase 2 pipeline
        if (newDomains.length > 0) {
          const siteLimit = pLimit(config.SITE_CONCURRENCY);
          const siteTasks = newDomains.map(company =>
            siteLimit(async () => {
              if (leadCount >= TARGET) return;
              try {
                await randomDelay(config.SITE_DELAY_MIN, config.SITE_DELAY_MAX);
                const lead = await scrapeSite(company, VERBOSE);
                if (lead && lead.email && !dedup.hasEmail(lead.email)) {
                  dedup.addEmail(lead.email);
                  csvWriter.writeLead(lead);
                  leadCount++;
                  const symbol = lead.emailType === 'personal'
                    ? chalk.green('✓')
                    : chalk.yellow('~');
                  const domain = dedup.extractDomain(lead.website) || lead.website;
                  console.log(`  [${leadCount}/${TARGET}] ${symbol} ${domain} → ${lead.email} (Q:${lead.qualityScore}/5)`);
                }
              } catch (err) {
                logError(`Site ${company.website}: ${err.message}`);
              }
            })
          );
          await Promise.all(siteTasks);
        }
      }
      if (leadCount >= TARGET) break;
    }
  }

  // ═══════════════════════════════════
  // Summary
  // ═══════════════════════════════════
  csvWriter.close();

  const elapsed = Date.now() - startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const timeStr = hours > 0
    ? `${hours}h ${minutes}m`
    : minutes > 0
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;

  console.log(chalk.bold.white('\n' + '═'.repeat(42)));
  console.log(chalk.bold.cyan(`  Helix Leads: ${leadCount}/${TARGET} complete`));
  console.log(chalk.white(`  Domains scraped: ${dedup.domainCount}`));
  console.log(chalk.white(`  Time elapsed: ${timeStr}`));
  console.log(chalk.white(`  Saved to: output/Helix Leads.csv`));
  console.log(chalk.bold.white('═'.repeat(42) + '\n'));

  if (leadCount < TARGET) {
    console.log(chalk.yellow(`  Note: Only ${leadCount} leads found. Try broader industries/locations or re-run with --resume.\n`));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`\nFatal error: ${err.message}`));
  logError(`FATAL: ${err.stack}`);
  process.exit(1);
});
