# CSV Email Sender

Bulk cold-outreach mailer with **threaded follow-ups**.

Upload a CSV of contacts, review/edit the copy, send personalized emails through
Gmail one at a time, and later reply in the *same Gmail thread* with a follow-up.

```
backend/    Express + Nodemailer API
frontend/   React (Vite) UI
```

## How it works

1. `POST /api/uploadCSV` stores the CSV; the UI fetches it back and parses it with PapaParse.
2. `POST /api/sendCustomEmails` sends each mail sequentially (`SEND_DELAY_MS` apart) and
   records the resulting `Message-ID` in `messageStore.json`.
3. `GET /api/followups` lists everyone with a stored `Message-ID`.
4. `POST /api/sendFollowUpEmails` replies with `inReplyTo` + `references` so Gmail threads it,
   then removes the entry so nobody is chased twice.

Placeholders substituted per candidate: `[user name]`, `[company name]`,
`[job description]`, `[job id]`.

## Running it

### Backend

```bash
cd backend
npm install
cp .env.example .env      # set EMAIL_USERNAME + a Google App Password
npm start                 # http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Vite proxies `/api` to `http://127.0.0.1:3000` (override with `BACKEND_URL`), so the browser
only ever uses relative URLs — no hardcoded `localhost` in the app code.

## CSV format

```csv
name,email,cc,companyName,jobDescription,jobId
Asha Rao,asha@example.com,,Acme Corp,Software Engineer,ENG-101
```

`name` and `email` are required; rows missing either are skipped. Optional
`emailSubject` / `emailTemplate` columns override the shared copy for that row.
See `backend/sample-candidates.csv`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMAIL_USERNAME` | – | Gmail sender address |
| `EMAIL_PASSWORD` | – | Google **App Password** |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | API bind |
| `SEND_DELAY_MS` | `15000` | Pause between mails in a batch |
| `ATTACHMENT_PATH` | `backend/assets/resume.pdf` | Optional PDF attached to initial mails (skipped if missing) |
| `MESSAGE_STORE_PATH` | `./messageStore.json` | Follow-up state file |

## Notes on the rewrite

Consolidated from an earlier single-file draft:

- One follow-up implementation instead of three (the duplicate referenced an out-of-scope `app`).
- Subject/template textareas are now actually sent — the shared copy is passed with each request.
- `messageStore.json` access is serialized and entries are deleted after a successful follow-up.
- Path-traversal guard on the CSV download route; `.csv`-only upload filter with a size cap.
- Shared Nodemailer transporter (pooled) and shared template helpers in `backend/utils/`.
- Secrets, uploads and the message store are gitignored.
