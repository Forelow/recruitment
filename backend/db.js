import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recruitment-data.json');
const emptyData = { leads: [], outreach: [], discoveryJobs: [], nextLeadId: 1, nextOutreachId: 1 };

function readData() {
  try {
    return { ...emptyData, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) };
  } catch {
    return { ...emptyData };
  }
}

const data = readData();
data.leads ||= [];
data.outreach ||= [];
data.discoveryJobs ||= [];
data.nextLeadId ||= 1;
data.nextOutreachId ||= 1;

for (const job of data.discoveryJobs) {
  if (job.status === 'queued' || job.status === 'running') {
    Object.assign(job, { status: 'interrupted', error: 'The backend restarted before this search completed.', completed_at: new Date().toISOString() });
  }
}

const save = () => fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

export function upsertLeads(leads) {
  for (const lead of leads) {
    const existing = data.leads.find(item => item.domain === lead.domain);
    if (existing) {
      const jobTitles = [...new Set([...(existing.job_titles || [existing.job_title]), lead.job_title].filter(Boolean))];
      Object.assign(existing, {
        ...lead,
        id: existing.id,
        job_titles: jobTitles,
        job_title: existing.job_title || lead.job_title,
        email: lead.email || existing.email || null,
        email_status: lead.email || existing.email ? 'Found' : 'Not found',
        status: existing.status,
        discovered_at: existing.discovered_at,
        contacted_at: existing.contacted_at,
        score: Math.max(existing.score || 0, lead.score || 0)
      });
    } else {
      data.leads.push({
        id: data.nextLeadId++,
        ...lead,
        job_titles: lead.job_title ? [lead.job_title] : [],
        email_status: lead.email ? 'Found' : 'Not found',
        status: 'New',
        notes: lead.notes || null,
        discovered_at: new Date().toISOString(),
        contacted_at: null
      });
    }
  }
  save();
}

export function listLeads(status, emailStatus) {
  return data.leads
    .filter(lead => !status || status === 'All' || lead.status === status)
    .filter(lead => !emailStatus || emailStatus === 'all' || (emailStatus === 'found' ? Boolean(lead.email) : !lead.email))
    .sort((a, b) => Number(Boolean(b.email)) - Number(Boolean(a.email)) || (b.score || 0) - (a.score || 0) || String(b.discovered_at).localeCompare(String(a.discovered_at)));
}

export function updateLead(id, changes) {
  const lead = data.leads.find(item => item.id === id);
  if (!lead) return null;
  Object.assign(lead, changes);
  lead.email_status = lead.email ? 'Found' : 'Not found';
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

export function createDiscoveryJob(job) {
  const now = new Date().toISOString();
  const record = {
    id: job.id,
    target: job.target,
    status: 'queued',
    phase: 'queued',
    mode: null,
    processed: 0,
    candidatesFound: 0,
    emailsFound: 0,
    searchRequests: 0,
    maxRequests: 0,
    rawResults: 0,
    excluded: 0,
    duplicates: 0,
    error: null,
    created_at: now,
    updated_at: now,
    completed_at: null
  };
  data.discoveryJobs.unshift(record);
  data.discoveryJobs = data.discoveryJobs.slice(0, 20);
  save();
  return record;
}

export function updateDiscoveryJob(id, changes) {
  const job = data.discoveryJobs.find(item => item.id === id);
  if (!job) return null;
  Object.assign(job, changes, { updated_at: new Date().toISOString() });
  save();
  return job;
}

export function getDiscoveryJob(id) {
  return data.discoveryJobs.find(job => job.id === id) || null;
}

export function getRunningDiscoveryJob() {
  return data.discoveryJobs.find(job => job.status === 'queued' || job.status === 'running') || null;
}

save();
