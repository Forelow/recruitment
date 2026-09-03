import axios from 'axios';
import { findBusinessContact } from './contactFinder.js';

const EXCLUDED_TERMS = [
  'recruitment', 'recruiter', 'staffing', 'employment agency', 'manpower',
  'headhunter', 'headhunting', 'talent agency', 'executive search'
];

const EXCLUDED_DOMAINS = [
  'linkedin.com', 'jobstreet.com', 'indeed.com', 'glassdoor.com',
  'mycareersfuture.gov.sg', 'jobscentral.com.sg', 'foundit.sg',
  'grabjobs.co', 'talent.com', 'jooble.org'
];

const SEARCH_QUERIES = [
  '"we are hiring" Singapore "Pte Ltd"',
  '"join our team" Singapore company careers',
  'site:.sg careers vacancies company',
  'site:.com.sg careers jobs',
  'Singapore company "current openings"',
  'Singapore company "career opportunities"'
];

const DEMO = [
  {
    company_name: 'Meridian Engineering Pte Ltd', website: 'https://example.com', domain: 'example.com',
    location: 'Singapore', job_title: 'Electrical Engineer', job_url: 'https://example.com/jobs/electrical-engineer',
    source: 'Demo data', contact_name: 'Hiring Team', contact_role: 'Human Resources', email: 'hr@example.com',
    email_status: 'Found', confidence: 'High', score: 92
  },
  {
    company_name: 'Northstar Logistics Pte Ltd', website: 'https://example.org', domain: 'example.org',
    location: 'Singapore', job_title: 'Operations Executive', job_url: 'https://example.org/careers',
    source: 'Demo data', contact_name: null, contact_role: null, email: 'careers@example.org',
    email_status: 'Found', confidence: 'Medium', score: 84
  },
  {
    company_name: 'Brightline Manufacturing Pte Ltd', website: 'https://example.net', domain: 'example.net',
    location: 'Singapore', job_title: 'Production Technician', job_url: 'https://example.net/jobs',
    source: 'Demo data', contact_name: null, contact_role: null, email: null,
    email_status: 'Not found', confidence: 'Low', score: 58
  }
];

