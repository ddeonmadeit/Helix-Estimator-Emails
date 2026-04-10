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
const SENT_PATH       = path.join(config.OUTPUT_DIR, 'sent.json');
const TEMPLATE_PATH   = path.join(config.OUTPUT_DIR, 'template.json');
const SETTINGS_PATH   = path.join(config.OUTPUT_DIR, 'last-settings.json');
const SEND_QUEUE_PATH = path.join(config.OUTPUT_DIR, 'send-queue.json');
const REMOVED_PATH    = path.join(config.OUTPUT_DIR, 'removed-leads.json');

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
    .map(para => `<p class="body-text" style="margin:0 0 20px;line-height:1.8;font-size:15px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${para.trim().replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  const recipientEmail = (lead && lead.email) ? lead.email : tpl.fromEmail;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${subject}</title>
  <style>
    /* Light mode defaults */
    .body-text  { color: #1a1a1a !important; }
    .footer-text{ color: #888888 !important; }
    .footer-link{ color: #888888 !important; }
    .divider-td { background-color: #e0e0e0 !important; }

    /* Dark mode overrides */
    @media (prefers-color-scheme: dark) {
      .body-text  { color: #f0ece4 !important; }
      .footer-text{ color: #666666 !important; }
      .footer-link{ color: #666666 !important; }
      .divider-td { background-color: #3a3a3a !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:32px 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">

        <!-- Logo -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="padding-bottom:28px">
              <img src="https://image2url.com/r2/default/images/1775285198680-f6aff5b3-8565-4dfe-9136-83b95958fffa.png"
                   width="52" height="52" alt="Helix"
                   style="display:block;border-radius:12px;width:52px;height:52px">
            </td>
          </tr>
        </table>

        <!-- Body text -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding-bottom:32px">
              ${htmlParas}
            </td>
          </tr>
        </table>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="padding-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
              <a href="https://cal.com/helix-solutions/helix-app" target="_blank"
                 style="display:inline-block;padding:14px 38px;background-color:#00d4d4;color:#1a1a1a;font-weight:700;font-size:14px;text-decoration:none;border-radius:100px;letter-spacing:0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
                Book a Meeting
              </a>
              <p style="margin:14px 0 0;text-align:center">
                <a href="https://helixsolution.au" target="_blank"
                   style="color:#00d4d4;font-size:13px;font-weight:600;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
                  helixsolution.au
                </a>
              </p>
            </td>
          </tr>
        </table>

        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px">
          <tr><td class="divider-td" style="height:1px;font-size:0;line-height:0">&nbsp;</td></tr>
        </table>

        <!-- Footer -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="padding:20px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
              <p class="footer-text" style="margin:0;font-size:11px;line-height:1.7;text-align:center">
                You received this because your business was identified as a potential fit.<br>
                <a href="mailto:${tpl.fromEmail}?subject=Unsubscribe%20${encodeURIComponent(recipientEmail)}"
                   class="footer-link" style="text-decoration:underline">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Send queue persistence ──
function saveSendQueue(queue, index, opts) {
  ensureOutputDir();
  fs.writeFileSync(SEND_QUEUE_PATH, JSON.stringify({ queue, index, opts }));
}
function clearSendQueue() {
  try { fs.unlinkSync(SEND_QUEUE_PATH); } catch {}
}
function loadSendQueue() {
  try { return JSON.parse(fs.readFileSync(SEND_QUEUE_PATH, 'utf8')); }
  catch { return null; }
}

// ── Keep-alive (prevents Railway free-tier sleep during a send job) ──
let keepAliveTimer = null;
function startKeepAlive() {
  if (keepAliveTimer) return;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!domain) return;
  const https = require('https');
  keepAliveTimer = setInterval(() => {
    https.get(`https://${domain}/api/ping`, res => res.resume()).on('error', () => {});
  }, 20 * 60 * 1000); // every 20 min — Railway sleeps after 30 min idle
}
function stopKeepAlive() {
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

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

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// ── Removed leads (permanent email blocklist) ──
function loadRemovedLeads() {
  try { return new Set(JSON.parse(fs.readFileSync(REMOVED_PATH, 'utf8'))); }
  catch { return new Set(); }
}
function saveRemovedLeads(set) {
  ensureOutputDir();
  fs.writeFileSync(REMOVED_PATH, JSON.stringify([...set]));
}

// GET /api/leads/removed — frontend fetches this on startup to filter localStorage
app.get('/api/leads/removed', (req, res) => {
  res.json([...loadRemovedLeads()]);
});

// POST /api/leads/remove — add emails to the permanent removal list
app.post('/api/leads/remove', (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) return res.status(400).json({ error: 'emails array required' });
  const set = loadRemovedLeads();
  for (const e of emails) set.add(e.toLowerCase().trim());
  saveRemovedLeads(set);
  // Also remove from sent list so they don't show as "already sent"
  const sentSet = loadSentEmails();
  let changed = false;
  for (const e of emails) { if (sentSet.delete(e.toLowerCase().trim())) changed = true; }
  if (changed) saveSentEmails(sentSet);
  res.json({ ok: true, removed: emails.length, total: set.size });
});

app.get('/api/sent', (req, res) => {
  const sent = loadSentEmails();
  res.json({ count: sent.size, emails: [...sent] });
});

