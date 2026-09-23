# CSV Email Sender

Bulk cold-outreach mailer with **threaded, multi-step follow-ups**.

Upload a CSV of contacts **or enter a recipient manually**, review/edit the copy,
send personalized emails through Gmail one at a time, and later reply in the *same
Gmail thread* — first a nudge, then a short, apologetic final note.

```
backend/    Express + Nodemailer API
frontend/   React (Vite) UI
```

## How it works

1. `POST /api/uploadCSV` stores a CSV; the UI fetches it back and parses it with PapaParse.
   A single recipient can also be entered directly in the UI, so a CSV is optional.
2. `POST /api/sendCustomEmails` sends each mail sequentially (`SEND_DELAY_MS` apart) and
   records the resulting `Message-ID` in `messageStore.json`.
3. `GET /api/followups` lists everyone still awaiting a reply, tagged with the step
   they are on (follow-up 1 or 2).
4. `POST /api/sendFollowUpEmails` replies with `inReplyTo` + `references` so Gmail threads it:
   follow-up 1 nudges, follow-up 2 is a short apologetic note that thanks them for their time,
   and the entry is removed once the last step has gone out — so nobody is chased twice.

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

Seven render modes, chosen per send with the `theme` field (the UI has a picker
and every CSV row previews in the selected theme).

**Risk** = chance Gmail files it under Promotions instead of Primary. For cold
outreach, lower is better.

| Theme | Look | Risk |
| --- | --- | --- |
| `plain` *(default)* | Near-raw HTML in a 600px column. Reads person-to-person. | low |
| `minimal` | Accent hairline over a name block. Safest visual upgrade. | low |
| `sidebar` | Full-height colour bar down the left edge. | low |
| `resume` | Two-column header with a "Selected Work" table. Formal, CV-like. | medium |
| `editorial` | Serif, airy, numbered highlights. Warm — good for longer notes. | medium |
| `branded` | Wordmark header, gold accent panel, CTA button, dark footer. | medium |
| `terminal` | Dark card, mono type, shell prompt. Great for eng teams. | high |

`GET /api/themes` returns the list with labels and risk. `GET /api/gallery`
renders all seven side by side with sample content.

All themes are typographic — **no logo image is required**, so nothing breaks when
a client blocks remote images. In every theme except `plain`, any `<ul>` in your
template is lifted out and rendered in that theme's own highlight treatment
(em-dashes, `+` markers, a numbered list, or a bordered table).

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

Each card also has a **theme dropdown** — give one recipient Terminal and another
Editorial while the rest inherit the batch theme. Overridden rows show a purple
badge, and the header counts how many are custom. An unknown per-row theme falls
back to the batch default rather than failing.

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

### Pre-send check and contact history

Parsing a CSV runs a read-only validation pass before anything is sent:

- **Invalid addresses** are rejected outright and can never be sent.
- **Duplicates** inside the file are flagged (case-insensitively).
- **Anyone already emailed** is flagged with how long ago and how many times.
- Missing name / company are flagged as warnings.

Flagged rows are pre-ticked to skip; untick to send anyway. `contactStore.json`
is a permanent log of every send (initial and follow-up) and is never pruned,
which is what makes the "already emailed 3 days ago" warning possible.

```
POST   /api/validate         annotate rows; sends nothing, writes nothing
GET    /api/contacts?search= everyone ever emailed + totals
GET    /api/contacts/:email  one contact with full send history
DELETE /api/contacts/:email  forget someone (stops them being flagged)
```

The "recently contacted" window defaults to 30 days (`RECENT_CONTACT_DAYS`). Each
history entry is tagged with what it was — `initial`, `followup` or `followup2`
(plus the step number in `followUpStage`).

### Send now or save for later

After parsing a CSV you can **Send Now**, or **Save for Later** to park the batch
on the server. A saved batch sends only when you press **Send now** on it —
nothing fires on a timer, so the server does not need to be running in between.

```
GET    /api/drafts           saved batches (summaries)
GET    /api/drafts/:id       one batch with its candidates
POST   /api/drafts           save a batch
POST   /api/drafts/:id/send  send it now
DELETE /api/drafts/:id       discard without sending
```

