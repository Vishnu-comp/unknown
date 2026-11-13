# referral-scout

Paste a company's LinkedIn page, get back a ranked batch of people worth asking
for a referral - recruiters, founders / founding engineers, and engineers - with
a paste-ready outreach draft for each.

```
node scout.mjs "https://www.linkedin.com/company/kirana-club" --your-name "Vishnu Nair" --your-role "Full Stack Developer at Shoffr"
```

## What you get

For each person, in batches of 10:

- **Name** and **LinkedIn URL**
- **Email** - only when it appears verbatim on a public page (search snippet,
  the company's own site, or their public GitHub profile). Emails are **never
  guessed** from name patterns, and "found in public" does not mean "verified
  deliverable".
- A **paste-ready referral draft** matched to whether they are a recruiter,
  founder, or engineer. You review it and send it yourself. The tool never
  sends anything.

Get the next 10 with `--batch 2`, then `--batch 3`, and so on.

## Install and run

No dependencies. You need Node 18 or newer (it uses the built-in `fetch`).

```
node scout.mjs "<linkedin company url or company name>" [options]
```

Options:

| Flag | What it does |
| --- | --- |
| `--batch N` | Which batch of 10 to show (default 1) |
| `--batch-size N` | Change the batch size (default 10) |
| `--your-name "Name"` | Sign the drafts as you |
| `--your-role "Role"` | Your current role, used in the drafts |
| `--domain example.com` | Company website, if the guess `<company>.com` is wrong |
| `--out report.md` | Save the Markdown report to a file |
| `--json out.json` | Save structured results to a file |
| `--no-search` | Skip the web-search source |
| `--no-github` | Skip the GitHub source |
| `--no-site` | Skip the company-website source |
| `--verbose` | Show progress as it runs |

If you hit GitHub's anonymous rate limit, set a token in your environment
(never in the code): `GITHUB_TOKEN=ghp_... node scout.mjs ...`

## Where the data comes from

Public sources only. Nothing is scraped from LinkedIn while logged in - the
tool never touches your LinkedIn account:

1. **Public web search** for `site:linkedin.com/in` results matching the
   company plus recruiter / founder / engineer terms. It tries DuckDuckGo,
   then Bing, then Mojeek, and tells you in the report which backends answered
   and which were unreachable or bot-blocked from your network.
2. **The company's public website** (`/team`, `/about`, `/contact`,
   `/careers`) for published contact emails and team members who link their
   personal LinkedIn.
3. **The GitHub public API** for people who list the company on their profile
   (their public email is included only if they publish one). Organization
   accounts are skipped.

## Limits, honestly

- Result quality depends on what public search indexes show for that company.
  Well-known companies return plenty; small startups may return only a few.
- Search engines sometimes bot-block datacenter or VPN IPs. When that happens
  the report says so; re-run from a normal connection for full results.
- Some entries will be stale (people change jobs). Check the profile before
  you send.
- Emails are rare from public sources alone. Most batches will be
  LinkedIn-first, and that's fine - the draft works as a LinkedIn message too.
- The tool finds people and words. The sending is always yours.
