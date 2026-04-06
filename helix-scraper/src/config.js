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
    // Social media
    'facebook.com', 'instagram.com', 'youtube.com', 'linkedin.com',
    'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com',
    // Job boards
    'seek.com.au', 'indeed.com', 'careerone.com.au', 'jora.com', 'glassdoor.com',
    // Classifieds / marketplaces
    'gumtree.com.au', 'amazon.com', 'ebay.com.au',
    // Trade platforms & directories (not company sites)
    'hipages.com.au', 'servicecentral.com.au', 'oneflare.com.au', 'airtasker.com',
    'tradesmen.com.au', 'builderscrack.com.au', 'myhammer.com.au',
    // Review / info sites
    'yelp.com', 'tripadvisor.com', 'productreview.com.au', 'trustpilot.com',
    // Directories
    'localsearch.com.au', 'whereis.com', 'whitepages.com.au',
    'yellowpages.com.au', 'truelocal.com.au', 'hotfrog.com.au',
    'abn.business.gov.au', 'abr.business.gov.au',
    // Reference / social
    'wikipedia.org', 'reddit.com', 'quora.com',
    // Blog / CMS platforms (hosted blogs, not company sites)
    'wordpress.com', 'blogspot.com', 'blogger.com', 'medium.com',
    'ghost.io', 'substack.com', 'weebly.com', 'jimdo.com',
    'tumblr.com', 'livejournal.com',
    // Website builders (subdomain-hosted sites are ok, but these domains themselves are junk)
    'wixsite.com', 'squarespace.com', 'webflow.io',
    // Australian news & media
    'abc.net.au', 'news.com.au', 'smh.com.au', 'theage.com.au',
    'heraldsun.com.au', 'couriermail.com.au', 'adelaidenow.com.au',
    'perthnow.com.au', 'theaustralian.com.au', 'dailytelegraph.com.au',
    'canberratimes.com.au', 'ntnews.com.au', 'themercury.com.au',
    'brisbanetimes.com.au', 'watoday.com.au', '9news.com.au', '7news.com.au',
    'ten.com.au', 'sbs.com.au', 'channelnews.com.au',
    // Trade publications / industry blogs (not actual businesses)
    'constructionglobal.com', 'architectureanddesign.com.au',
    'theurbandeveloper.com', 'propertychat.com.au', 'realestate.com.au',
    'domain.com.au', 'realestateview.com.au'
  ],

  // Blog/media platform email domains — emails from these are not real business emails
  BLOG_EMAIL_DOMAINS: [
    'wordpress.com', 'blogspot.com', 'blogger.com', 'medium.com',
    'ghost.io', 'substack.com', 'wixsite.com', 'weebly.com',
    'abc.net.au', 'news.com.au', 'smh.com.au', 'theage.com.au',
    'heraldsun.com.au', 'couriermail.com.au', 'theaustralian.com.au',
    'realestate.com.au', 'domain.com.au', 'seek.com.au'
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