A batch is removed from the saved list once sent. If any recipient fails it is
kept so you can retry.

### Follow-ups are grouped per batch

Each CSV upload or manual recipient group becomes its own **batch**, so a second
upload does not merge into the first and one-off sends remain separate. You can
follow up one group at a time instead of mailing everyone at once, and each batch
can be discarded without sending.

```
GET    /api/followups                 all pending, each row tagged with its batch and step
GET    /api/followups?batchId=...     just that upload
GET    /api/followups/batches         batch summaries (label, count, createdAt, pendingByStage)
POST   /api/sendFollowUpEmails        { batchId, stage } follows up that whole batch
DELETE /api/followups/batches/:id     discard without emailing
```

`pendingByStage` on a batch summary counts the people waiting for each step, e.g.
`{"1": 3, "2": 1}` — that is what the UI turns into one button per step.

`messageStore.json` is versioned; v1 (flat) and v2 (batches, no thread info)
stores are migrated on first read, so existing data keeps working.

### Follow-up chains: nudge, then a final note

Every batch keeps its own reply chain — initial mail → **Follow-up 1** →
**Follow-up 2**. Each step goes only to the people actually waiting for it:
somebody who just received follow-up 1 is not also chased with follow-up 2 in the
same run, and the server refuses a request that would send the wrong step
(`skipped`, with `Awaiting follow-up N`). The contact leaves the queue after the
last step.

`inReplyTo` points at the newest message in the conversation and `references`
carries all of it, so reply-under-reply nests correctly in Gmail:

```
initial              <root@id>
  └─ follow-up 1     in-reply-to: <root@id>     references: <root@id>
       └─ follow-up 2  in-reply-to: <fu1@id>    references: <root@id> <fu1@id>
```

The copy for each step lives on the server (`backend/utils/followUps.js`), so the
UI editor and the send route fall back to the same text; a blank subject/body in
a request means "use the built-in copy for that step".

```
GET  /api/followups/templates   built-in copy per step + how many steps (MAX_FOLLOW_UPS)
GET  /api/followups?stage=2     only the people waiting for follow-up 2
```

```bash
# follow-up 2 for a whole upload, using the built-in final note
curl -X POST localhost:3000/api/sendFollowUpEmails -H 'content-type: application/json' \
  -d '{"batchId":"b_abc","stage":2}'
```

`stage` is optional and defaults to whatever each candidate is waiting for.
`MAX_FOLLOW_UPS` (default `2`, max `5`) sets how many steps the chain has — raise
it and an extra editor block plus an extra batch button appear; set it to `1` for
the old single-follow-up behaviour.

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

## Manual recipient entry

A CSV is not required for a one-off email. In the **Recipients** card, fill in the
recipient's name, email, company and job description; CC and job ID are optional.
**Add recipient** puts the row through the normal validation and preview flow.
**Add and send now** validates it and sends that one email immediately using the
shared subject, body and selected theme. Manual recipients are stored in a batch
labelled `Manual recipients`, so their Gmail thread remains available for the same
follow-up workflow as CSV recipients.

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
| `DRAFT_STORE_PATH` | `./draftStore.json` | Saved batches file |
| `CONTACT_STORE_PATH` | `./contactStore.json` | Permanent contact/send log |
| `RECENT_CONTACT_DAYS` | `30` | Window for the "already emailed" warning |
| `MAX_FOLLOW_UPS` | `2` | Follow-up steps per contact (1–5) |

## Notes on the rewrite

Consolidated from an earlier single-file draft:

- One follow-up implementation instead of three (the duplicate referenced an out-of-scope `app`).
- Subject/template textareas are now actually sent — the shared copy is passed with each request.
- `messageStore.json` access is serialized and entries are deleted after a successful follow-up.
- Path-traversal guard on the CSV download route; `.csv`-only upload filter with a size cap.
- Shared Nodemailer transporter (pooled) and shared template helpers in `backend/utils/`.
- Secrets, uploads and the message store are gitignored.
