// Follow-up store, grouped by upload batch.
//
// Shape (v2):
//   {
//     "version": 2,
//     "batches": {
//       "<batchId>": {
//         "id": "...",
//         "label": "candidates.csv",
//         "createdAt": "2026-09-02T...",
//         "candidates": { "<email>": { messageId, subject, ... } }
//       }
//     }
//   }
//
// Grouping by batch means uploading a second CSV does not merge into the first,
// so follow-ups can be sent per file instead of to everyone at once.
//
// A v1 flat store ({ [email]: entry }) is migrated on first read into a single
// "legacy" batch, so existing data keeps working.
//
// All writes go through one in-process promise chain so concurrent requests
// cannot clobber each other's read-modify-write.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const STORE_PATH = process.env.MESSAGE_STORE_PATH
  ? path.resolve(process.env.MESSAGE_STORE_PATH)
  : path.resolve(process.cwd(), 'messageStore.json');

let writeChain = Promise.resolve();

export function newBatchId() {
  return `b_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function emptyStore() {
  return { version: 2, batches: {} };
}

/** Wrap a legacy flat store into a single batch. */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  if (raw.version === 2 && raw.batches) return raw;

  const entries = Object.entries(raw).filter(
    ([, v]) => v && typeof v === 'object' && v.messageId
  );
  if (!entries.length) return emptyStore();

  return {
    version: 2,
    batches: {
      legacy: {
        id: 'legacy',
        label: 'Earlier sends',
        createdAt: new Date().toISOString(),
        candidates: Object.fromEntries(entries),
      },
    },
  };
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    return migrate(JSON.parse(raw || '{}'));
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

/** Drop batches that no longer have any pending candidate. */
function prune(data) {
  for (const [id, batch] of Object.entries(data.batches)) {
    if (!batch.candidates || Object.keys(batch.candidates).length === 0) {
      delete data.batches[id];
    }
  }
  return data;
}

/** Whole store (already migrated). */
export async function getAll() {
  return readStore();
}

/**
 * Batch summaries, newest first — no candidate payloads.
 * [{ id, label, createdAt, count }]
 */
export async function listBatches() {
  const data = await readStore();
  return Object.values(data.batches)
    .map((b) => ({
      id: b.id,
      label: b.label,
      createdAt: b.createdAt,
      count: Object.keys(b.candidates || {}).length,
    }))
    .filter((b) => b.count > 0)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Pending candidates. Pass a batchId to scope to one upload;
 * omit it to get every batch (each row carries its batchId/batchLabel).
 */
export async function listCandidates(batchId) {
  const data = await readStore();
  const batches = batchId
    ? [data.batches[batchId]].filter(Boolean)
    : Object.values(data.batches);

  return batches.flatMap((b) =>
    Object.entries(b.candidates || {}).map(([email, entry]) => ({
      email,
      batchId: b.id,
      batchLabel: b.label,
      ...entry,
    }))
  );
}

/**
 * Look up one candidate. Scoped to a batch when given, otherwise the most
 * recently updated entry for that address across batches.
 */
export async function get(email, batchId) {
  const data = await readStore();

  if (batchId) {
    const entry = data.batches[batchId]?.candidates?.[email];
    return entry ? { ...entry, batchId } : undefined;
  }

  let best;
  for (const b of Object.values(data.batches)) {
    const entry = b.candidates?.[email];
    if (!entry) continue;
    if (!best || String(entry.updatedAt) > String(best.updatedAt)) {
      best = { ...entry, batchId: b.id };
    }
  }
  return best;
}

/** Insert/overwrite one candidate inside a batch. */
export async function save(email, entry, { batchId, label } = {}) {
  const id = batchId || 'unfiled';

  return serialize(async () => {
    const data = await readStore();

    if (!data.batches[id]) {
      data.batches[id] = {
        id,
        label: label || id,
        createdAt: new Date().toISOString(),
        candidates: {},
      };
    }
    if (label && data.batches[id].label !== label) {
      data.batches[id].label = label;
    }

    const batch = data.batches[id];
    batch.candidates[email] = {
      ...batch.candidates[email],
      ...entry,
      updatedAt: new Date().toISOString(),
    };

    await write(data);
    return batch.candidates[email];
  });
}

/** Remove one candidate (after a successful follow-up). */
export async function remove(email, batchId) {
  return serialize(async () => {
    const data = await readStore();

    if (batchId) {
      if (data.batches[batchId]?.candidates) {
        delete data.batches[batchId].candidates[email];
      }
    } else {
      for (const b of Object.values(data.batches)) {
        if (b.candidates) delete b.candidates[email];
      }
    }

    await write(prune(data));
  });
}

/** Remove an entire batch. */
export async function removeBatch(batchId) {
  return serialize(async () => {
    const data = await readStore();
    delete data.batches[batchId];
    await write(data);
  });
}

export { STORE_PATH };
