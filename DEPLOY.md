# Deploying the backend (so scheduled sends actually fire)

## Why this is needed

Gmail's **Schedule send** exists only in the Gmail web and mobile apps. It is not
exposed through the Gmail API or SMTP, so an app like this one cannot ask Gmail
to hold a message and deliver it later. Google's issue tracker has had an open
request for it for years, and other Gmail clients hit the same wall.

The consequence: **something you control must be awake at the scheduled moment**
to actually hand the message to Gmail. Locally that means `npm start` has to be
running. Deploy the backend to an always-on host and schedules fire even with
your laptop shut.

## What must persist

Two JSON files hold state:

| File | Holds |
| --- | --- |
| `scheduleStore.json` | queued send jobs |
| `messageStore.json` | Message-IDs for follow-up threading, grouped by batch |

On hosts with an **ephemeral filesystem** (Railway, Render free tier, Fly without
a volume) these are wiped on every redeploy and on some restarts. Attach a
persistent disk and point the app at it:

```
SCHEDULE_STORE_PATH=/data/scheduleStore.json
MESSAGE_STORE_PATH=/data/messageStore.json
```

Without a volume a redeploy loses queued jobs. Restarts alone are fine — the
scheduler re-arms from disk at boot, and a job whose time passed while the
process was down fires immediately on startup (catch-up).

## Environment variables

```
EMAIL_USERNAME=you@gmail.com
EMAIL_PASSWORD=<16-char Google App Password>
PORT=3000
HOST=0.0.0.0
SEND_DELAY_MS=15000
SCHEDULE_STORE_PATH=/data/scheduleStore.json
MESSAGE_STORE_PATH=/data/messageStore.json
```

Never commit these. Set them in the host's dashboard.

## Render

`render.yaml` is included. Push the repo, then in Render: **New → Blueprint**,
pick this repo. Set `EMAIL_USERNAME` / `EMAIL_PASSWORD` in the dashboard.

Note the free tier **sleeps after ~15 minutes idle** — a sleeping instance has no
timers running. It wakes on an HTTP request, and the scheduler's catch-up will
then send anything overdue, but delivery is late by however long it slept. For
punctual sends use a paid instance or ping the service (e.g. UptimeRobot hitting
`/api/health` every 10 minutes).

## Railway

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Set the root directory to `backend/`, add the env vars, and attach a volume
mounted at `/data`. Railway does not sleep, so timers keep running.

## Fly.io

```bash
fly launch --no-deploy          # in backend/
fly volumes create data --size 1
fly secrets set EMAIL_USERNAME=... EMAIL_PASSWORD=...
fly deploy
```

Mount the volume at `/data` in `fly.toml`. Set `min_machines_running = 1` —
otherwise Fly stops the machine when idle and timers stop with it.

## Docker

A `Dockerfile` is included in `backend/`:

```bash
docker build -t csv-mailer ./backend
docker run -d --restart unless-stopped \
  -p 3000:3000 \
  -e EMAIL_USERNAME=you@gmail.com \
  -e EMAIL_PASSWORD=app-password \
  -e SCHEDULE_STORE_PATH=/data/scheduleStore.json \
  -e MESSAGE_STORE_PATH=/data/messageStore.json \
  -v csv-mailer-data:/data \
  csv-mailer
```

## Pointing the frontend at a deployed backend

The UI calls relative `/api` paths. For a separately hosted backend, build with:

```bash
VITE_API_BASE_URL=https://your-backend.onrender.com/api npm run build
```

## Sanity checks after deploying

```bash
curl https://your-backend/api/health      # {"ok":true}
curl https://your-backend/api/schedule    # jobs + serverTime + activeTimers
```

`serverTime` is worth checking — the host runs in UTC while you schedule in IST.
The UI sends an absolute ISO instant, so the conversion is handled, but a wildly
wrong `serverTime` means the host's clock is off.

## Deliverability reminder

A cloud host does not change Gmail's limits: roughly 500 recipients/day on a
free account. Keep `SEND_DELAY_MS` at 15s or higher.
