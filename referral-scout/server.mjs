#!/usr/bin/env node
/**
 * referral-scout local web UI
 *
 * A zero-dependency Node server that serves a single-page app on localhost.
 * Paste a company's LinkedIn page, see ranked people in batches of 10, with a
 * copy-able referral draft for each. All scouting logic is imported from
 * scout.mjs - the CLI and the UI share the same pipeline.
 *
 * It NEVER sends anything: drafts are copied to your clipboard and you send
 * them yourself. No secrets, no accounts, no external JS/CSS.
 *
 * Run:
 *   node referral-scout/server.mjs        # from the repo root
 *   node server.mjs                       # from inside referral-scout/
 *   PORT=8080 node referral-scout/server.mjs
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { scoutCompany, makeDraft } from "./scout.mjs";

const PORT = parseInt(process.env.PORT || "3737", 10);
const BATCH_SIZE = 10;

const INDEX_PATH = new URL("./index.html", import.meta.url);

// In-memory cache of completed scout runs, so "Next 10" does not re-scrape.
// Keyed by company input + name + role. Local, single-user, per-process only.
const runs = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error("request too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function personForClient(p, company, opts) {
  return {
    name: p.name || "(name not parsed)",
    kind: p.kind,
    headline: p.headline || "",
    linkedin: p.linkedin || null,
    github: p.github || null,
    site: p.blog || null,
    emails: p.emails || [],
    source: p.source || "",
    draft: makeDraft(p, company, opts),
  };
}

async function handleScout(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }

  const input = String(payload.input || "").trim();
  const yourName = String(payload.yourName || "").trim();
  const yourRole = String(payload.yourRole || "").trim();
  const batch = Math.max(1, parseInt(payload.batch, 10) || 1);

  if (!input) return sendJson(res, 400, { error: "Paste a company LinkedIn URL or name first." });

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
      return sendJson(res, 502, {
        error: `Scouting failed: ${e.message}. Try again - public search endpoints can be flaky.`,
      });
    }
  }

  const { company, ranked, notes } = run;
  const offset = (batch - 1) * BATCH_SIZE;
  const slice = ranked.slice(offset, offset + BATCH_SIZE);

  sendJson(res, 200, {
    company: { name: company.name, linkedinUrl: company.linkedinUrl || null },
    total: ranked.length,
    batch,
    batchSize: BATCH_SIZE,
    hasMore: offset + BATCH_SIZE < ranked.length,
    notes,
    people: slice.map((p) => personForClient(p, company, { yourName, yourRole })),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const html = await readFile(INDEX_PATH);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "POST" && pathname === "/api/scout") {
      return await handleScout(req, res);
    }
    sendJson(res, 404, { error: "Not found." });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`referral-scout UI running at http://localhost:${PORT}`);
  console.log("It never sends anything - drafts are copy-paste only.");
});
