// Shared helpers for building personalized emails.

const FIELDS = {
  'user name': 'name',
  'company name': 'companyName',
  'job description': 'jobDescription',
  'job id': 'jobId',
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Replace [user name] / [company name] / [job description] / [job id] placeholders.
 *
 * Also supports optional sections:
 *
 *   [if job id] (Job ID: [job id])[/if job id]
 *
 * The whole block is dropped when the field is missing/empty in the CSV, so an
 * absent job id leaves no "(Job ID: )" stub behind. Any leftover [job id] that
 * was not wrapped is removed together with common surrounding punctuation.
 */
export function fillTemplate(template = '', data = {}) {
  let out = String(template);

  // 1. Conditional blocks: [if field]...[/if field]
  for (const [label, key] of Object.entries(FIELDS)) {
    const block = new RegExp(`\\[if ${label}\\]([\\s\\S]*?)\\[\\/if ${label}\\]`, 'gi');
    out = out.replace(block, (_m, inner) => (isBlank(data[key]) ? '' : inner));
  }

  // 2. Drop empty placeholders along with wrapping "(...)" / " - ..." decoration,
  //    e.g. " (Job ID: [job id])" -> "" instead of " (Job ID: )".
  for (const [label, key] of Object.entries(FIELDS)) {
    if (!isBlank(data[key])) continue;
    const ph = `\\[${label}\\]`;
    out = out
      .replace(new RegExp(`\\s*\\([^()]*${ph}[^()]*\\)`, 'gi'), '')
      .replace(new RegExp(`\\s*<span[^>]*>[^<]*${ph}[^<]*<\\/span>`, 'gi'), '')
      .replace(new RegExp(`\\s*[-–—|,]\\s*[^<>\\n]*${ph}`, 'gi'), '')
      .replace(new RegExp(ph, 'gi'), '');
  }

  // 3. Normal substitution for everything that is present.
  for (const [label, key] of Object.entries(FIELDS)) {
    out = out.replace(new RegExp(`\\[${label}\\]`, 'gi'), () => String(data[key] ?? ''));
  }

  return out;
}

/** Smart quotes / ellipsis break some mail clients — normalize to ASCII. */
export function normalizeQuotes(str) {
  if (!str) return str;
  return String(str)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...');
}

/** Very small HTML -> text fallback. */
export function htmlToText(html = '') {
  return String(html).replace(/<[^>]*>/g, '');
}

/** "a@x.com, b@y.com" -> "a@x.com,b@y.com" (undefined when empty). */
export function normalizeCc(cc) {
  if (!cc) return undefined;
  const list = String(cc)
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return list.length ? list.join(',') : undefined;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull `<li>` items out of the body so the branded theme can lift them into the
 * accent panel. Returns the remaining body plus the extracted items.
 * The plain theme ignores this and keeps the list inline.
 */
export function extractHighlights(html = '') {
  const listMatch = String(html).match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
  if (!listMatch) return { body: html, highlights: [] };

  const items = [...listMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) =>
    m[1].trim()
  );
  if (!items.length) return { body: html, highlights: [] };

  // Drop the list and any "Some of the things I've worked on:" lead-in.
  const body = String(html)
    .replace(listMatch[0], '')
    .replace(/<p>\s*Some of the things[^<]*<\/p>\s*/i, '');

  return { body, highlights: items };
}

/** First ~120 chars of visible text — used as the inbox preview snippet. */
export function buildPreheader(html = '') {
  const text = htmlToText(html).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