app.delete('/api/sent', (req, res) => {
  saveSentEmails(new Set());
  res.json({ ok: true });
});

// POST /api/leads/remove-sent — bulk-add emails to sent.json (history recovery)
app.post('/api/leads/remove-sent', (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
  const sentSet = loadSentEmails();
  for (const e of emails) sentSet.add(e.toLowerCase().trim());
  saveSentEmails(sentSet);
  res.json({ ok: true, total: sentSet.size });
});

// ═══════════════════════════════════════════════
// Bulk send (SSE stream)
// ═══════════════════════════════════════════════

// POST /api/send/start  — kicks off a send job
app.post('/api/send/start', async (req, res) => {
  if (sendJob && sendJob.running) return res.status(409).json({ error: 'A send job is already running' });

  const { leads, delayMin = 2000, delayMax = 5000, clientSent = [] } = req.body;

  if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'No leads provided' });

  const tpl = loadTemplate();

  if (!tpl.fromEmail) return res.status(400).json({ error: 'Set a verified From email in the template first' });
  if (!process.env.RESEND_API_KEY) return res.status(400).json({ error: 'RESEND_API_KEY environment variable is not set' });

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Merge server-side sent.json with client-side localStorage sent list
  const sentSet = loadSentEmails();
  for (const e of clientSent) sentSet.add(e.toLowerCase());
  saveSentEmails(sentSet); // persist the merged set immediately

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

  // Persist queue so it survives server restarts
  saveSendQueue(queue, 0, { delayMin, delayMax });

  startKeepAlive();
  runSendQueue(queue, 0, { delayMin, delayMax }, resend, sentSet);
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

async function runSendQueue(queue, startIndex, opts, resend, sentSet) {
  const { delayMin, delayMax } = opts;
  const tpl = loadTemplate();

  for (let i = startIndex; i < queue.length; i++) {
    if (sendJob.aborted) break;
    const lead = queue[i];

    // Persist queue position every 5 emails so a restart resumes from near here
    if (i % 5 === 0) saveSendQueue(queue, i, opts);

    try {
      const subject  = applyMergeTags(tpl.subject, lead, tpl);
      const bodyText = applyMergeTags(tpl.body, lead, tpl);
      const bodyHtml = buildEmailHtml(subject, bodyText, lead, tpl);
      const toAddress = lead.ownerName ? `${lead.ownerName} <${lead.email}>` : lead.email;

      await resend.emails.send({
        from:    `${tpl.fromName} <${tpl.fromEmail}>`,
        to:      [toAddress],
        subject,
        html:    bodyHtml,
        text:    bodyText + `\n\n---\nBook a meeting: https://cal.com/helix-solutions/helix-app\nhelixsolution.au\n\nTo unsubscribe reply "Unsubscribe" or email ${tpl.fromEmail}`,
        reply_to: tpl.replyTo || undefined,
        headers: {
          'X-Entity-Ref-ID':       `helix-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,
          'List-Unsubscribe':      `<mailto:${tpl.fromEmail}?subject=Unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'Precedence':            'bulk'
        }
      });

      sentSet.add(lead.email.toLowerCase());
      saveSentEmails(sentSet); // write after every success so dedup is always accurate
      sendJob.sent++;

      broadcastSend('send_progress', { sent: sendJob.sent, total: sendJob.total, failed: sendJob.failed, current: lead.email, status: 'sent' });

    } catch (err) {
      sendJob.failed++;
      broadcastSend('send_progress', { sent: sendJob.sent, total: sendJob.total, failed: sendJob.failed, current: lead.email, status: 'failed', error: err.message });
    }

    if (!sendJob.aborted && i < queue.length - 1) {
      const wait = delayMin + Math.random() * (delayMax - delayMin);
      await delay(wait);
    }
  }

  clearSendQueue();
  stopKeepAlive();
  sendJob.running = false;
  broadcastSend('send_done', { sent: sendJob.sent, failed: sendJob.failed, total: sendJob.total, aborted: sendJob.aborted });
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

  // One-time removal of specific leads requested by user
  const toRemove = [
    'hello@builder.co',
    'info@vandbuilders.com.au',
    'customerservice@metricon.com.au',
    'jason@thomsenbuild.com.au',
    'info@builderssydneyexperts.com.au'
  ];
  const removedSet = loadRemovedLeads();
  let added = false;
  for (const e of toRemove) { if (!removedSet.has(e)) { removedSet.add(e); added = true; } }
  if (added) { saveRemovedLeads(removedSet); console.log('  Seeded removed-leads list'); }

  // Auto-resume any send job that was interrupted by a server restart
  const pending = loadSendQueue();
  if (pending && Array.isArray(pending.queue) && pending.index < pending.queue.length) {
    const { queue, index, opts } = pending;
    const remaining = queue.length - index;
    console.log(`  Resuming interrupted send job from index ${index} (${remaining} remaining)`);
    if (!process.env.RESEND_API_KEY) {
      console.warn('  Cannot resume — RESEND_API_KEY not set');
      return;
    }
    const resend = new Resend(process.env.RESEND_API_KEY);
    const sentSet = loadSentEmails();
    sendJob = { running: true, total: queue.length, sent: index, skipped: 0, failed: 0, aborted: false };
    runSendQueue(queue, index, opts, resend, sentSet);
  }
});
