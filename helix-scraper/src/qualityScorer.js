const config = require('./config');

function classifyEmail(email) {
  if (!email) return null;
  const local = email.split('@')[0].toLowerCase();

  for (const prefix of config.AUTOMATED_PREFIXES) {
    if (local === prefix || local.startsWith(prefix + '.') || local.startsWith(prefix + '-')) {
      return 'automated';
    }
  }

  for (const prefix of config.GENERIC_PREFIXES) {
    if (local === prefix || local.startsWith(prefix + '.') || local.startsWith(prefix + '-')) {
      return 'generic';
    }
  }

  return 'personal';
}

function isFreeDomain(email) {
  if (!email) return true;
  const domain = email.split('@')[1].toLowerCase();
  return config.FREE_EMAIL_DOMAINS.includes(domain);
}

function scoreLead(lead) {
  let score = 0;

  // +1 personal email
  if (lead.emailType === 'personal') score++;

  // +1 owner name found
  if (lead.ownerName && lead.ownerName.trim()) score++;

  // +1 .com.au domain
  if (lead.website && lead.website.includes('.com.au')) score++;

  // +1 high-end signals
  if (lead.isHighEnd) score++;

  // +1 industry identified
  if (lead.industry && lead.industry.trim()) score++;

  return Math.max(1, Math.min(5, score));
}

function detectHighEnd(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  // Check for high-end keywords
  for (const keyword of config.HIGH_END_KEYWORDS) {
    if (lower.includes(keyword)) return true;
  }
  // Check for dollar amounts
  if (/\$\s*[\d,]+/.test(text) && /million|[0-9]{6,}/.test(lower)) return true;
  return false;
}

module.exports = {
  classifyEmail,
  isFreeDomain,
  scoreLead,
  detectHighEnd
};