function domainFromUrl(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function websiteFromUrl(url) {
  try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}`; } catch { return url; }
}

function companyFromResult(title, domain) {
  let name = String(title || '')
    .replace(/\s[-|–].*$/, '')
    .replace(/careers?|jobs?|vacancies|hiring|current openings/gi, '')
    .trim();
  if (!name || name.length < 2) name = domain.split('.')[0].replace(/[-_]/g, ' ');
  return name.replace(/\b\w/g, character => character.toUpperCase());
}

function isExcludedDomain(domain) {
  return domain.endsWith('.gov.sg') || EXCLUDED_DOMAINS.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));
}

function isExcludedOrganisation(title, domain) {
  const text = `${title || ''} ${domain}`.toLowerCase();
  return EXCLUDED_TERMS.some(term => text.includes(term));
}

function isLocalCompany(text, domain) {
  return domain.endsWith('.sg') || /\bsingapore\b|\bpte\.?\s*ltd\.?\b/i.test(text || '');
}

function scoreLead({ email, domain, snippet }) {
  let score = 45;
  if (email) score += 25;
  if (domain.endsWith('.sg')) score += 15;
  if (/hiring|vacancy|vacancies|career|job opening|join us/i.test(snippet || '')) score += 10;
  return Math.min(score, 100);
}

function numberFromEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(Math.max(value, minimum), maximum) : fallback;
}

async function searchPage({ key, query, start, searchClient }) {
  try {
    const { data } = await searchClient.get('https://serpapi.com/search.json', {
      timeout: 20000,
      params: {
        engine: 'google', api_key: key, q: query, location: 'Singapore',
        gl: 'sg', hl: 'en', num: 100, start
      }
    });
    if (data.error) throw new Error(data.error);
    return data.organic_results || [];
  } catch (error) {
    const detail = error.response?.data?.error || error.message;
    throw new Error(`SerpApi request failed: ${detail}`);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export async function discoverLeads({
  limit = 100,
  onProgress = () => {},
  onLead = () => {},
  searchClient = axios,
  contactFinder = findBusinessContact
} = {}) {
  const target = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const key = process.env.SERPAPI_API_KEY;

  if (!key) {
    const leads = DEMO.slice(0, target);
    leads.forEach(onLead);
    const stats = { processed: leads.length, candidatesFound: leads.length, emailsFound: leads.filter(lead => lead.email).length, searchRequests: 0, rawResults: leads.length, excluded: 0, duplicates: 0 };
    onProgress({ phase: 'completed', ...stats });
    return { mode: 'demo', leads, stats };
  }

  const maxRequests = numberFromEnv('SERPAPI_MAX_REQUESTS', Math.min(30, Math.max(6, Math.ceil(target / 50) * 2)), 1, 100);
  const concurrency = numberFromEnv('DISCOVERY_CONCURRENCY', 5, 1, 10);
  const candidates = new Map();
  const exhaustedQueries = new Set();
  let searchRequests = 0;
  let page = 0;
  let rawResults = 0;
  let excluded = 0;
  let duplicates = 0;

  while (candidates.size < target && searchRequests < maxRequests && exhaustedQueries.size < SEARCH_QUERIES.length) {
    let addedThisRound = 0;
    for (const query of SEARCH_QUERIES) {
      if (candidates.size >= target || searchRequests >= maxRequests) break;
      if (exhaustedQueries.has(query)) continue;
      const results = await searchPage({ key, query, start: page * 100, searchClient });
      searchRequests += 1;
      if (!results.length) exhaustedQueries.add(query);

      for (const item of results) {
        rawResults += 1;
        const domain = domainFromUrl(item.link);
        const resultText = `${item.title || ''} ${item.snippet || ''}`;
        if (!domain || isExcludedDomain(domain) || isExcludedOrganisation(item.title, domain) || !isLocalCompany(resultText, domain)) {
          excluded += 1;
          continue;
        }
        if (!candidates.has(domain)) {
          candidates.set(domain, item);
          addedThisRound += 1;
        } else duplicates += 1;
        if (candidates.size >= target) break;
      }

      onProgress({ phase: 'searching', processed: 0, candidatesFound: candidates.size, emailsFound: 0, searchRequests, maxRequests, rawResults, excluded, duplicates });
    }
    if (!addedThisRound) break;
    page += 1;
  }

  const candidateList = [...candidates.entries()].slice(0, target);
  const leads = [];
  let processed = 0;
  let emailsFound = 0;

  await mapWithConcurrency(candidateList, concurrency, async ([domain, item]) => {
    const contact = await contactFinder(item.link);
    const email = contact.email || null;
    if (email) emailsFound += 1;

    const lead = {
      company_name: companyFromResult(item.title, domain),
      website: websiteFromUrl(item.link),
      domain,
      location: 'Singapore',
      job_title: item.title || 'Current hiring opportunity',
      job_url: item.link,
      source: 'SerpApi Google Search',
      date_posted: null,
      contact_name: null,
      contact_role: null,
      email,
      email_status: email ? 'Found' : 'Not found',
      confidence: contact.confidence || 'Low',
      score: scoreLead({ email, domain, snippet: item.snippet }),
      notes: item.snippet || null
    };

    leads.push(lead);
    onLead(lead);
    processed += 1;
    onProgress({ phase: 'checking-emails', processed, candidatesFound: candidateList.length, emailsFound, searchRequests, maxRequests, rawResults, excluded, duplicates });
  });

  leads.sort((a, b) => b.score - a.score || a.company_name.localeCompare(b.company_name));
  const stats = { processed, candidatesFound: candidateList.length, emailsFound, searchRequests, rawResults, excluded, duplicates };
  onProgress({ phase: 'completed', ...stats, maxRequests });
  return { mode: 'live', leads, stats };
}
