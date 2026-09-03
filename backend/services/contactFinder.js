import axios from 'axios';
import * as cheerio from 'cheerio';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const GOOD_EMAIL_HINTS = ['hr', 'career', 'careers', 'talent', 'recruit', 'jobs', 'people'];
const BAD_EMAIL_HINTS = ['noreply', 'no-reply', 'donotreply', 'example.com', 'email.com', 'sentry.io'];

function cleanUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function domainFromEmail(email) {
  return email.split('@')[1]?.toLowerCase() || '';
}

function isUsableEmail(email) {
  const value = email.toLowerCase().replace(/[),.;:]+$/, '');
  return value.includes('@') && !BAD_EMAIL_HINTS.some(hint => value.includes(hint));
}

function scoreEmail(email, websiteDomain) {
  const value = email.toLowerCase();
  let score = 1;
  if (GOOD_EMAIL_HINTS.some(hint => value.includes(hint))) score += 3;
  if (domainFromEmail(value) === websiteDomain || domainFromEmail(value).endsWith(`.${websiteDomain}`)) score += 2;
  if (/^(info|contact|hello|admin|enquir|support)/.test(value)) score += 1;
  return score;
}

async function emailsFromPage(target, timeout) {
  try {
    const response = await axios.get(target, {
      timeout,
      maxContentLength: 1_500_000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'RecruitmentLeadResearch/1.0 (+human-reviewed outreach)' }
    });
    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html')) return [];

    const $ = cheerio.load(response.data);
    $('script,style,noscript').remove();
    const found = new Set(($('body').text().match(EMAIL_RE) || []).map(email => email.toLowerCase()));
    $('a[href^="mailto:"]').each((_, element) => {
      const email = ($(element).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (email) found.add(email);
    });
    return [...found].filter(isUsableEmail);
  } catch {
    return [];
  }
}

export async function findBusinessContact(url) {
  const base = cleanUrl(url);
  if (!base) return { email: null, confidence: 'Low' };

  const websiteDomain = new URL(base).hostname.replace(/^www\./, '');
  const timeout = Math.min(Math.max(Number(process.env.CONTACT_TIMEOUT_MS) || 6000, 2000), 15000);
  const firstStage = [...new Set([url, base, `${base}/contact`, `${base}/contact-us`, `${base}/careers`])];
  const secondStage = [`${base}/jobs`, `${base}/join-us`, `${base}/work-with-us`, `${base}/about`, `${base}/about-us`];
  const emails = new Set((await Promise.all(firstStage.map(page => emailsFromPage(page, timeout)))).flat());

  if (![...emails].some(email => GOOD_EMAIL_HINTS.some(hint => email.includes(hint)))) {
    const additional = await Promise.all(secondStage.map(page => emailsFromPage(page, timeout)));
    additional.flat().forEach(email => emails.add(email));
  }

  const sorted = [...emails].sort((a, b) => scoreEmail(b, websiteDomain) - scoreEmail(a, websiteDomain));
  const email = sorted[0] || null;
  const score = email ? scoreEmail(email, websiteDomain) : 0;
  return { email, confidence: score >= 5 ? 'High' : score >= 2 ? 'Medium' : 'Low' };
}
