import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { leadsByIds, listLeads, listOutreach, markContacted, recordOutreach, updateLead, upsertLeads } from './db.js';
import { discoverLeads } from './services/discovery.js';
import { personalize, sendEmail } from './services/mailer.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/leads', (req, res) => {
  const status = req.query.status;
  res.json(listLeads(status));
});

app.post('/api/discover', async (req, res) => {
  try {
    const result = await discoverLeads(req.body || {});
    upsertLeads(result.leads);
    res.json({ mode: result.mode, added: result.leads.length, leads: listLeads() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/leads/:id', (req, res) => {
  const id = Number(req.params.id);
  const allowed = ['status', 'selected', 'notes', 'contact_name', 'contact_role', 'email'];
  const fields = Object.keys(req.body || {}).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No editable fields provided.' });
  const changes = Object.fromEntries(fields.map(field => [field, req.body[field]]));
  const lead = updateLead(id, changes);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  res.json(lead);
});

app.post('/api/preview', (req, res) => {
  const { ids = [], subject = '', body = '' } = req.body || {};
  const leads = ids.length ? leadsByIds(ids) : [];
  res.json(leads.map(lead => ({
    id: lead.id,
    company_name: lead.company_name,
    recipient: lead.email || '',
    subject: personalize(subject, lead),
    body: personalize(body, lead)
  })));
});

app.post('/api/send', async (req, res) => {
  const { ids = [], subject = '', body = '' } = req.body || {};
  if (!ids.length) return res.status(400).json({ error: 'Select at least one company.' });
  if (!body.trim()) return res.status(400).json({ error: 'Email body is required.' });

  const leads = leadsByIds(ids);
  const results = [];
  for (const lead of leads) {
    try {
      const sent = await sendEmail({ lead, subject, body });
      recordOutreach({ lead_id: lead.id, recipient: sent.recipient, subject: sent.subject || null, body: sent.body, status: 'Sent', error: null });
      markContacted(lead.id);
      results.push({ id: lead.id, company_name: lead.company_name, ok: true });
    } catch (e) {
      recordOutreach({ lead_id: lead.id, recipient: lead.email, subject, body, status: 'Failed', error: e.message });
      results.push({ id: lead.id, company_name: lead.company_name, ok: false, error: e.message });
    }
  }
  res.json({ results });
});

app.get('/api/outreach', (_, res) => {
  res.json(listOutreach());
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Recruitment MVP backend running on http://localhost:${port}`));
