const cheerio = require('cheerio');
const config = require('../config');
const { fetchWithRetry, randomDelay } = require('../proxyRotator');

function buildQueries(industry, location, round = 1) {
  const sets = [
    // Round 1 — broad contact
    [
      `${industry} ${location} Australia email contact`,
      `${industry} company ${location} "about us" director`,
      `${industry} ${location} site:.com.au contact`,
      `"${industry}" "${location}" email enquiry`
    ],
    // Round 2 — owner/decision-maker focused
    [
      `${industry} ${location} owner director "contact us" site:.com.au`,
      `"${industry}" "${location}" ABN Australia email`,
      `${industry} business ${location} proprietor email`,
      `${industry} ${location} Australia "free quote"`
    ],
    // Round 3 — deeper niche queries
    [
      `${industry} services ${location} Australia email`,
      `small business ${industry} ${location} contact`,
      `${industry} specialist ${location} .com.au`,
      `"${location}" "${industry}" contractor Australia email`
    ],
    // Round 4 — trade-specific
    [
      `${industry} ${location} "call us" OR "email us" site:.com.au`,
      `licensed ${industry} ${location} Australia`,
      `${industry} company ${location} testimonials`,
      `top ${industry} ${location} Australia reviews`
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

async function searchDuckDuckGo(industry, location, verbose = false, round = 1) {
  const queries = buildQueries(industry, location, round);
  const domains = [];

  for (const query of queries) {
    try {
      await randomDelay(config.SEARCH_DELAY_MIN, config.SEARCH_DELAY_MAX);

      // DDG HTML version uses POST
      const html = await fetchWithRetry('https://html.duckduckgo.com/html/', {
        delayMin: config.SEARCH_DELAY_MIN,
        delayMax: config.SEARCH_DELAY_MAX,
        sourceKey: 'duckduckgo.com',
        method: 'POST',
        postData: `q=${encodeURIComponent(query)}`,
        referer: 'https://html.duckduckgo.com/'
      });

      if (!html || typeof html !== 'string') continue;

      const $ = cheerio.load(html);

      // DDG HTML result links
      $('a.result__a').each((_, el) => {
        const href = $(el).attr('href') || '';
        let actualUrl = href;

        // DDG wraps URLs in redirects
        if (href.includes('uddg=')) {
          try {
            const parsed = new URL(href, 'https://duckduckgo.com');
            actualUrl = decodeURIComponent(parsed.searchParams.get('uddg') || href);
          } catch {}
        }

        const domain = extractDomainFromUrl(actualUrl);
        if (domain && !isJunkDomain(domain)) {
          if (domain.endsWith('.com.au') || domain.endsWith('.net.au') || domain.endsWith('.org.au')) {
            domains.push({
              website: actualUrl,
              domain,
              source: 'duckduckgo'
            });
          }
        }
      });

      // Also extract .com.au URLs from result snippets
      $('.result__snippet').each((_, el) => {
        const text = $(el).text();
        const urlMatches = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9]*\.com\.au/g) || [];
        urlMatches.forEach(u => {
          const clean = u.replace(/^(?:https?:\/\/)?(?:www\.)?/, '');
          if (!isJunkDomain(clean)) {
            domains.push({
              website: 'https://' + clean,
              domain: clean,
              source: 'duckduckgo'
            });
          }
        });
      });

      if (verbose) {
        console.log(`  DDG: "${query}" — ${domains.length} domains`);
      }

    } catch (err) {
      if (verbose) console.log(`  DDG Error: "${query}" — ${err.message}`);
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

module.exports = { searchDuckDuckGo, buildQueries };
