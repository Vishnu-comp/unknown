import express from 'express';
import { readFile } from 'node:fs/promises';
import { scoutCompany, makeDraft } from '../../referral-scout/scout.mjs';

// Referral Scout, mounted into the main backend so no separate server is
// needed. The same scoutCompany()/makeDraft() pipeline powers the CLI
// (node referral-scout/scout.mjs) and the standalone UI
// (node referral-scout/server.mjs). It NEVER sends anything: drafts are
// copied to the clipboard and sent by hand. No secrets, public sources only.

const BATCH_SIZE = 10;
const INDEX_PATH = new URL('../../referral-scout/index.html', import.meta.url);

// In-memory cache of completed scout runs, so "Next 10" does not re-scrape.
// Keyed by company input + name + role. Local, single-user, per-process only.
const runs = new Map();

function personForClient(p, company, opts) {
  return {
    name: p.name || '(name not parsed)',
    kind: p.kind,
    headline: p.headline || '',
    linkedin: p.linkedin || null,
    github: p.github || null,
    site: p.blog || null,
    emails: p.emails || [],
    source: p.source || '',
    draft: makeDraft(p, company, opts),
  };
}

async function handleScout(req, res) {
  const payload = req.body || {};

  const input = String(payload.input || '').trim();
  const yourName = String(payload.yourName || '').trim();
  const yourRole = String(payload.yourRole || '').trim();
  const batch = Math.max(1, parseInt(payload.batch, 10) || 1);

  if (!input) {
    return res.status(400).json({ error: 'Paste a company LinkedIn URL or name first.' });
  }

  const key = `${input}|${yourName}|${yourRole}`;
  let run = runs.get(key);

  if (!run) {
    try {
      const { company, ranked, notes } = await scoutCompany(input, {});
      run = { company, ranked, notes };
      runs.set(key, run);
      // keep the cache small - 20 most recent companies
      if (runs.size > 20) runs.delete(runs.keys().next().value);
    } catch (e) {
      return res.status(502).json({
        error: `Scouting failed: ${e.message}. Try again - public search endpoints can be flaky.`,
      });
    }
  }

  const { company, ranked, notes } = run;
  const offset = (batch - 1) * BATCH_SIZE;
  const slice = ranked.slice(offset, offset + BATCH_SIZE);

  res.json({
    company: { name: company.name, linkedinUrl: company.linkedinUrl || null },
    total: ranked.length,
    batch,
    batchSize: BATCH_SIZE,
    hasMore: offset + BATCH_SIZE < ranked.length,
    notes,
    people: slice.map((p) => personForClient(p, company, { yourName, yourRole })),
  });
}

// API: POST /api/scout (mounted under /api in server.js, same as the UI's
// fetch target, so it works both via the Vite proxy and directly on :3000)
const referralScoutApi = express.Router();
referralScoutApi.post('/scout', handleScout);

// UI: GET /referral-scout and /referral-scout/index.html serve the SPA.
const referralScoutUI = express.Router();
referralScoutUI.get(['/', '/index.html'], async (req, res, next) => {
  try {
    const html = await readFile(INDEX_PATH);
    res.type('html').send(html);
  } catch (e) {
    next(e);
  }
});

export { referralScoutApi, referralScoutUI };
