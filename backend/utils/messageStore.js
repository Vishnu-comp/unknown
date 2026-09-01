// Tiny JSON-file store keyed by recipient email.
// Holds the Message-ID of the original mail so follow-ups can be threaded.
//
// All writes go through a single in-process promise chain so concurrent
// requests cannot clobber each other's read-modify-write.

import fs from 'fs/promises';
import path from 'path';

const STORE_PATH = process.env.MESSAGE_STORE_PATH
  ? path.resolve(process.env.MESSAGE_STORE_PATH)
  : path.resolve(process.cwd(), 'messageStore.json');

let writeChain = Promise.resolve();

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function serialize(task) {
  const run = writeChain.then(task, task);
  // keep the chain alive even if a task rejects
  writeChain = run.catch(() => {});
  return run;
}

/** Full store as an object: { [email]: entry }. */
export async function getAll() {
  return readStore();
}

/** Store as an array: [{ email, ...entry }]. */
export async function listCandidates() {
  const data = await readStore();
  return Object.entries(data).map(([email, entry]) => ({ email, ...entry }));
}

/** Single entry or undefined. */
export async function get(email) {
  const data = await readStore();
  return data[email];
}

/** Insert/overwrite one entry. */
export async function save(email, entry) {
  return serialize(async () => {
    const data = await readStore();
    data[email] = { ...data[email], ...entry, updatedAt: new Date().toISOString() };
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
    return data[email];
  });
}

/** Remove one entry (used after a successful follow-up). */
export async function remove(email) {
  return serialize(async () => {
    const data = await readStore();
    delete data[email];
    await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2));
  });
}

export { STORE_PATH };
