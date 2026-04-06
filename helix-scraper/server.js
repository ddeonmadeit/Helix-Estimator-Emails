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
  fromName: 'Your Name',
  fromEmail: '',           // must be a verified Resend sender
  replyTo: '',
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

// ── Delay helper ──
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

app.post('/api/start', (req, res) => {
  if (pipeline && pipeline.running) return res.status(409).json({ error: 'Scraper is already running' });

  const { target = 1000, resume = false, sources = ['yellowpages','truelocal','hotfrog','duckduckgo','bing'], industry = null, location = null } = req.body;

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

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  if (pipeline) res.write(`event: progress\ndata: ${JSON.stringify(pipeline.getStatus())}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
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
        const subject = applyMergeTags(tpl.subject, lead, tpl);
        const bodyText = applyMergeTags(tpl.body, lead, tpl);

        // Convert plain text to minimal HTML (preserves line breaks, links look clean)
        const bodyHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px 16px}
          p{margin:0 0 16px}
          a{color:#0066cc}
          .unsub{margin-top:32px;font-size:12px;color:#888}
        </style></head><body>
          ${bodyText.split('\n').map(l => l.trim() === '' ? '</p><p>' : l).join('\n').replace(/^/, '<p>').replace(/$/, '</p>')}
          <div class="unsub"><a href="mailto:${tpl.fromEmail}?subject=Unsubscribe">Unsubscribe</a></div>
        </body></html>`;

        const payload = {
          from: `${tpl.fromName} <${tpl.fromEmail}>`,
          to:   [lead.email],
          subject,
          html: bodyHtml,
          text: bodyText + '\n\n---\nTo unsubscribe reply with "Unsubscribe"',
          headers: {
            'X-Entity-Ref-ID': `helix-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
            'List-Unsubscribe': `<mailto:${tpl.fromEmail}?subject=Unsubscribe>`
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
