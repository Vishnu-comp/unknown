#!/usr/bin/env node
/**
 * referral-scout
 *
 * Paste a company's LinkedIn page (or just its name) and get a ranked batch of
 * people worth asking for a referral: recruiters, founders / founding
 * engineers, and engineers, with a paste-ready outreach draft for each.
 *
 * Sources are PUBLIC ONLY:
 *   - public web search (DuckDuckGo, then Bing, then Mojeek - whichever
 *     answers first; no account, no key, no LinkedIn login)
 *   - the company's public website (team/about/contact/careers pages)
 *   - the GitHub public API (people who list the company on their profile)
 *
 * Emails are reported ONLY when they appear verbatim on a public page.
 * They are never guessed from name patterns. "Found" means "seen in public",
 * not "verified deliverable".
 *
 * Zero dependencies. Needs Node 18+ (uses global fetch).
 *
 * Usage:
 *   node scout.mjs "https://www.linkedin.com/company/acme" --your-name "Vishnu Nair"
 *   node scout.mjs "Acme Corp" --batch 2 --json out.json --out report.md
 *
 * The same logic powers the local web UI (server.mjs) - it imports
 * scoutCompany() from this file, so CLI and UI always behave identically.
 */

import { pathToFileURL } from "node:url";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BATCH_SIZE_DEFAULT = 10;

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeHtml(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function extractEmails(text = "") {
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const found = text.match(re) || [];
  // filter obvious non-personal noise
  return [
    ...new Set(
      found.filter(
        (e) =>
          !/example\.|sentry|wixpress|@2x|@3x|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$/i.test(
            e
          )
      )
    ),
  ];
}

async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// input parsing
// ---------------------------------------------------------------------------

export function parseCompany(input) {
  const m = input.match(/linkedin\.com\/company\/([^\/?#]+)/i);
  if (m) {
    const slug = m[1].replace(/\/$/, "");
    const name = slug
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return { slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}/` };
  }
  return {
    slug: null,
    name: input.trim(),
    linkedinUrl: null,
  };
}

// ---------------------------------------------------------------------------
// source 1: public web search, with backend fallback
// ---------------------------------------------------------------------------

function decodeBingUrl(href) {
  // Bing wraps outbound links as bing.com/ck/a?...&u=a1<base64url>
  const m = href.match(/[?&]u=([^&]+)/);
  if (!m) return href;
  const u = decodeURIComponent(m[1]);
  if (!u.startsWith("a1")) return href;
  try {
    return Buffer.from(u.slice(2), "base64url").toString("utf8");
  } catch {
    return href;
  }
}

const SEARCH_BACKENDS = [
  {
    name: "DuckDuckGo",
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse(html) {
      const results = [];
      const blocks = html.split(/<div class="result[^"]*"/).slice(1);
      for (const b of blocks) {
        const a = b.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        let href = decodeHtml(a[1]);
        const uddg = href.match(/[?&]uddg=([^&]+)/);
        if (uddg) href = decodeURIComponent(uddg);
        const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        results.push({ url: href, title: decodeHtml(a[2]), snippet: sn ? decodeHtml(sn[1]) : "" });
      }
      return results;
    },
  },
  {
    name: "Bing",
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`,
    parse(html) {
      const results = [];
      const items = html.split(/<li class="b_algo"/).slice(1);
      for (const it of items) {
        const a = it.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        const cap = it.match(/class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
        results.push({
          url: decodeBingUrl(decodeHtml(a[1])),
          title: decodeHtml(a[2]),
          snippet: cap ? decodeHtml(cap[1]) : "",
        });
      }
      return results;
    },
  },
  {
    name: "Mojeek",
    url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    parse(html) {
      const results = [];
      const items = html.split(/<li class="b_?result|<li class="r"/i).slice(1);
      for (const it of items) {
        const a = it.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (a) results.push({ url: decodeHtml(a[1]), title: decodeHtml(a[2]), snippet: "" });
      }
      return results;
    },
  },
];

async function webSearch(query, state) {
  for (const backend of SEARCH_BACKENDS) {
    if (state.deadBackends.has(backend.name)) continue;
    try {
      const html = await fetchText(backend.url(query));
      const results = backend.parse(html);
      if (results.length) {
        state.usedBackends.add(backend.name);
        return results;
      }
      // answered but nothing parseable: treat as blocked/bot-checked
      state.deadBackends.add(backend.name);
    } catch {
      state.deadBackends.add(backend.name);
    }
  }
  return [];
}

const PERSON_QUERIES = [
  {
    kind: "recruiter",
    q: (n) => `site:linkedin.com/in "${n}" (recruiter OR "talent acquisition" OR "hiring manager")`,
  },
  {
    kind: "founder",
    q: (n) => `site:linkedin.com/in "${n}" (founder OR co-founder OR "founding engineer" OR CTO)`,
  },
  {
    kind: "engineer",
    q: (n) =>
      `site:linkedin.com/in "${n}" ("software engineer" OR "backend engineer" OR "full stack" OR SDE)`,
  },
];

function classifyPerson({ title, snippet }, companyName, fallbackKind) {
  const text = `${title} ${snippet}`.toLowerCase();
  const companyWords = companyName.toLowerCase().split(/\s+/);
  const mentionsCompany = companyWords.some((w) => w.length > 2 && text.includes(w));
  let kind = fallbackKind;
  if (/recruit|talent acquisition|people ops|hiring manager|staffing/.test(text)) kind = "recruiter";
  else if (/founding engineer|co-?founder|\bfounder\b|\bcto\b|chief technology/.test(text))
    kind = "founder";
  // Name is usually the first segment of a LinkedIn result title:
  // "First Last - Role at Company | LinkedIn"
  let name = title.split(/\s[-–|]\s/)[0].trim();
  if (!name || name.length < 2 || /linkedin/i.test(name)) name = null;
  return { name, kind, mentionsCompany };
}

async function findPeopleViaSearch(company, state) {
  const people = new Map(); // key: linkedin url
  for (const { kind, q } of PERSON_QUERIES) {
    const results = await webSearch(q(company.name), state);
    for (const r of results) {
      if (!/linkedin\.com\/in\//i.test(r.url)) continue;
      const profileUrl = r.url.split("?")[0].replace(/\/$/, "");
      const meta = classifyPerson(r, company.name, kind);
      const emails = extractEmails(`${r.title} ${r.snippet}`).map((email) => ({
        email,
        source: "search snippet",
      }));
      const existing = people.get(profileUrl);
      if (existing) {
        for (const e of emails)
          if (!existing.emails.some((x) => x.email === e.email)) existing.emails.push(e);
        continue;
      }
      people.set(profileUrl, {
        name: meta.name,
        kind: meta.kind,
        headline: r.title,
        linkedin: profileUrl,
        emails,
        source: "web search (public)",
        companyMentioned: meta.mentionsCompany,
      });
    }
    await sleep(1200); // be polite to the public endpoints
  }
  return [...people.values()];
}

// ---------------------------------------------------------------------------
// source 2: company website - emails + team members linking their LinkedIn
// ---------------------------------------------------------------------------

const TITLE_WORDS =
  /founder|co-?founder|ceo|cto|coo|engineer|developer|sde|architect|lead|head|director|recruit|talent|designer|manager/i;

async function scanCompanySite(company, domain) {
  const candidates = [];
  if (domain) candidates.push(`https://${domain}`);
  else if (company.slug) candidates.push(`https://${company.slug}.com`);
  const emails = [];
  const people = [];
  for (const base of candidates.slice(0, 1)) {
    for (const path of ["/team", "/about", "/about-us", "/contact", "/careers", ""]) {
      let html;
      try {
        html = await fetchText(base + path, { timeoutMs: 10000 });
      } catch {
        continue; // page not reachable - fine
      }
      for (const e of extractEmails(html)) {
        if (!emails.some((x) => x.email === e))
          emails.push({ email: e, source: `${base}${path} (public page)` });
      }
      // team members who link their personal LinkedIn from the page
      const seenOnPage = new Set();
      for (const m of html.matchAll(/<a[^>]+href="([^"]*linkedin\.com\/in\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const profileUrl = decodeHtml(m[1]).split("?")[0].replace(/\/$/, "");
        if (seenOnPage.has(profileUrl)) continue;
        seenOnPage.add(profileUrl);
        // look at the text around the link for a name and title
        const around = decodeHtml(html.slice(Math.max(0, m.index - 400), m.index + 400));
        const anchorText = decodeHtml(m[2]);
        let name = null;
        const nameCandidate = anchorText.replace(/linkedin/gi, "").trim();
        if (/^[A-Z][a-zA-Z.'-]+( [A-Z][a-zA-Z.'-]+){0,3}$/.test(nameCandidate)) name = nameCandidate;
        if (!name) {
          const nm = around.match(/([A-Z][a-zA-Z.'-]+ [A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+)?)/);
          if (nm) name = nm[1];
        }
        const titleHit = around.match(
          /(co-?founder|founding engineer|founder|ceo|cto|coo|(backend|frontend|full[ -]?stack|software|staff|principal|lead) ?(engineer|developer)|sde|recruit\w*|talent \w+)/i
        );
        const headline = titleHit ? titleHit[0] : "listed on the company site";
        let kind = "engineer";
        if (/recruit|talent/i.test(headline)) kind = "recruiter";
        else if (/founder|ceo|cto|coo/i.test(headline)) kind = "founder";
        people.push({
          name,
          kind,
          headline,
          linkedin: profileUrl,
          emails: [],
          source: `${base}${path} (company website)`,
          companyMentioned: true,
        });
      }
      await sleep(400);
    }
  }
  return { emails, people };
}

// ---------------------------------------------------------------------------
// source 3: GitHub public API (engineers who list the company)
// ---------------------------------------------------------------------------

async function findGitHubPeople(company, { limit = 10, token = null } = {}) {
  const headers = { "User-Agent": "referral-scout", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const q = encodeURIComponent(`"${company.name}" in:company`);
  let search;
  try {
    const res = await fetch(`https://api.github.com/search/users?q=${q}&per_page=${limit}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    search = await res.json();
  } catch (e) {
    console.error(`warn: GitHub search failed: ${e.message}`);
    return [];
  }
  const out = [];
  for (const u of (search.items || []).slice(0, limit)) {
    if (u.type && u.type !== "User") continue; // skip org accounts
    try {
      const res = await fetch(u.url, { headers });
      if (!res.ok) continue;
      const p = await res.json();
      if (p.type && p.type !== "User") continue;
      const emails = [];
      if (p.email) emails.push({ email: p.email, source: "GitHub public profile" });
      out.push({
        name: p.name || p.login,
        kind: "engineer",
        headline: p.bio || `GitHub user ${p.login}`,
        linkedin: null,
        github: p.html_url,
        blog: p.blog || null,
        emails,
        source: "GitHub public API",
        companyMentioned: true,
      });
    } catch {
      /* skip */
    }
    await sleep(300);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ranking + drafts
// ---------------------------------------------------------------------------

const KIND_ORDER = { recruiter: 0, founder: 1, engineer: 2 };

export function rankPeople(people) {
  return people.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k) return k;
    const c = (b.companyMentioned ? 1 : 0) - (a.companyMentioned ? 1 : 0);
    if (c) return c;
    return b.emails.length - a.emails.length;
  });
}

export function makeDraft(person, company, opts) {
  const yourName = opts.yourName || "[Your name]";
  const yourRole = opts.yourRole || "[your current role]";
  const isInbox = /general inbox/i.test(person.name || "");
  const first = person.name && !isInbox ? person.name.split(/\s/)[0] : null;
  const hi = isInbox ? "Hi team," : first ? `Hi ${first},` : "Hi,";
  const roleLine =
    person.kind === "recruiter"
      ? `I came across ${company.name}'s open roles and I'm really interested in joining the team.`
      : person.kind === "founder"
      ? `I've been following what you're building at ${company.name} and I'd love to be part of it.`
      : `I saw your work at ${company.name} and I'm really interested in the team.`;
  return `${hi}

${roleLine} I'm currently a ${yourRole}, and I think my background could be a good fit.

Would you be open to referring me, or pointing me to the right person? Happy to share my resume - and no worries at all if now isn't a good time.

Thanks!
${yourName}`;
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

function renderMarkdown(batch, company, opts, batchInfo, notes) {
  const lines = [];
  lines.push(`# Referral targets - ${company.name}`);
  if (company.linkedinUrl) lines.push(`Company page: ${company.linkedinUrl}`);
  lines.push(
    `Batch ${batchInfo.batch} (${batch.length} people, batch size ${batchInfo.size}). ` +
      `Emails below were found verbatim on public pages - never guessed. Drafts are paste-ready; you send them yourself.\n`
  );
  for (const note of notes) lines.push(`> ${note}`);
  if (notes.length) lines.push("");
  batch.forEach((p, i) => {
    const n = batchInfo.offset + i + 1;
    lines.push(`## ${n}. ${p.name || "(name not parsed)"} - ${p.kind}`);
    lines.push(`- Headline: ${p.headline}`);
    if (p.linkedin) lines.push(`- LinkedIn: ${p.linkedin}`);
    if (p.github) lines.push(`- GitHub: ${p.github}`);
    if (p.blog) lines.push(`- Site: ${p.blog}`);
    if (p.emails.length)
      lines.push(`- Email(s) found in public: ${p.emails.map((e) => `${e.email} (${e.source})`).join(", ")}`);
    else lines.push(`- Email: none found in public sources`);
    lines.push(`- Source: ${p.source}`);
    lines.push(`\nDraft:\n\n${makeDraft(p, company, opts)}\n`);
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { batch: 1, batchSize: BATCH_SIZE_DEFAULT };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--batch") args.batch = parseInt(argv[++i], 10) || 1;
    else if (a === "--batch-size") args.batchSize = parseInt(argv[++i], 10) || BATCH_SIZE_DEFAULT;
    else if (a === "--your-name") args.yourName = argv[++i];
    else if (a === "--your-role") args.yourRole = argv[++i];
    else if (a === "--domain") args.domain = argv[++i];
    else if (a === "--json") args.jsonPath = argv[++i];
    else if (a === "--out") args.outPath = argv[++i];
    else if (a === "--no-github") args.noGithub = true;
    else if (a === "--no-site") args.noSite = true;
    else if (a === "--no-search") args.noSearch = true;
    else if (a === "--verbose") args.verbose = true;
    else positional.push(a);
  }
  args.input = positional.join(" ");
  return args;
}

/**
 * Run the full scout pipeline for one company and return everything gathered.
 * Shared by the CLI (below) and the web UI (server.mjs).
 *
 * @param {string} input LinkedIn company URL or plain company name
 * @param {object} opts  { domain, noSearch, noSite, noGithub }
 * @returns {{ company: object, ranked: object[], notes: string[] }}
 */
export async function scoutCompany(input, opts = {}) {
  const company = parseCompany(input);

  const people = [];
  const notes = [];
  const searchState = { deadBackends: new Set(), usedBackends: new Set() };

  if (!opts.noSearch) {
    people.push(...(await findPeopleViaSearch(company, searchState)));
    if (searchState.usedBackends.size)
      notes.push(`Search backend(s) used: ${[...searchState.usedBackends].join(", ")}.`);
    if (searchState.deadBackends.size)
      notes.push(
        `Search backend(s) unreachable or bot-blocked from this network: ${[...searchState.deadBackends].join(", ")}. ` +
          `Re-run from your own connection for full results.`
      );
  }

  if (!opts.noSite) {
    const site = await scanCompanySite(company, opts.domain);
    if (site.emails.length) {
      people.push({
        name: `${company.name} (general inbox)`,
        kind: "recruiter",
        headline: "Public contact email on the company website",
        linkedin: null,
        emails: site.emails,
        source: "company website (public)",
        companyMentioned: true,
      });
    }
    for (const sp of site.people) {
      if (sp.linkedin && people.some((p) => p.linkedin === sp.linkedin)) continue;
      people.push(sp);
    }
  }

  if (!opts.noGithub) {
    const gh = await findGitHubPeople(company, { token: process.env.GITHUB_TOKEN || null });
    people.push(...gh);
  }

  const ranked = rankPeople(people.filter((p) => p.name || p.emails.length));
  return { company, ranked, notes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error(
      'Usage: node scout.mjs "<linkedin company url or company name>" [--batch N] [--batch-size N]\n' +
        '          [--your-name "Name"] [--your-role "Role"] [--domain example.com]\n' +
        "          [--json out.json] [--out report.md] [--no-search] [--no-github] [--no-site] [--verbose]"
    );
    process.exit(1);
  }
  const { company, ranked, notes } = await scoutCompany(args.input, args);
  console.error(`Company: ${company.name}`);
  const offset = (args.batch - 1) * args.batchSize;
  const batch = ranked.slice(offset, offset + args.batchSize);

  const md = renderMarkdown(batch, company, args, {
    batch: args.batch,
    size: args.batchSize,
    offset,
  }, notes);
  console.log(md);
  if (args.outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args.outPath, md);
  }
  if (args.jsonPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      args.jsonPath,
      JSON.stringify({ company, total: ranked.length, batch: args.batch, notes, people: batch }, null, 2)
    );
  }
  console.error(
    `\n${ranked.length} people found total; showing batch ${args.batch} (${batch.length}). ` +
      (offset + args.batchSize < ranked.length ? `More: run with --batch ${args.batch + 1}` : "No further batches.")
  );
}

// Run the CLI only when this file is executed directly, not when server.mjs
// imports it.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
