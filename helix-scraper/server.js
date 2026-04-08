#!/usr/bin/env node

const express = require('express');
const path = require('path');
const fs = require('fs');
const csvParser = require('csv-parser');
const { Resend } = require('resend');
const { ScraperPipeline, industries, locations } = require('./src/pipeline');
const config = require('./src/config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Paths ──
const SENT_PATH     = path.join(config.OUTPUT_DIR, 'sent.json');
const TEMPLATE_PATH = path.join(config.OUTPUT_DIR, 'template.json');
const SETTINGS_PATH = path.join(config.OUTPUT_DIR, 'last-settings.json');

function ensureOutputDir() {
  if (!fs.existsSync(config.OUTPUT_DIR)) fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
}

// ── Sent tracker ──
function loadSentEmails() {
  try { return new Set(JSON.parse(fs.readFileSync(SENT_PATH, 'utf8'))); }
  catch { return new Set(); }
}

function saveSentEmails(set) {
  ensureOutputDir();
  fs.writeFileSync(SENT_PATH, JSON.stringify([...set]));
}

// ── Template persistence ──
const DEFAULT_TEMPLATE = {
  fromName: 'Helix Solutions',
  fromEmail: 'info@helixsolution.au',
  replyTo: 'info@helixsolution.au',
  subject: 'Quick question about {{company}}',
  body: `Hi {{firstName}},

I came across {{company}} and wanted to reach out personally.

We help construction and trade businesses in Australia win more work through targeted outreach — and I think there could be a great fit here.

Would you be open to a quick 10-minute chat this week?

Looking forward to hearing from you.

Best,
{{senderName}}`
};

function loadTemplate() {
  try { return { ...DEFAULT_TEMPLATE, ...JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_TEMPLATE }; }
}

function saveTemplate(tpl) {
  ensureOutputDir();
  fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(tpl, null, 2));
}

// ── Merge tag replacement ──
function applyMergeTags(str, lead, tpl) {
  const firstName = (lead.ownerName || '').split(' ')[0] || 'there';
  return (str || '')
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{ownerName\}\}/g, lead.ownerName || '')
    .replace(/\{\{company\}\}/g, lead.companyName || lead.website || 'your business')
    .replace(/\{\{email\}\}/g, lead.email || '')
    .replace(/\{\{industry\}\}/g, lead.industry || '')
    .replace(/\{\{location\}\}/g, lead.location || '')
    .replace(/\{\{senderName\}\}/g, tpl.fromName || '');
}

