require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

module.exports = {
  // Directory scraping
  DIRECTORY_DELAY_MIN: 1500,
  DIRECTORY_DELAY_MAX: 4000,
  DIRECTORY_CONCURRENCY: parseInt(process.env.DIRECTORY_CONCURRENCY, 10) || 3,

  // Company website scraping
  SITE_DELAY_MIN: 800,
  SITE_DELAY_MAX: 2500,
  SITE_CONCURRENCY: parseInt(process.env.SITE_CONCURRENCY, 10) || 10,

  // Search engine scraping
  SEARCH_DELAY_MIN: 5000,
  SEARCH_DELAY_MAX: 12000,
  SEARCH_CONCURRENCY: 1,

  // General
  REQUEST_TIMEOUT: 10000,
  MAX_RETRIES: 2,
  RETRY_BACKOFF_BASE: 5000,

  // Target
  TARGET_LEADS: parseInt(process.env.TARGET_LEADS, 10) || 1000,

  // Paths
  OUTPUT_DIR: require('path').join(__dirname, '..', 'output'),
  DATA_DIR: require('path').join(__dirname, '..', 'data'),

  // Free email domains to discard
  FREE_EMAIL_DOMAINS: [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'icloud.com', 'live.com', 'yahoo.com.au', 'hotmail.com.au',
    'live.com.au', 'outlook.com.au', 'mail.com', 'aol.com',
    'protonmail.com', 'zoho.com'
  ],

  // Automated email prefixes to discard
  AUTOMATED_PREFIXES: [
    'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
    'postmaster', 'bounce', 'auto', 'daemon'
  ],

  // Generic email prefixes
  GENERIC_PREFIXES: [
    'info', 'admin', 'sales', 'hello', 'enquiries', 'enquiry',
    'office', 'reception', 'contact', 'accounts', 'support',
    'general', 'mail', 'team', 'help'
  ],

  // Junk domains to skip from search results
  JUNK_DOMAINS: [
    'facebook.com', 'instagram.com', 'youtube.com', 'linkedin.com',
    'gumtree.com.au', 'seek.com.au', 'abn.business.gov.au',
    'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com',
    'yelp.com', 'tripadvisor.com', 'wikipedia.org', 'reddit.com',
    'amazon.com', 'ebay.com.au', 'hipages.com.au', 'servicecentral.com.au',
    'productreview.com.au', 'oneflare.com.au', 'airtasker.com',
    'localsearch.com.au', 'whereis.com', 'whitepages.com.au',
    'yellowpages.com.au', 'truelocal.com.au', 'hotfrog.com.au'
  ],

  // High-end indicators
  HIGH_END_KEYWORDS: [
    'commercial', 'project management', 'design and construct',
    'luxury', 'custom home', 'multi-storey', 'civil', 'government',
    'heritage', 'architect', 'million', 'premium', 'bespoke',
    'high-end', 'award-winning', 'masterbuilt'
  ],

  // Owner keywords
  OWNER_KEYWORDS: [
    'owner', 'director', 'managing director', 'founder',
    'principal', 'ceo', 'proprietor', 'co-founder', 'chief executive'
  ],

  // Subpages to check for emails
  CONTACT_SUBPAGES: [
    '/contact', '/contact-us', '/contact.html',
    '/about', '/about-us', '/about.html',
    '/team', '/our-team', '/meet-the-team',
    '/staff', '/people'
  ],

  // Block tracking per source
  BLOCK_PAUSE_MS: 30000,
  BLOCK_LONG_PAUSE_MS: 300000,
  MAX_CONSECUTIVE_BLOCKS: 3,

  VERBOSE: process.env.VERBOSE === 'true'
};
