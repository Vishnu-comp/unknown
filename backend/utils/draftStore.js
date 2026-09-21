// Saved batches ("send later").
//
// No timers, no scheduling: a saved batch just sits on disk until you press
// Send. Nothing fires on its own, so the server does not need to be running
// at any particular moment.
//
// Shape:
//   { "version": 1, "drafts": { "<id>": { ...draft } } }
//
// A draft:
//   { id, label, createdAt, updatedAt, note,
//     candidates: [...], emailSubject, emailTemplate, theme,
//     batchId, batchLabel }

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const STORE_PATH = process.env.DRAFT_STORE_PATH
  ? path.resolve(process.env.DRAFT_STORE_PATH)
  : path.resolve(process.cwd(), 'draftStore.json');

let writeChain = Promise.resolve();

export function newDraftId() {
  return `d_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function emptyStore() {
  return { version: 1, drafts: {} };
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return parsed.drafts ? parsed : emptyStore();
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

/** Light summaries for the list view — no bulky candidate payloads. */
function summarize(d) {
  return {
    id: d.id,
    label: d.label,
    note: d.note,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    theme: d.theme,
    recipientCount: Array.isArray(d.candidates) ? d.candidates.length : 0,
    recipients: Array.isArray(d.candidates) ? d.candidates.slice(0, 5).map((c) => c.email) : [],
  };
}

export async function listDrafts() {
  const data = await readStore();
  return Object.values(data.drafts)
    .map(summarize)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getDraft(id) {
  const data = await readStore();
  return data.drafts[id];
}

export async function saveDraft(draft) {
  return serialize(async () => {
    const data = await readStore();
    data.drafts[draft.id] = draft;
    await write(data);
    return draft;
  });
}

export async function removeDraft(id) {
  return serialize(async () => {
    const data = await readStore();
    delete data.drafts[id];
    await write(data);
  });
}

export { STORE_PATH };