// ── Email HTML builder ──
function buildEmailHtml(subject, bodyText, lead, tpl) {
  const htmlParas = bodyText
    .split(/\n{2,}/)
    .map(para => `<p style="margin:0 0 20px;line-height:1.75;color:#f0ece4;font-size:15px">${para.trim().replace(/\n/g, '<br>')}</p>`)
    .join('\n          ');

  const recipientEmail = (lead && lead.email) ? lead.email : tpl.fromEmail;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#2b2b2b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#2b2b2b;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Logo / brand bar -->
        <tr><td style="padding:0 0 24px;text-align:center">
          <img src="https://image2url.com/r2/default/images/1775285198680-f6aff5b3-8565-4dfe-9136-83b95958fffa.png"
               width="40" height="40" alt="Helix"
               style="border-radius:10px 4px 10px 10px;display:inline-block;vertical-align:middle;margin-right:10px">
          <span style="font-size:18px;font-weight:700;color:#ffffff;vertical-align:middle">
            <span style="color:#00d4d4">Helix</span> Solutions
          </span>
        </td></tr>

        <!-- Main card -->
        <tr><td style="background:#333333;border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden">

          <!-- Top accent line -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="height:2px;background:transparent"></td>
              <td width="34%" style="height:2px;background:linear-gradient(90deg,transparent,#00d4d4,transparent)"></td>
              <td width="33%" style="height:2px;background:transparent"></td>
            </tr>
          </table>

          <!-- Body text -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:36px 44px 28px">
              ${htmlParas}
            </td></tr>
          </table>

          <!-- CTA section -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:28px 44px 36px;text-align:center;border-top:1px solid rgba(255,255,255,0.07)">
              <p style="margin:0 0 20px;font-size:13px;color:rgba(255,255,255,0.45);letter-spacing:0.3px">Interested? Lock in a time below</p>
              <a href="https://cal.com/helix-solutions/helix-app" target="_blank"
                 style="display:inline-block;padding:13px 36px;background:linear-gradient(135deg,#00d4d4,#00a8a8);color:#0a0a0f;font-weight:700;font-size:14px;text-decoration:none;border-radius:100px;letter-spacing:0.3px;box-shadow:0 4px 20px rgba(0,212,212,0.25)">
                Book a Meeting
              </a>
              <p style="margin:16px 0 0">
                <a href="https://helixsolution.au" target="_blank"
                   style="color:#00d4d4;font-size:13px;font-weight:600;text-decoration:none;opacity:0.85">
                  helixsolution.au
                </a>
              </p>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 8px 8px;text-align:center">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2);line-height:1.7">
            You received this because your business was identified as a potential fit.<br>
            <a href="mailto:${tpl.fromEmail}?subject=Unsubscribe%20${encodeURIComponent(recipientEmail)}"
               style="color:rgba(255,255,255,0.2);text-decoration:underline">Unsubscribe</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Active send job (one at a time) ──
let sendJob = null;

// ── Scraper state ──
let pipeline = null;
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

function attachPipelineEvents(pl) {
  pl.on('progress', (status) => broadcast('progress', status));
  pl.on('lead',     (lead)   => broadcast('lead', lead));
  pl.on('log',      (entry)  => broadcast('log', entry));
  pl.on('done',     (status) => broadcast('done', status));
  pl.on('error',    (msg)    => broadcast('error', { message: msg }));
}

// ═══════════════════════════════════════════════
// Scraper routes
// ═══════════════════════════════════════════════

app.get('/api/options', (req, res) => res.json({ industries, locations }));

app.get('/api/status', (req, res) => {
  if (!pipeline) return res.json({ running: false, phase: 'idle', leadCount: 0, target: 0 });
  res.json(pipeline.getStatus());
});

app.get('/api/last-settings', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))); }
  catch { res.json(null); }
});

app.post('/api/start', (req, res) => {
  if (pipeline && pipeline.running) return res.status(409).json({ error: 'Scraper is already running' });

  const { target = 1000, resume = false, sources = ['yellowpages','truelocal','hotfrog','duckduckgo','bing'], industry = null, location = null } = req.body;

  // Persist settings so Resume can restore them
  const settings = { target, sources, industry, location };
  try { ensureOutputDir(); fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings)); } catch {}

  pipeline = new ScraperPipeline({ target: parseInt(target, 10) || 1000, resume, sources, industry, location, verbose: true });
  attachPipelineEvents(pipeline);
  pipeline.run().catch(err => console.error('Pipeline error:', err.message));

  res.json({ message: 'Scraper started', target: pipeline.target });
});

app.post('/api/stop', (req, res) => {
  if (!pipeline || !pipeline.running) return res.status(400).json({ error: 'Scraper is not running' });
  pipeline.abort();
  res.json({ message: 'Stop requested' });
});

app.get('/api/download', (req, res) => {
  const csvPath = path.join(config.OUTPUT_DIR, 'Helix Leads.csv');
  if (!fs.existsSync(csvPath)) return res.status(404).json({ error: 'No CSV file found. Run the scraper first.' });
  res.download(csvPath, 'Helix Leads.csv');
});

