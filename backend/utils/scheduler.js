// In-process scheduler for "send later" jobs.
//
// Deliberately dependency-free: one setTimeout per pending job, re-armed at
// boot from scheduleStore.json. Node's setTimeout caps at ~24.8 days, so longer
// waits are chained in chunks.
//
// IMPORTANT: this only fires while the process is running. That is why the
// backend is meant to be deployed somewhere always-on (see DEPLOY.md) -
// Gmail's own "Schedule send" is a UI-only feature and is not reachable over
// SMTP or the Gmail API, so the sending side must be awake at send time.

import * as store from './scheduleStore.js';

const MAX_TIMEOUT = 2 ** 31 - 1; // ~24.8 days

/** id -> Timeout */
const timers = new Map();

/** Injected by server.js to avoid a circular import with the route module. */
let runner = null;

export function setRunner(fn) {
  runner = fn;
}

function clearTimer(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

async function fire(id) {
  timers.delete(id);

  const job = await store.getJob(id);
  if (!job || job.status === 'cancelled' || job.status === 'done') return;
  if (typeof runner !== 'function') {
    console.error(`Scheduler has no runner; cannot execute job ${id}`);
    return;
  }

  console.log(`Scheduled job firing: ${job.label || id}`);
  await store.updateJob(id, { status: 'running', startedAt: new Date().toISOString() });

  try {
    const summary = await runner(job);
    await store.updateJob(id, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      progress: {
        sent: summary.successCount,
        failed: summary.failCount,
        total: job.candidates.length,
      },
      results: summary.results,
    });
    console.log(
      `Scheduled job done: ${job.label || id} - ${summary.successCount} sent, ${summary.failCount} failed`
    );
  } catch (err) {
    await store.updateJob(id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: err.message,
    });
    console.error(`Scheduled job failed: ${job.label || id} - ${err.message}`);
  }
}

/** Arm (or re-arm) a timer for one job, chunking waits beyond setTimeout's cap. */
export function arm(job) {
  clearTimer(job.id);
  if (job.status !== 'scheduled') return;

  const delay = new Date(job.runAt).getTime() - Date.now();

  if (Number.isNaN(delay)) {
    console.error(`Job ${job.id} has an invalid runAt: ${job.runAt}`);
    return;
  }

  // Past due (e.g. the server was down when it should have run) -> catch up.
  if (delay <= 0) {
    setImmediate(() => fire(job.id));
    return;
  }

  if (delay > MAX_TIMEOUT) {
    const t = setTimeout(() => arm(job), MAX_TIMEOUT);
    if (t.unref) t.unref();
    timers.set(job.id, t);
    return;
  }

  const t = setTimeout(() => fire(job.id), delay);
  timers.set(job.id, t);
}

export function cancel(id) {
  clearTimer(id);
}

/** Re-arm everything still pending. Call once at boot. */
export async function restore() {
  const pending = await store.pendingJobs();

  for (const job of pending) {
    // A job left 'running' by a crash never completed - re-run it.
    if (job.status === 'running') {
      await store.updateJob(job.id, { status: 'scheduled' });
      job.status = 'scheduled';
    }
    arm(job);
  }

  if (pending.length) {
    console.log(`Scheduler restored ${pending.length} pending job(s)`);
  }
  return pending.length;
}

export function activeTimerCount() {
  return timers.size;
}
