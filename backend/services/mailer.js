import nodemailer from 'nodemailer';

export function personalize(template, lead) {
  const values = {
    contact_name: lead.contact_name || 'Hiring Team',
    first_name: (lead.contact_name || 'Hiring Team').split(' ')[0],
    company_name: lead.company_name || '',
    job_title: lead.job_title || 'your current vacancies',
    location: lead.location || '',
    recruiter_name: process.env.FROM_NAME || 'Recruitment Team'
  };
  return String(template || '').replace(/{{\s*([a-z_]+)\s*}}/gi, (_, key) => values[key] ?? '');
}

export async function sendEmail({ lead, subject, body }) {
  if (!lead.email) throw new Error('No email address for this lead.');
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Email is not configured. Missing: ${missing.join(', ')}`);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const finalSubject = personalize(subject, lead);
  const finalBody = personalize(body, lead);
  await transporter.sendMail({
    from: `${process.env.FROM_NAME || 'Recruitment Team'} <${process.env.FROM_EMAIL}>`,
    to: lead.email,
    subject: finalSubject,
    text: finalBody
  });
  return { recipient: lead.email, subject: finalSubject, body: finalBody };
}
