// Follow-up store, grouped by upload batch and tracking the whole reply chain.
//
// Shape (v3):
//   {
//     "version": 3,
//     "batches": {
//       "<batchId>": {
//         "id": "...",
//         "label": "candidates.csv",
//         "createdAt": "2026-09-02T...",
//         "candidates": {
//           "<email>": {
//             "email", "messageId", "subject", "name", "companyName", ...,
//             "followUpsSent": 1,
//             "thread": ["<root@id>", "<follow-up-1@id>"],
//             "followUps": [ { stage, messageId, subject, sentAt } ],
//             "updatedAt": "..."
//           }
//         }
//       }
//     }
//   }
//
// `thread` is the ordered list of Message-IDs in the conversation, root first.
// A follow-up replies to the *last* one and references the whole list, which is
// what nests reply-under-reply correctly in Gmail.
//
// A candidate is only removed once MAX_FOLLOW_UPS follow-ups have gone out, so
// the same entry powers follow-up 1 and follow-up 2 (and any further step).
//
// Older shapes are migrated on read:
//   v1  { "<email>": { messageId, ... } }                  -> one "legacy" batch
//   v2  { version: 2, batches: { id: { candidates } } }    -> same + thread info
//
// All writes go through one in-process promise chain so concurrent requests
// cannot clobber each other's read-modify-write.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import { MAX_FOLLOW_UPS, followUpsSent, nextFollowUp } from './followUps.js';

const STORE_PATH = process.env.MESSAGE_STORE_PATH
  ? path.resolve(process.env.MESSAGE_STORE_PATH)
  : path.resolve(process.cwd(), 'messageStore.json');

let writeChain = Promise.resolve();

