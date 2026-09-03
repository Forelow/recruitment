import axios from 'axios';
import * as cheerio from 'cheerio';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const GOOD_EMAIL_HINTS = ['hr', 'career', 'careers', 'talent', 'recruit', 'jobs', 'people'];

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function scoreEmail(email) {
  const lower = email.toLowerCase();
  return GOOD_EMAIL_HINTS.some(h => lower.includes(h)) ? 2 : 1;
}

export async function findBusinessContact(url) {
  const base = cleanUrl(url);
  if (!base) return {};

  const urls = [url, `${base}/contact`, `${base}/careers`, `${base}/about`];
  const emails = new Set();

  for (const target of urls) {
    try {
      const res = await axios.get(target, {
        timeout: 6000,
        maxContentLength: 1_500_000,
        headers: { 'User-Agent': 'RecruitmentLeadResearch/1.0 (+human-reviewed outreach)' }
      });
      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('text/html')) continue;
      const $ = cheerio.load(res.data);
      $('script,style,noscript').remove();
      const text = $('body').text().replace(/\s+/g, ' ');
      (text.match(EMAIL_RE) || []).forEach(e => emails.add(e.toLowerCase()));
      $('a[href^="mailto:"]').each((_, el) => {
        const mail = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0];
        if (mail) emails.add(mail.toLowerCase());
      });
    } catch {
      // Ignore pages that block requests or do not exist.
    }
  }

  const sortedEmails = [...emails].sort((a, b) => scoreEmail(b) - scoreEmail(a));
  return {
    email: sortedEmails[0] || null,
    confidence: sortedEmails.length ? (scoreEmail(sortedEmails[0]) === 2 ? 'High' : 'Medium') : 'Low'
  };
}
