// Persisted store for scheduled send jobs.
//
// Shape:
//   { "version": 1, "jobs": { "<id>": { ...job } } }
//
// A job:
//   {
//     id, label, status: 'scheduled'|'running'|'done'|'failed'|'cancelled',
//     runAt: ISO string, createdAt, startedAt, finishedAt,
//     candidates: [...], emailSubject, emailTemplate, theme,
//     batchId, batchLabel,
//     progress: { sent, failed, total }, results: [...], error
//   }
//
// Jobs survive restarts: anything still 'scheduled' is re-armed at boot, and a
// job whose time passed while the process was down fires immediately (catch-up).

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const STORE_PATH = process.env.SCHEDULE_STORE_PATH
  ? path.resolve(process.env.SCHEDULE_STORE_PATH)
  : path.resolve(process.cwd(), 'scheduleStore.json');

let writeChain = Promise.resolve();

export function newJobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function emptyStore() {
  return { version: 1, jobs: {} };
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed.jobs) return emptyStore();
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
}

function serialize(task) {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => {});
  return run;
}

async function write(data) {
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
}

/** Strip the bulky candidate payload for list views. */
function summarize(job) {
  const { candidates, emailTemplate, results, ...rest } = job;
  return {
    ...rest,
    recipientCount: Array.isArray(candidates) ? candidates.length : 0,
    recipients: Array.isArray(candidates)
      ? candidates.slice(0, 5).map((c) => c.email)
      : [],
  };
}

export async function listJobs() {
  const data = await readStore();
  return Object.values(data.jobs)
    .map(summarize)
    .sort((a, b) => String(a.runAt).localeCompare(String(b.runAt)));
}

export async function getJob(id) {
  const data = await readStore();
  return data.jobs[id];
}

export async function createJob(job) {
  return serialize(async () => {
    const data = await readStore();
    data.jobs[job.id] = job;
    await write(data);
    return job;
  });
}

export async function updateJob(id, patch) {
  return serialize(async () => {
    const data = await readStore();
    if (!data.jobs[id]) return undefined;
    data.jobs[id] = { ...data.jobs[id], ...patch };
    await write(data);
    return data.jobs[id];
  });
}

export async function removeJob(id) {
  return serialize(async () => {
    const data = await readStore();
    delete data.jobs[id];
    await write(data);
  });
}

/** Jobs that still need to run (used to re-arm timers at boot). */
export async function pendingJobs() {
  const data = await readStore();
  return Object.values(data.jobs).filter(
    (j) => j.status === 'scheduled' || j.status === 'running'
  );
}

export { STORE_PATH };
