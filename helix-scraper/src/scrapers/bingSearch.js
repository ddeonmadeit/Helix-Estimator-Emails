const cheerio = require('cheerio');
const config = require('../config');
const { fetchWithRetry, randomDelay } = require('../proxyRotator');

function buildQueries(industry, location, round = 1) {
  const sets = [
    // Round 1
    [
      `${industry} ${location} Australia contact email site:.com.au`,
      `${industry} company ${location} .com.au owner`,
      `${industry} contractor ${location} Australia`,
      `${industry} ${location} "contact us" .com.au`
    ],
    // Round 2
    [
      `${industry} ${location} director email .com.au`,
      `"${industry}" "${location}" "get a quote" site:.com.au`,
      `${industry} business ${location} ABN email`,
      `${industry} ${location} reviews email contact`
    ],
    // Round 3
    [
      `${industry} ${location} services "call us" email`,
      `${industry} specialist ${location} Australia site:.com.au`,
      `"${industry} ${location}" owner contact Australia`,
      `${industry} ${location} testimonials site:.com.au`
    ],
    // Round 4
    [
      `licensed ${industry} ${location} email site:.com.au`,
      `${industry} ${location} "years experience" contact`,
      `affordable ${industry} ${location} Australia email`,
      `${industry} ${location} "about us" email director`
    ]
  ];
  return sets[(round - 1) % sets.length];
}


function isJunkDomain(domain) {
  const lower = domain.toLowerCase();
  for (const junk of config.JUNK_DOMAINS) {
    if (lower === junk || lower.endsWith('.' + junk)) return true;
  }
  if (lower.endsWith('.gov.au')) return true;
  return false;
}

function extractDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function searchBing(industry, location, verbose = false, round = 1) {
  const queries = buildQueries(industry, location, round);
  const domains = [];

  for (const query of queries) {
    try {
      await randomDelay(config.SEARCH_DELAY_MIN, config.SEARCH_DELAY_MAX);

      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      const html = await fetchWithRetry(url, {
        delayMin: config.SEARCH_DELAY_MIN,
        delayMax: config.SEARCH_DELAY_MAX,
        sourceKey: 'bing.com',
        referer: 'https://www.bing.com/'
      });

      if (!html || typeof html !== 'string') continue;

      const $ = cheerio.load(html);

      // Bing result links
      $('#b_results .b_algo h2 a, #b_results li h2 a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const domain = extractDomainFromUrl(href);
        if (domain && !isJunkDomain(domain)) {
          if (domain.endsWith('.com.au') || domain.endsWith('.net.au') || domain.endsWith('.org.au')) {
            domains.push({
              website: href,
              domain,
              source: 'bing'
            });
          }
        }
      });

      // Extract URLs from snippets
      $('.b_caption p, .b_snippet').each((_, el) => {
        const text = $(el).text();
        const urlMatches = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9]*\.com\.au/g) || [];
        urlMatches.forEach(u => {
          const clean = u.replace(/^(?:https?:\/\/)?(?:www\.)?/, '');
          if (!isJunkDomain(clean)) {
            domains.push({
              website: 'https://' + clean,
              domain: clean,
              source: 'bing'
            });
          }
        });
      });

      if (verbose) {
        console.log(`  Bing: "${query}" — ${domains.length} domains`);
      }

    } catch (err) {
      if (verbose) console.log(`  Bing Error: "${query}" — ${err.message}`);
    }
  }

  // Deduplicate by domain
  const seen = new Set();
  return domains.filter(d => {
    if (seen.has(d.domain)) return false;
    seen.add(d.domain);
    return true;
  });
}

module.exports = { searchBing, buildQueries };
