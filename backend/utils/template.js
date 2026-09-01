// Shared helpers for building personalized emails.

/** Replace [user name] / [company name] / [job description] / [job id] placeholders. */
export function fillTemplate(template = '', data = {}) {
  return String(template)
    .replace(/\[user name\]/gi, data.name || '')
    .replace(/\[company name\]/gi, data.companyName || '')
    .replace(/\[job description\]/gi, data.jobDescription || '')
    .replace(/\[job id\]/gi, data.jobId || '');
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