export function newBatchId() {
  return `b_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function emptyStore() {
  return { version: 3, batches: {} };
}

/** Fields the store derives on read - never persist them back into the file. */
const DERIVED_KEYS = ['stage', 'nextFollowUp', 'threadLength', 'lastMessageId', 'lastSentAt', 'finished'];

function stripDerived(entry) {
  const clean = { ...entry };
  for (const key of DERIVED_KEYS) delete clean[key];
  return clean;
}

/**
 * Bring one stored candidate up to the current shape: always has a thread
 * (root first) and a followUpsSent count, whatever version wrote it.
 */
function normalizeEntry(email, entry) {
  const clean = stripDerived(entry || {});
  const followUps = Array.isArray(clean.followUps) ? clean.followUps.filter(Boolean) : [];

  const thread = Array.isArray(clean.thread) ? clean.thread.filter(Boolean) : [];
  const root = clean.messageId || thread[0];
  const rebuilt = [root, ...thread.slice(1), ...followUps.map((f) => f.messageId)].filter(Boolean);

  // De-duplicate while keeping order (a re-sent initial mail can repeat an id).
  const seen = new Set();
  const deduped = rebuilt.filter((id) => (seen.has(id) ? false : seen.add(id)));

  return {
    ...clean,
    ...(email ? { email } : {}),
    messageId: root || clean.messageId,
    followUps,
    thread: deduped,
    followUpsSent: Math.min(followUpsSent(clean), MAX_FOLLOW_UPS),
  };
}

function normalizeBatch(id, batch) {
  const candidates = {};
  for (const [email, entry] of Object.entries(batch?.candidates || {})) {
    if (!entry || typeof entry !== 'object') continue;
    candidates[email] = normalizeEntry(email, entry);
  }
  return {
    id: batch?.id || id,
    label: batch?.label || id,
    createdAt: batch?.createdAt || new Date().toISOString(),
    candidates,
  };
}

/** Wrap any older store shape into v3. */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();

  if (raw.version === 3 && raw.batches) {
    const batches = {};
    for (const [id, batch] of Object.entries(raw.batches)) batches[id] = normalizeBatch(id, batch);
    return { version: 3, batches };
  }

  if (raw.version === 2 && raw.batches) {
    const batches = {};
    for (const [id, batch] of Object.entries(raw.batches)) batches[id] = normalizeBatch(id, batch);
    return { version: 3, batches };
  }

  // v1: flat map of email -> entry.
  const entries = Object.entries(raw).filter(
    ([, v]) => v && typeof v === 'object' && (v.messageId || v.email)
  );
  if (!entries.length) return emptyStore();

  return {
    version: 3,
    batches: {
      legacy: normalizeBatch('legacy', {
        id: 'legacy',
        label: 'Earlier sends',
        createdAt: new Date().toISOString(),
        candidates: Object.fromEntries(entries),
      }),
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

/**
 * Public view of a stored candidate: the raw entry plus the derived "where is
 * this conversation up to" fields the UI and the API need.
 */
function decorate(entry, batch) {
  const thread = entry.thread || [];
  const next = nextFollowUp(entry);

  return {
    ...entry,
    batchId: batch?.id,
    batchLabel: batch?.label,
    stage: followUpsSent(entry),
    nextFollowUp: next,
    threadLength: thread.length,
    lastMessageId: thread[thread.length - 1] || entry.messageId,
    lastSentAt: entry.followUps?.length
      ? entry.followUps[entry.followUps.length - 1].sentAt || entry.updatedAt
      : entry.sentAt,
    finished: next > MAX_FOLLOW_UPS,
  };
}

/** Whole store (already migrated). */
export async function getAll() {
  return readStore();
}

/**
 * Batch summaries, newest first — no candidate payloads.
 * `pendingByStage` counts candidates by the follow-up they are waiting for,
 * e.g. { "1": 3 } = three people are still on follow-up 1.
 * [{ id, label, createdAt, count, pendingByStage }]
 */
export async function listBatches() {
  const data = await readStore();
  return Object.values(data.batches)
    .map((b) => {
      const entries = Object.values(b.candidates || {});
      const pendingByStage = {};
      for (const entry of entries) {
        const next = nextFollowUp(entry);
        if (next > MAX_FOLLOW_UPS) continue;
        pendingByStage[next] = (pendingByStage[next] || 0) + 1;
      }
      return {
        id: b.id,
        label: b.label,
        createdAt: b.createdAt,
        count: entries.length,
        pendingByStage,
      };
    })
    .filter((b) => b.count > 0)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Pending candidates. Pass a batchId to scope to one upload and/or a stage
 * (the follow-up they are waiting for) to scope to one step of the chain.
 * Each row carries its batchId/batchLabel plus stage/nextFollowUp.
 */
export async function listCandidates(batchId, { stage } = {}) {
  const data = await readStore();
  const batches = batchId
    ? [data.batches[batchId]].filter(Boolean)
    : Object.values(data.batches);

  const wanted = stage === undefined || stage === null ? null : Number(stage);

  return batches
    .flatMap((b) =>
      Object.values(b.candidates || {}).map((entry) => decorate(entry, b))
    )
    .filter((c) => !c.finished && (wanted === null || c.nextFollowUp === wanted));
}

/**
 * Look up one candidate. Scoped to a batch when given, otherwise the most
 * recently updated entry for that address across batches.
 */
export async function get(email, batchId) {
  const data = await readStore();

  if (batchId) {
    const batch = data.batches[batchId];
    const entry = batch?.candidates?.[email];
    return entry ? decorate(entry, batch) : undefined;
  }

  let best;
  for (const b of Object.values(data.batches)) {
    const entry = b.candidates?.[email];
    if (!entry) continue;
    if (!best || String(entry.updatedAt) > String(best.updatedAt)) {
      best = decorate(entry, b);
    }
  }
  return best;
}

/**
 * Insert/overwrite one candidate inside a batch (the initial mail).
 *
 * The thread survives a retry of the same message, but a *new* root Message-ID
 * means a new conversation: the chase restarts at follow-up 1 rather than
 * replying to a message the recipient never saw.
 */
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
    const previous = batch.candidates[email];
    const incoming = stripDerived(entry);
    const isNewThread =
      incoming.messageId && previous?.messageId && incoming.messageId !== previous.messageId;

    const base = previous && !isNewThread ? previous : {};

    batch.candidates[email] = normalizeEntry(email, {
      ...base,
      ...incoming,
      ...(isNewThread ? { thread: [incoming.messageId], followUps: [], followUpsSent: 0 } : {}),
      updatedAt: new Date().toISOString(),
    });

    await write(data);
    return batch.candidates[email];
  });
}

/**
 * Record a follow-up that actually went out: appends it to the thread and
 * advances the stage. The entry is deleted once MAX_FOLLOW_UPS follow-ups have
 * been sent, which is what stops anyone being chased for ever.
 *
 * @returns {{ entry: object|null, removed: boolean, nextFollowUp: number|null }}
 */
export async function recordFollowUp(
  email,
  batchId,
  { messageId, subject, sentAt, stage, maxFollowUps = MAX_FOLLOW_UPS } = {}
) {
  return serialize(async () => {
    const data = await readStore();
    const batch = batchId ? data.batches[batchId] : undefined;
    const entry = batch?.candidates?.[email];

    if (!entry) return { entry: null, removed: false, nextFollowUp: null };

    const now = sentAt || new Date().toISOString();
    const sentStage = Number(stage) || nextFollowUp(entry);

    const followUps = [...(entry.followUps || []), { stage: sentStage, messageId, subject, sentAt: now }];
    const thread = [...(entry.thread || []), messageId].filter(Boolean);

    const updated = normalizeEntry(email, {
      ...entry,
      followUps,
      thread,
      followUpsSent: followUps.length,
      updatedAt: now,
    });

    if (updated.followUpsSent >= maxFollowUps) {
      delete batch.candidates[email];
      await write(prune(data));
      return { entry: null, removed: true, nextFollowUp: null };
    }

    batch.candidates[email] = updated;
    await write(data);
    return { entry: updated, removed: false, nextFollowUp: nextFollowUp(updated) };
  });
}

/** Remove one candidate (e.g. after the last follow-up, or manually). */
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
