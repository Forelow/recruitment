import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import {
  createDiscoveryJob, getDiscoveryJob, getRunningDiscoveryJob, leadsByIds, listLeads,
  listOutreach, markContacted, recordOutreach, updateDiscoveryJob, updateLead, upsertLeads
} from './db.js';
import { discoverLeads } from './services/discovery.js';
import { personalize, sendEmail } from './services/mailer.js';

const app = express();
const allowedLimits = new Set([100, 250, 500, 1000]);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/leads', (req, res) => {
  res.json(listLeads(req.query.status, req.query.emailStatus));
});

app.post('/api/discover', (req, res) => {
  const requestedLimit = Number(req.body?.limit) || 100;
  if (!allowedLimits.has(requestedLimit)) {
    return res.status(400).json({ error: 'Limit must be 100, 250, 500 or 1000.' });
  }

  const running = getRunningDiscoveryJob();
  if (running) return res.status(409).json({ error: 'A discovery job is already running.', job: running });

  const job = createDiscoveryJob({ id: randomUUID(), target: requestedLimit });
  res.status(202).json({ job });

  setImmediate(async () => {
    const pendingLeads = [];
    const flushLeads = () => {
      if (pendingLeads.length) upsertLeads(pendingLeads.splice(0));
    };

    try {
      updateDiscoveryJob(job.id, { status: 'running', phase: 'searching' });
      const result = await discoverLeads({
        limit: requestedLimit,
        onLead: lead => {
          pendingLeads.push(lead);
          if (pendingLeads.length >= 10) flushLeads();
        },
        onProgress: progress => updateDiscoveryJob(job.id, { status: 'running', ...progress })
      });
      flushLeads();
      updateDiscoveryJob(job.id, {
        status: 'completed',
        phase: 'completed',
        mode: result.mode,
        ...result.stats,
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      flushLeads();
      updateDiscoveryJob(job.id, {
        status: 'failed',
        phase: 'failed',
        error: error.message,
        completed_at: new Date().toISOString()
      });
    }
  });
});

app.get('/api/discover/:jobId', (req, res) => {
  const job = getDiscoveryJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Discovery job not found.' });
  res.json({ job });
});

app.patch('/api/leads/:id', (req, res) => {
  const id = Number(req.params.id);
  const allowed = ['status', 'selected', 'notes', 'contact_name', 'contact_role', 'email'];
  const fields = Object.keys(req.body || {}).filter(key => allowed.includes(key));
  if (!fields.length) return res.status(400).json({ error: 'No editable fields provided.' });
  const changes = Object.fromEntries(fields.map(field => [field, req.body[field]]));
  const lead = updateLead(id, changes);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  res.json(lead);
});

app.post('/api/preview', (req, res) => {
  const { ids = [], subject = '', body = '' } = req.body || {};
  const leads = ids.length ? leadsByIds(ids).filter(lead => lead.email) : [];
  res.json(leads.map(lead => ({
    id: lead.id,
    company_name: lead.company_name,
    recipient: lead.email,
    subject: personalize(subject, lead),
    body: personalize(body, lead)
  })));
});

app.post('/api/send', async (req, res) => {
  const { ids = [], subject = '', body = '' } = req.body || {};
  if (!ids.length) return res.status(400).json({ error: 'Select at least one company.' });
  if (!body.trim()) return res.status(400).json({ error: 'Email body is required.' });

  const leads = leadsByIds(ids).filter(lead => lead.email);
  if (!leads.length) return res.status(400).json({ error: 'None of the selected companies has an email address.' });

  const results = [];
  for (const lead of leads) {
    try {
      const sent = await sendEmail({ lead, subject, body });
      recordOutreach({ lead_id: lead.id, recipient: sent.recipient, subject: sent.subject || null, body: sent.body, status: 'Sent', error: null });
      markContacted(lead.id);
      results.push({ id: lead.id, company_name: lead.company_name, ok: true });
    } catch (error) {
      recordOutreach({ lead_id: lead.id, recipient: lead.email, subject, body, status: 'Failed', error: error.message });
      results.push({ id: lead.id, company_name: lead.company_name, ok: false, error: error.message });
    }
  }
  res.json({ results });
});

app.get('/api/outreach', (_, res) => res.json(listOutreach()));

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Recruitment MVP backend running on http://localhost:${port}`));
