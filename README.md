# Recruitment Email Finder — Version 1 MVP

This MVP implements the core flow:

1. Click one button to search for Singapore companies that appear to be hiring.
2. Filter obvious government/recruitment-agency results.
3. Collect a public business email from the company website.
4. Store and de-duplicate leads in a lightweight local JSON file.
5. Inspect and select individual companies or Select All.
6. Write one email template using variables.
7. Preview personalised outreach per company.
8. Send each email individually and record the result.

## Important design choice

The app does **not** send during discovery. A human must review/select leads and explicitly press Send. This makes accidental or inappropriate bulk outreach less likely.

## 1. Install backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Backend runs at `http://localhost:4000`.

If `SERPAPI_API_KEY` is blank, discovery runs in **demo mode** so the rest of the application can be tested immediately.

### Live discovery

Create a SerpApi account, copy the private API key from its dashboard, then set:

```env
SERPAPI_API_KEY=your-serpapi-key
```

No `cx` value is needed. The connector requests Singapore-focused Google results through SerpApi, locates relevant public company pages, and then attempts to read a public business email from the returned company site. Results without an email address are not added to the list.

## 2. Configure email

Set the SMTP values in `backend/.env`. For Gmail, use an app password rather than your normal account password.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@example.com
SMTP_PASS=your-app-password
FROM_EMAIL=you@example.com
FROM_NAME=Your Name
```

## 3. Install frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

## Template variables

- `{{contact_name}}`
- `{{first_name}}`
- `{{company_name}}`
- `{{job_title}}`
- `{{location}}`
- `{{recruiter_name}}`

## Current Version 1 limitations

- Search connector processes at most 10 SerpApi results per request.
- Company-name extraction is heuristic and should later be improved.
- Contact discovery is intentionally conservative and only checks a few public pages on the company domain.
- It does not bypass CAPTCHAs, authentication, anti-bot controls or site restrictions.
- No automated follow-up/reply tracking yet.
- No multi-user authentication yet.
- Named HR-contact extraction is not yet AI-enriched.

## Recommended next development steps

1. Add additional permitted discovery connectors.
2. Add stronger company classification and Singapore-local-company verification.
3. Add editable company/contact records inside the detail panel.
4. Add suppression / Do Not Contact list.
5. Add campaign history and reply tracking.
6. Deploy frontend and backend.