app.get('/api/leads', (req, res) => {
  const csvPath = path.join(config.OUTPUT_DIR, 'Helix Leads.csv');
  if (!fs.existsSync(csvPath)) return res.json({ leads: pipeline ? (pipeline.recentLeads || []) : [] });

  const leads = [];
  fs.createReadStream(csvPath)
    .pipe(csvParser())
    .on('data', row => leads.push({
      email:        row['Email'] || '',
      ownerName:    row['Owner Name'] || '',
      companyName:  row['Company Name'] || '',
      website:      row['Website'] || '',
      industry:     row['Industry'] || '',
      location:     row['Location'] || '',
      emailType:    row['Email Type'] || '',
      qualityScore: parseInt(row['Quality Score'], 10) || 0,
      source:       row['Source'] || ''
    }))
    .on('end', () => res.json({ leads }))
    .on('error', () => res.json({ leads: pipeline ? (pipeline.recentLeads || []) : [] }));
});

// Export leads from browser localStorage as CSV (to save your current 403 leads)
app.post('/api/export-csv', (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'No leads provided' });
  }

  const CSV_HEADERS = 'Email,Owner Name,Company Name,Website,Industry,Location,Email Type,Quality Score,Source\n';

  const escapeCsv = (field) => {
    if (!field) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  let csv = CSV_HEADERS;
  for (const lead of leads) {
    const row = [
      lead.email,
      lead.ownerName,
      lead.companyName,
      lead.website,
      lead.industry,
      lead.location,
      lead.emailType,
      lead.qualityScore,
      lead.source
    ].map(escapeCsv).join(',') + '\n';
    csv += row;
  }

  try {
    const csvPath = path.join(config.OUTPUT_DIR, 'Helix Leads.csv');
    fs.writeFileSync(csvPath, csv);
    res.json({ ok: true, count: leads.length, saved: csvPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  if (pipeline) res.write(`event: progress\ndata: ${JSON.stringify(pipeline.getStatus())}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ═══════════════════════════════════════════════
// Test email
// ═══════════════════════════════════════════════

app.post('/api/send/test', async (req, res) => {
  const tpl = loadTemplate();
  if (!tpl.fromEmail)              return res.status(400).json({ error: 'Set a From Email in the template first' });
  if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'RESEND_API_KEY is not set' });

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Sample lead for merge tag preview
  const sampleLead = {
    email: 'knots.raw@gmail.com',
    ownerName: 'John Smith',
    companyName: 'Acme Construction',
    industry: 'Builder',
    location: 'Sydney'
  };

  const subject  = applyMergeTags(tpl.subject, sampleLead, tpl);
  const bodyText = applyMergeTags(tpl.body, sampleLead, tpl);
  const bodyHtml = buildEmailHtml(subject, bodyText, sampleLead, tpl);

  try {
    await resend.emails.send({
      from:      `${tpl.fromName} <${tpl.fromEmail}>`,
      to:        ['knots.raw@gmail.com'],
      subject,
      html:      bodyHtml,
      text:      bodyText + `\n\n---\nBook a meeting: https://cal.com/helix-solutions/helix-app\nTo unsubscribe reply "Unsubscribe"`,
      reply_to:  tpl.replyTo || tpl.fromEmail
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
// Email template routes
// ═══════════════════════════════════════════════

app.get('/api/template', (req, res) => {
  res.json(loadTemplate());
});

app.post('/api/template', (req, res) => {
  const tpl = { ...loadTemplate(), ...req.body };
  saveTemplate(tpl);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// Sent-email tracking
// ═══════════════════════════════════════════════

app.get('/api/sent', (req, res) => {
  const sent = loadSentEmails();
  res.json({ count: sent.size, emails: [...sent] });
});

app.delete('/api/sent', (req, res) => {
  saveSentEmails(new Set());
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// Bulk send (SSE stream)
// ═══════════════════════════════════════════════

// POST /api/send/start  — kicks off a send job
app.post('/api/send/start', async (req, res) => {
  if (sendJob && sendJob.running) return res.status(409).json({ error: 'A send job is already running' });

  const { leads, delayMin = 4000, delayMax = 9000 } = req.body;

  if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'No leads provided' });

  const tpl = loadTemplate();

  if (!tpl.fromEmail) return res.status(400).json({ error: 'Set a verified From email in the template first' });
  if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'RESEND_API_KEY environment variable is not set' });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const sentSet = loadSentEmails();

  // Filter out already-sent emails
  const queue = leads.filter(l => l.email && !sentSet.has(l.email.toLowerCase()));

  sendJob = {
    running: true,
    total: queue.length,
    sent: 0,
    skipped: leads.length - queue.length,
    failed: 0,
    aborted: false
  };

  res.json({ ok: true, queued: queue.length, alreadySent: sendJob.skipped });

  // Run in background, stream progress via /api/send/events
  (async () => {
    for (const lead of queue) {
      if (sendJob.aborted) break;

      try {
        const subject  = applyMergeTags(tpl.subject, lead, tpl);
        const bodyText = applyMergeTags(tpl.body, lead, tpl);
        const firstName = (lead.ownerName || '').split(' ')[0] || 'there';

        const bodyHtml = buildEmailHtml(subject, bodyText, lead, tpl);

        // Recipient with name if available (improves deliverability)
        const toAddress = lead.ownerName
          ? `${lead.ownerName} <${lead.email}>`
          : lead.email;

        const payload = {
          from:    `${tpl.fromName} <${tpl.fromEmail}>`,
          to:      [toAddress],
          subject,
          html:    bodyHtml,
          // Plain-text is the most important spam-filter signal — keep it clean
          text:    bodyText + `\n\n---\nBook a meeting: https://cal.com/helix-solutions/helix-app\nhelixsolution.au\n\nTo unsubscribe reply "Unsubscribe" or email ${tpl.fromEmail}`,
          headers: {
            // Unique message ID prevents threading across recipients
            'X-Entity-Ref-ID':       `helix-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,
            // RFC-compliant unsubscribe (required by Gmail/Yahoo bulk sender rules)
            'List-Unsubscribe':      `<mailto:${tpl.fromEmail}?subject=Unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            // Precedence header signals transactional, not marketing blast
            'Precedence':            'bulk'
          }
        };

        if (tpl.replyTo) payload.reply_to = tpl.replyTo;

        await resend.emails.send(payload);

        sentSet.add(lead.email.toLowerCase());
        saveSentEmails(sentSet);
        sendJob.sent++;

        broadcastSend('send_progress', {
          sent: sendJob.sent,
          total: sendJob.total,
          failed: sendJob.failed,
          current: lead.email,
          status: 'sent'
        });

      } catch (err) {
        sendJob.failed++;
        broadcastSend('send_progress', {
          sent: sendJob.sent,
          total: sendJob.total,
          failed: sendJob.failed,
          current: lead.email,
          status: 'failed',
          error: err.message
        });
      }

      if (!sendJob.aborted && sendJob.sent + sendJob.failed < sendJob.total) {
        const wait = delayMin + Math.random() * (delayMax - delayMin);
        await delay(wait);
      }
    }

    sendJob.running = false;
    broadcastSend('send_done', { sent: sendJob.sent, failed: sendJob.failed, total: sendJob.total, aborted: sendJob.aborted });
  })();
});

// Abort running send
app.post('/api/send/stop', (req, res) => {
  if (!sendJob || !sendJob.running) return res.status(400).json({ error: 'No send job running' });
  sendJob.aborted = true;
  res.json({ ok: true });
});

// Send job status
app.get('/api/send/status', (req, res) => {
  if (!sendJob) return res.json({ running: false });
  res.json({ ...sendJob });
});

// SSE stream for send progress
const sendSseClients = new Set();

function broadcastSend(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sendSseClients) c.write(msg);
}

app.get('/api/send/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  if (sendJob) res.write(`event: send_progress\ndata: ${JSON.stringify({ sent: sendJob.sent, total: sendJob.total, failed: sendJob.failed, running: sendJob.running })}\n\n`);
  sendSseClients.add(res);
  req.on('close', () => sendSseClients.delete(res));
});

// Serve dashboard
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Helix Outreach UI running at http://0.0.0.0:${PORT}\n`);
});
