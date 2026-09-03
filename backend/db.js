import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recruitment-data.json');

function readData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    return { leads: [], outreach: [], nextLeadId: 1, nextOutreachId: 1 };
  }
}

const data = readData();
const save = () => fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

export function upsertLeads(leads) {
  for (const lead of leads) {
    const existing = data.leads.find(item => item.domain === lead.domain && item.job_title === lead.job_title);
    if (existing) {
      Object.assign(existing, {
        ...lead,
        id: existing.id,
        status: existing.status,
        discovered_at: existing.discovered_at,
        contacted_at: existing.contacted_at,
        score: Math.max(existing.score || 0, lead.score || 0)
      });
    } else {
      data.leads.push({
        id: data.nextLeadId++,
        ...lead,
        status: 'New',
        notes: lead.notes || null,
        discovered_at: new Date().toISOString(),
        contacted_at: null
      });
    }
  }
  save();
}

export function listLeads(status) {
  return data.leads
    .filter(lead => lead.email && (!status || status === 'All' || lead.status === status))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.discovered_at).localeCompare(String(a.discovered_at)));
}

export function updateLead(id, changes) {
  const lead = data.leads.find(item => item.id === id);
  if (!lead) return null;
  Object.assign(lead, changes);
  save();
  return lead;
}

export function leadsByIds(ids) {
  const wanted = new Set(ids.map(Number));
  return data.leads.filter(lead => wanted.has(lead.id));
}

export function recordOutreach(entry) {
  data.outreach.push({ id: data.nextOutreachId++, ...entry, sent_at: new Date().toISOString() });
  save();
}

export function markContacted(id) {
  updateLead(id, { status: 'Contacted', contacted_at: new Date().toISOString() });
}

export function listOutreach() {
  return [...data.outreach]
    .map(item => ({ ...item, company_name: data.leads.find(lead => lead.id === item.lead_id)?.company_name || '' }))
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)));
}
