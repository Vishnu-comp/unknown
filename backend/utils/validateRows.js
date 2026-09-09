// Row checks that run before anything is sent.
//
// Two classes of finding:
//   error   - this row cannot be sent (no valid email address)
//   warning - sendable, but probably not what you want (duplicate, missing
//             name, already contacted recently)
//
// Nothing is silently dropped: every row comes back annotated and the caller
// decides what to skip.

import { lookup, normalizeEmail } from './contactStore.js';

// Deliberately pragmatic, not RFC 5322. Catches the mistakes people actually
// make in spreadsheets: missing @, missing TLD, stray spaces, trailing commas.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

// Flag re-contacting someone inside this window.
const RECENT_DAYS = Number(process.env.RECENT_CONTACT_DAYS || 30);

export function isValidEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

function daysSince(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

/**
 * @param {Array<object>} rows parsed CSV rows
 * @returns {{ rows, summary }} annotated rows plus counts
 */
export async function validateRows(rows) {
  const list = Array.isArray(rows) ? rows : [];

  const contacts = await lookup(list.map((r) => r?.email));

  const seen = new Map(); // normalized email -> first row index
  const annotated = list.map((row, index) => {
    const rawEmail = String(row?.email ?? '').trim();
    const key = normalizeEmail(rawEmail);
    const errors = [];
    const warnings = [];

    if (!rawEmail) {
      errors.push('Missing email address');
    } else if (!isValidEmail(rawEmail)) {
      errors.push(`"${rawEmail}" is not a valid email address`);
    }

    if (key && seen.has(key)) {
      warnings.push(`Duplicate of row ${seen.get(key) + 1} in this file`);
    } else if (key) {
      seen.set(key, index);
    }

    if (!String(row?.name ?? '').trim()) {
      warnings.push('No name - "Hi [user name]," will read oddly');
    }
    if (!String(row?.companyName ?? '').trim()) {
      warnings.push('No company name');
    }

    const prior = key ? contacts.get(key) : null;
    let contacted = null;
    if (prior) {
      const days = daysSince(prior.lastContactedAt);
      contacted = {
        lastContactedAt: prior.lastContactedAt,
        sendCount: prior.sendCount,
        daysAgo: days,
      };
      const when =
        days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      const times = prior.sendCount === 1 ? 'once' : `${prior.sendCount} times`;
      if (days !== null && days <= RECENT_DAYS) {
        warnings.push(`Already emailed ${when} (${times})`);
      } else {
        warnings.push(`Previously emailed ${when} (${times})`);
      }
    }

    return {
      ...row,
      index,
      email: rawEmail,
      errors,
      warnings,
      contacted,
      sendable: errors.length === 0,
      duplicate: key ? seen.get(key) !== index : false,
    };
  });

  const summary = {
    total: annotated.length,
    sendable: annotated.filter((r) => r.sendable).length,
    invalid: annotated.filter((r) => r.errors.length > 0).length,
    duplicates: annotated.filter((r) => r.duplicate).length,
    alreadyContacted: annotated.filter((r) => r.contacted).length,
    recentlyContacted: annotated.filter(
      (r) => r.contacted && r.contacted.daysAgo !== null && r.contacted.daysAgo <= RECENT_DAYS
    ).length,
    missingFields: annotated.filter((r) => r.sendable && r.warnings.length > 0).length,
    recentDays: RECENT_DAYS,
  };

  return { rows: annotated, summary };
}
