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

### Optional placeholders

Wrap anything that should vanish when a CSV column is empty:

```
Opportunity at [company name][if job id] (Job ID: [job id])[/if job id]
```

With a job id  -> `Opportunity at KukuFM (Job ID: KF-42)`
Without one    -> `Opportunity at KukuFM`

Bare `[job id]` outside an `[if ...]` block is also cleaned up along with its
surrounding `(...)`, so you never get a dangling `(Job ID: )`.

### Themes

Two render modes, chosen per send with the `theme` field (UI has a radio picker):

| Theme | Look | Use for |
| --- | --- | --- |
| `plain` (default) | Near-raw HTML in a 600px column | **Cold outreach.** Reads person-to-person and lands in Gmail *Primary*. |
| `branded` | Wordmark header, gold accent rule, highlights panel, CTA button, dark footer | Warm contacts, post-interview follow-ups, design-conscious companies. |

The branded theme is typographic only — **no logo image is required**, so nothing
breaks when a client blocks remote images. In branded mode any `<ul>` in your
template is lifted out and rendered in the accent panel automatically.

Built for real mail clients: table layout, fully inline styles, no `<style>`
block, no JS, no web fonts, 600px cap, VML fallback for Outlook buttons, and a
hidden preheader for the inbox snippet.

Customize the sender identity with `BRAND_WORDMARK`, `BRAND_TAGLINE`,
`BRAND_ACCENT`, `BRAND_CTA_TEXT`, `BRAND_CTA_URL`.

### Preview / dry run

After parsing a CSV the UI renders **every row as its own preview card** — the real
email for that recipient, with their name, company and job id substituted. Click a
card to enlarge it; expand *Override template for this row* to give one person
different copy. Previews re-render automatically when you switch theme or edit the
shared subject/body (debounced).

`POST /api/preview/batch` powers this — it renders an array of candidates in one
call and never opens an SMTP connection.


`POST /api/preview` renders exactly what would be sent **without opening an SMTP
connection**. The UI shows it in a sandboxed iframe — hit *Preview (dry run)* for
a sample, or *Preview this* on any parsed row.

```bash
curl -X POST localhost:3000/api/preview -H 'content-type: application/json' \
  -d '{"candidate":{"name":"Vishnu","companyName":"KukuFM","jobDescription":"Backend Engineer"},
       "emailTemplate":"<p>Hi [user name]</p>","theme":"branded"}'
```

### Resume attachment

Drop your PDF at `backend/assets/resume.pdf` and it is attached to every initial
email. Any single `*.pdf` in `backend/assets/` is picked up too, or point
`ATTACHMENT_PATH` at a specific file. Check it is being found:

```bash
curl localhost:3000/api/attachment
# {"attached":true,"fileName":"resume.pdf","lookedIn":".../backend/assets"}
```

The file is resolved per send, so you can add it without restarting the server.
Note `backend/.gitignore` excludes `assets/*.pdf`, so your resume stays out of git.

## Running it

### Backend

```bash
cd backend
npm install
# create .env with EMAIL_USERNAME + a Google App Password (see table below)
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
| `ATTACHMENT_PATH` | auto-detected in `backend/assets/` | PDF attached to initial mails (skipped if missing) |
| `SMTP_REJECT_UNAUTHORIZED` | `true` | Set `false` only for self-signed dev SMTP |
| `BRAND_WORDMARK` | `Vishnu Nair` | Header wordmark (branded theme) |
| `BRAND_TAGLINE` | `Full Stack Developer` | Small caps line under the wordmark |
| `BRAND_ACCENT` | `#B8944D` | Accent colour |
| `BRAND_CTA_TEXT` / `BRAND_CTA_URL` | Portfolio link | Button in branded theme |
| `MESSAGE_STORE_PATH` | `./messageStore.json` | Follow-up state file |

## Notes on the rewrite

Consolidated from an earlier single-file draft:

- One follow-up implementation instead of three (the duplicate referenced an out-of-scope `app`).
- Subject/template textareas are now actually sent — the shared copy is passed with each request.
- `messageStore.json` access is serialized and entries are deleted after a successful follow-up.
- Path-traversal guard on the CSV download route; `.csv`-only upload filter with a size cap.
- Shared Nodemailer transporter (pooled) and shared template helpers in `backend/utils/`.
- Secrets, uploads and the message store are gitignored.
