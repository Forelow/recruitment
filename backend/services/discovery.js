import axios from 'axios';
import { findBusinessContact } from './contactFinder.js';

const EXCLUDED_TERMS = [
  'recruitment', 'recruiter', 'staffing', 'employment agency', 'manpower agency',
  'headhunter', 'headhunting', 'talent agency', 'executive search'
];

const GOVERNMENT_DOMAINS = ['.gov.sg'];

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function companyFromResult(title, domain) {
  let name = title
    .replace(/\s[-|–].*$/,'')
    .replace(/careers?|jobs?|vacancies|hiring/gi, '')
    .trim();
  if (!name || name.length < 2) name = domain.split('.')[0].replace(/[-_]/g, ' ');
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

function isExcluded(text, domain) {
  const hay = `${text} ${domain}`.toLowerCase();
  if (GOVERNMENT_DOMAINS.some(d => domain.endsWith(d))) return true;
  return EXCLUDED_TERMS.some(t => hay.includes(t));
}

function isLocalCompany(text, domain) {
  return domain.endsWith('.sg') || /\bsingapore\b|\bpte\.?\s*ltd\.?\b/i.test(text);
}

function scoreLead({ email, domain, snippet }) {
  let score = 50;
  if (email) score += 20;
  if (domain.endsWith('.sg') || domain.endsWith('.com.sg')) score += 15;
  if (/hiring|vacancy|vacancies|career|job opening|join us/i.test(snippet || '')) score += 10;
  return Math.min(score, 100);
}

const DEMO = [
  {
    company_name: 'Meridian Engineering Pte Ltd', website: 'https://example.com', domain: 'example.com',
    location: 'Singapore', job_title: 'Electrical Engineer', job_url: 'https://example.com/jobs/electrical-engineer',
    source: 'Demo data', contact_name: 'Hiring Team', contact_role: 'Human Resources', email: 'hr@example.com', confidence: 'High', score: 92
  },
  {
    company_name: 'Northstar Logistics Pte Ltd', website: 'https://example.org', domain: 'example.org',
    location: 'Singapore', job_title: 'Operations Executive', job_url: 'https://example.org/careers',
    source: 'Demo data', contact_name: null, contact_role: null, email: 'careers@example.org', confidence: 'Medium', score: 84
  },
  {
    company_name: 'Brightline Manufacturing Pte Ltd', website: 'https://example.net', domain: 'example.net',
    location: 'Singapore', job_title: 'Production Technician', job_url: 'https://example.net/jobs',
    source: 'Demo data', contact_name: null, contact_role: null, email: 'contact@example.net', confidence: 'Medium', score: 78
  }
];

export async function discoverLeads() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!key || !cx) return { mode: 'demo', leads: DEMO };

  const location = 'Singapore';
  const query = 'jobs hiring company Singapore -recruitment -staffing -agency -government';
  const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
    timeout: 12000,
    params: { key, cx, q: query, num: 10 }
  });

  const leads = [];
  for (const item of data.items || []) {
    const domain = domainFromUrl(item.link);
    const resultText = `${item.title} ${item.snippet}`;
    if (!domain || isExcluded(resultText, domain) || !isLocalCompany(resultText, domain)) continue;

    const companyName = companyFromResult(item.title, domain);
    const contact = await findBusinessContact(item.link);
    const website = (() => { try { const u = new URL(item.link); return `${u.protocol}//${u.host}`; } catch { return item.link; } })();

    if (!contact.email) continue;

    leads.push({
      company_name: companyName,
      website,
      domain,
      location,
      job_title: item.title,
      job_url: item.link,
      source: 'Google Programmable Search',
      date_posted: null,
      contact_name: null,
      contact_role: null,
      email: contact.email || null,
      confidence: contact.confidence || 'Low',
      score: scoreLead({ email: contact.email, domain, snippet: item.snippet }),
      notes: item.snippet || null
    });
  }

  return { mode: 'live', leads };
}
