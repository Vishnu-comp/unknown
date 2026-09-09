// Permanent record of every email this tool has sent.
//
// Unlike messageStore.js (which holds *pending* follow-ups and deletes an entry
// once the follow-up goes out), nothing is ever removed here. This is the log
// that answers "have I already emailed this person?".
//
// Shape:
//   { "version": 1, "contacts": { "<lowercased email>": { ...contact } } }
//
// A contact:
//   { email, name, companyName,
//     firstContactedAt, lastContactedAt, sendCount,
//     history: [ { at, subject, theme, batchId, batchLabel, kind } ] }
//
// `kind` is 'initial' or 'followup'.

import fs from 'fs/promises';
import path from 'path';

const STORE_PATH = process.env.CONTACT_STORE_PATH
  ? path.resolve(process.env.CONTACT_STORE_PATH)
  : path.resolve(process.cwd(), 'contactStore.json');

const MAX_HISTORY = 20; // per contact, keeps the file from growing without bound

let writeChain = Promise.resolve();

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emptyStore() {
  return { version: 1, contacts: {} };
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return parsed.contacts ? parsed : emptyStore();
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

/** Record one successful send. Called from the send loop. */
export async function recordSend({
  email,
  name,
  companyName,
  subject,
  theme,
  batchId,
  batchLabel,
  kind = 'initial',
}) {
  const key = normalizeEmail(email);
  if (!key) return;

  return serialize(async () => {
    const data = await readStore();
    const now = new Date().toISOString();
    const existing = data.contacts[key];

    const entry = { at: now, subject, theme, batchId, batchLabel, kind };

    if (existing) {
      existing.name = name || existing.name;
      existing.companyName = companyName || existing.companyName;
      existing.lastContactedAt = now;
      existing.sendCount = (existing.sendCount || 0) + 1;
      existing.history = [entry, ...(existing.history || [])].slice(0, MAX_HISTORY);
    } else {
      data.contacts[key] = {
        email: key,
        name: name || '',
        companyName: companyName || '',
        firstContactedAt: now,
        lastContactedAt: now,
        sendCount: 1,
        history: [entry],
      };
    }

    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
  });
}

/** Look up many emails at once. Returns a Map of normalized email -> contact. */
export async function lookup(emails) {
  const data = await readStore();
  const map = new Map();
  for (const e of emails) {
    const key = normalizeEmail(e);
    if (data.contacts[key]) map.set(key, data.contacts[key]);
  }
  return map;
}

/** Full contact list, most recently contacted first. */
export async function listContacts({ search = '', limit = 500 } = {}) {
  const data = await readStore();
  const q = search.trim().toLowerCase();

  return Object.values(data.contacts)
    .filter((c) =>
      !q ||
      c.email.includes(q) ||
      (c.name || '').toLowerCase().includes(q) ||
      (c.companyName || '').toLowerCase().includes(q)
    )
    .sort((a, b) => String(b.lastContactedAt).localeCompare(String(a.lastContactedAt)))
    .slice(0, limit);
}

export async function getContact(email) {
  const data = await readStore();
  return data.contacts[normalizeEmail(email)];
}

export async function removeContact(email) {
  return serialize(async () => {
    const data = await readStore();
    delete data.contacts[normalizeEmail(email)];
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
  });
}

export async function stats() {
  const data = await readStore();
  const contacts = Object.values(data.contacts);
  return {
    totalContacts: contacts.length,
    totalSends: contacts.reduce((n, c) => n + (c.sendCount || 0), 0),
  };
}

export { STORE_PATH };
