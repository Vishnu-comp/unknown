// The follow-up chain: initial email -> follow-up 1 -> follow-up 2.
//
// MAX_FOLLOW_UPS is the number of chasing steps a candidate gets before they
// are dropped from the follow-up store. Everything downstream is derived from
// it: messageStore keeps a candidate until that many follow-ups have gone out,
// /api/followups reports one stage per step, and the UI renders one editable
// block per step. Raise the number and the extra step shows up everywhere.
//
// The built-in copy for each step lives here so the API and the UI share one
// source of truth: /api/followups/templates serves it, and the send route uses
// it whenever a request does not carry its own subject/body.

const parsedMax = Number.parseInt(process.env.MAX_FOLLOW_UPS ?? '2', 10);
export const MAX_FOLLOW_UPS = Number.isFinite(parsedMax)
  ? Math.min(Math.max(parsedMax, 1), 5)
  : 2;

const FOLLOW_UP_1_SUBJECT =
  'Following Up: [job description] Opportunity at [company name][if job id] (Job ID: [job id])[/if job id]';

const FOLLOW_UP_1_TEMPLATE = `<p>Hi [user name],</p>

<p>I wanted to follow up on my previous email about the <b>[job description]</b> opportunity at <b>[company name]</b>[if job id] (Job ID: <b>[job id]</b>)[/if job id]. I'm still very interested in the role and would appreciate any updates or next steps.</p>

<p>Looking forward to your response.</p>

<p>Best regards,<br/><b>Vishnu Nair</b></p>`;

// Second (and, by default, last) step: short, no new pitch, no pressure.
// Reusing this for any stage past the first keeps the chain working if
// MAX_FOLLOW_UPS is raised.
const CLOSING_SUBJECT =
  'Re: [job description] Opportunity at [company name][if job id] (Job ID: [job id])[/if job id]';

const CLOSING_TEMPLATE = `<p>Hi [user name],</p>

<p>I'm really sorry to trouble you again about the <b>[job description]</b> role at <b>[company name]</b>[if job id] (Job ID: <b>[job id]</b>)[/if job id].</p>

<p>I know how busy you must be, and I don't want to keep cluttering your inbox. I'm still very interested in the role, and if you have a moment, any guidance or update would mean a lot to me.</p>

<p>Thank you so much for your time, and sorry again for the follow-up.</p>

<p>Best regards,<br/><b>Vishnu Nair</b></p>`;

const DEFAULT_COPY = {
  1: { subject: FOLLOW_UP_1_SUBJECT, template: FOLLOW_UP_1_TEMPLATE },
  2: { subject: CLOSING_SUBJECT, template: CLOSING_TEMPLATE },
};

/** Descriptions used in the UI / API docs. */
const STAGE_BLURB = {
  1: 'Nudge that replies in the original thread.',
  2: 'A short, apologetic final note - thanks them for their time, no pressure.',
};

export function isStage(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_FOLLOW_UPS;
}

export function stageLabel(stage) {
  return `Follow-up ${stage}`;
}

/**
 * How many follow-ups have gone out for this stored entry.
 * 0 = the initial mail is out and follow-up 1 is next.
 */
export function followUpsSent(entry) {
  return Number(entry?.followUpsSent) || 0;
}

/** The stage a stored entry is waiting for (1-based). */
export function nextFollowUp(entry) {
  return followUpsSent(entry) + 1;
}

export function isFinalStage(stage) {
  return Number(stage) >= MAX_FOLLOW_UPS;
}

/** Built-in copy for a stage; anything past the first reuses the final note. */
export function copyFor(stage) {
  const n = isStage(stage) ? Number(stage) : 1;
  return DEFAULT_COPY[n] || DEFAULT_COPY[2];
}

/** The whole chain, for the UI and for GET /api/followups/templates. */
export function listStages() {
  return Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => {
    const stage = i + 1;
    return {
      stage,
      label: stageLabel(stage),
      blurb: STAGE_BLURB[stage] || STAGE_BLURB[2],
      final: isFinalStage(stage),
      ...copyFor(stage),
    };
  });
}
