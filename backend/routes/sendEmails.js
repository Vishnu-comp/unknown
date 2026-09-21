import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { getTransporter, assertMailConfig } from '../utils/mailer.js';
import * as store from '../utils/messageStore.js';
import * as contacts from '../utils/contactStore.js';
import {
  fillTemplate,
  normalizeQuotes,
  htmlToText,
  normalizeCc,
  sleep,
  extractHighlights,
  buildPreheader,
} from '../utils/template.js';
import { renderEmail, THEMES, DEFAULT_THEME, THEME_META } from '../utils/themes.js';
import { getBranding } from '../utils/branding.js';
import {
  MAX_FOLLOW_UPS,
  isStage,
  stageLabel,
  nextFollowUp,
  copyFor,
  listStages,
} from '../utils/followUps.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Delay between mails in a single batch (Gmail rate-limit friendly).
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 15000);

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

/**
 * Contact-log `kind` for a follow-up step: 'followup' for the first nudge,
 * 'followup2' (and up) for the later steps, so the history reads clearly.
 */
function followUpKind(stage) {
  return Number(stage) <= 1 ? 'followup' : `followup${Number(stage)}`;
}

/**
 * Resolve the resume to attach.
 *
 * Priority:
 *   1. ATTACHMENT_PATH env var (explicit override)
 *   2. assets/resume.pdf
 *   3. any single *.pdf dropped into assets/ (so "just put your resume there" works)
 *
 * Resolved on every send, not at boot, so adding the file does not require a restart.
 */
export function resolveAttachmentPath() {
  if (process.env.ATTACHMENT_PATH) {
    const p = path.resolve(process.env.ATTACHMENT_PATH);
    return fs.existsSync(p) ? p : null;
  }

  const preferred = path.join(ASSETS_DIR, 'resume.pdf');
  if (fs.existsSync(preferred)) return preferred;

  try {
    const pdfs = fs
      .readdirSync(ASSETS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .sort();
    if (pdfs.length) return path.join(ASSETS_DIR, pdfs[0]);
  } catch {
    /* assets dir missing */
  }
  return null;
}

/**
 * Personalize a subject/body pair and wrap it in the chosen theme.
 * Placeholder substitution runs first, so [if job id] blocks behave the same
 * regardless of theme.
 */
export function composeEmail({ subject, template, candidate, theme }) {
  const name = THEMES.includes(theme) ? theme : DEFAULT_THEME;

  const finalSubject = normalizeQuotes(fillTemplate(subject, candidate));
  const personalized = normalizeQuotes(fillTemplate(template, candidate));

  if (name === 'plain') {
    return {
      subject: finalSubject,
      html: renderEmail('plain', {
        bodyHtml: personalized,
        preheaderText: buildPreheader(personalized),
      }),
      text: htmlToText(personalized),
    };
  }

  // Every non-plain theme lifts <ul> items into its own highlight treatment.
  const { body, highlights } = extractHighlights(personalized);
  const brand = getBranding();

  return {
    subject: finalSubject,
    html: renderEmail(name, {
      bodyHtml: body,
      highlights,
      // Snippet comes from the visible intro, not the lifted bullet list.
      preheaderText: buildPreheader(body),
      // `branded` option names...
      ...brand,
      // ...plus the shorter names the other themes expect.
      name: brand.wordmark,
      tagline: brand.tagline,
      accent: brand.accentColor,
      contactLines: brand.contactLines || [
        process.env.BRAND_PHONE || '+91-9967418222',
        process.env.EMAIL_USERNAME || 'vishnunair2323@gmail.com',
      ],
    }),
    text: htmlToText(personalized),
  };
}

let warnedNoAttachment = false;

function buildAttachments() {
  const file = resolveAttachmentPath();

  if (!file) {
    if (!warnedNoAttachment) {
      warnedNoAttachment = true;
      console.warn(
        `No resume found - emails will be sent WITHOUT an attachment.\n` +
          `   Place a PDF at ${path.join(ASSETS_DIR, 'resume.pdf')} or set ATTACHMENT_PATH.`
      );
    }
    return [];
  }

  warnedNoAttachment = false;
  console.log(`Attaching ${path.basename(file)}`);
  return [
    {
      filename: path.basename(file),
      path: file,
      contentType: 'application/pdf',
    },
  ];
}

/**
 * Core send loop, shared by the immediate route and the scheduler.
 * Sends sequentially and records each Message-ID for later follow-ups.
 */
export async function runSendJob({
  candidates,
  emailSubject,
  emailTemplate,
  theme,
  batchId,
  batchLabel,
  onProgress,
}) {
  assertMailConfig();
  const transporter = getTransporter();

  const results = [];
  let successCount = 0;
  let failCount = 0;

  console.log(`Starting email job for ${candidates.length} candidate(s)`);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    try {
      if (!candidate?.email) throw new Error('Candidate is missing an email address');

      const rawSubject = candidate.emailSubject || emailSubject;
      const rawHtml = candidate.emailTemplate || emailTemplate;
      if (!rawSubject || !rawHtml) {
        throw new Error('No subject/template provided for this candidate');
      }

      const { subject, html, text } = composeEmail({
        subject: rawSubject,
        template: rawHtml,
        candidate,
        theme: candidate.theme || theme,
      });
      const cc = normalizeCc(candidate.cc);

      const info = await transporter.sendMail({
        from: process.env.EMAIL_USERNAME,
        to: candidate.email,
        cc,
        subject,
        html,
        text,
        attachments: buildAttachments(),
      });

      await store.save(
        candidate.email,
        {
          messageId: info.messageId,
          subject,
          name: candidate.name,
          companyName: candidate.companyName,
          jobDescription: candidate.jobDescription,
          jobId: candidate.jobId || '',
          cc,
          theme: candidate.theme || theme || undefined,
          sentAt: new Date().toISOString(),
        },
        { batchId, label: batchLabel }
      );

      // Permanent contact log - never pruned, powers dedupe on the next upload.
      await contacts.recordSend({
        email: candidate.email,
        name: candidate.name,
        companyName: candidate.companyName,
        subject,
        theme: candidate.theme || theme || undefined,
        batchId,
        batchLabel,
        kind: 'initial',
      });

      successCount++;
      results.push({ email: candidate.email, status: 'fulfilled' });
      console.log(`Sent to ${candidate.email} (${successCount} ok so far)`);
    } catch (err) {
      failCount++;
      results.push({ email: candidate?.email, status: 'rejected', reason: err.message });
      console.error(`Failed to send to ${candidate?.email}: ${err.message}`);
    }

    if (typeof onProgress === 'function') {
      await onProgress({ sent: successCount, failed: failCount, total: candidates.length });
    }

    if (i < candidates.length - 1 && SEND_DELAY_MS > 0) {
      await sleep(SEND_DELAY_MS);
    }
  }

  console.log(`Job finished: ${successCount} success, ${failCount} failed`);
  return { successCount, failCount, results };
}

/**
 * POST /api/sendCustomEmails
 * body: { candidates, emailSubject, emailTemplate, theme, batchId, batchLabel }
 * Sends immediately.
 */
router.post('/sendCustomEmails', async (req, res, next) => {
  const { candidates, emailSubject, emailTemplate, theme, batchId, batchLabel } =
    req.body || {};

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ message: 'No candidates provided' });
  }

  try {
    const { successCount, failCount, results } = await runSendJob({
      candidates,
      emailSubject,
      emailTemplate,
      theme,
      batchId,
      batchLabel,
    });

    return res.status(failCount ? 207 : 200).json({
      message: failCount ? `${failCount} email(s) failed` : 'All emails sent successfully',
      successCount,
      failCount,
      results,
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/themes — available themes with labels and deliverability risk. */
router.get('/themes', (req, res) => {
  res.json({
    themes: THEMES.map((key) => ({ key, ...THEME_META[key] })),
    default: DEFAULT_THEME,
  });
});

/**
 * POST /api/preview — render exactly what would be sent, without sending.
 * Returns rendered HTML so the UI can show it in an iframe.
 * Also serves as a dry run: no SMTP connection is opened.
 */
router.post('/preview', (req, res, next) => {
  try {
    const { candidate = {}, emailSubject, emailTemplate, theme } = req.body || {};
    if (!emailTemplate) {
      return res.status(400).json({ message: 'emailTemplate is required' });
    }

    const composed = composeEmail({
      subject: emailSubject || '',
      template: emailTemplate,
      candidate,
      theme: theme || DEFAULT_THEME,
    });

    const file = resolveAttachmentPath();
    res.json({
      ...composed,
      theme: THEMES.includes(theme) ? theme : DEFAULT_THEME,
      attachment: file ? path.basename(file) : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/preview/batch — render every candidate at once, without sending.
 * Lets the UI show a preview card per CSV row right after upload.
 *
 * body: { candidates: [...], emailSubject, emailTemplate, theme }
 * Per-row emailSubject/emailTemplate still win over the shared copy, exactly
 * as they do when sending.
 */
router.post('/preview/batch', (req, res, next) => {
  try {
    const { candidates, emailSubject, emailTemplate, theme } = req.body || {};

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ message: 'Candidates array is required' });
    }

    const chosen = THEMES.includes(theme) ? theme : DEFAULT_THEME;
    const file = resolveAttachmentPath();

    const previews = candidates.map((candidate, index) => {
      const rawSubject = candidate?.emailSubject || emailSubject;
      const rawHtml = candidate?.emailTemplate || emailTemplate;

      if (!rawSubject || !rawHtml) {
        return {
          index,
          email: candidate?.email,
          name: candidate?.name,
          error: 'No subject/template for this candidate',
        };
      }

      // Per-row theme wins over the batch default, mirroring how sending works.
      const rowTheme = THEMES.includes(candidate?.theme) ? candidate.theme : chosen;

      try {
        const composed = composeEmail({
          subject: rawSubject,
          template: rawHtml,
          candidate,
          theme: rowTheme,
        });
        return {
          index,
          email: candidate?.email,
          name: candidate?.name,
          cc: normalizeCc(candidate?.cc) || null,
          theme: rowTheme,
          themeOverridden: rowTheme !== chosen,
          ...composed,
        };
      } catch (err) {
        return { index, email: candidate?.email, name: candidate?.name, error: err.message };
      }
    });

    res.json({
      theme: chosen,
      attachment: file ? path.basename(file) : null,
      count: previews.length,
      previews,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/followups/batches — upload batches with pending follow-ups. */
router.get('/followups/batches', async (req, res, next) => {
  try {
    res.status(200).json({ batches: await store.listBatches() });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/followups/batches/:batchId — discard a batch without mailing. */
router.delete('/followups/batches/:batchId', async (req, res, next) => {
  try {
    await store.removeBatch(req.params.batchId);
    res.status(200).json({ message: 'Batch removed', batches: await store.listBatches() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/attachment — quick check that the resume is actually being picked up. */
router.get('/attachment', (req, res) => {
  const file = resolveAttachmentPath();
  res.json({
    attached: Boolean(file),
    fileName: file ? path.basename(file) : null,
    lookedIn: process.env.ATTACHMENT_PATH
      ? path.resolve(process.env.ATTACHMENT_PATH)
      : ASSETS_DIR,
  });
});

/**
 * GET /api/followups/templates — the built-in copy for every follow-up step,
 * so the UI and the send route share one source of truth.
 */
router.get('/followups/templates', (req, res) => {
  res.json({ maxFollowUps: MAX_FOLLOW_UPS, stages: listStages() });
});

/**
 * GET /api/followups?batchId=&stage= — who is awaiting a follow-up.
 *
 * `stage` filters to one step of the chain (people waiting for follow-up 2,
 * say). Every candidate carries stage/nextFollowUp, so callers can group the
 * list themselves; `stages` gives the counts per step.
 */
router.get('/followups', async (req, res, next) => {
  try {
    const { batchId, stage } = req.query;

    if (stage !== undefined && stage !== '' && !isStage(stage)) {
      return res
        .status(400)
        .json({ message: `stage must be between 1 and ${MAX_FOLLOW_UPS}` });
    }

    const wanted = stage === undefined || stage === '' ? null : Number(stage);
    const all = await store.listCandidates(batchId);

    res.status(200).json({
      maxFollowUps: MAX_FOLLOW_UPS,
      pending: all.length,
      stages: listStages().map((s) => ({
        stage: s.stage,
        label: s.label,
        blurb: s.blurb,
        final: s.final,
        waiting: all.filter((c) => c.nextFollowUp === s.stage).length,
      })),
      batches: await store.listBatches(),
      candidates: wanted === null ? all : all.filter((c) => c.nextFollowUp === wanted),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sendFollowUpEmails
 * Replies in the original Gmail thread using inReplyTo/references.
 *
 * body: { candidates?, batchId?, stage?, emailSubject?, emailTemplate?, theme? }
 *
 * `stage` is which follow-up to send (1 = first nudge, 2 = the final note).
 * A candidate can only ever receive the step they are actually waiting for:
 * people awaiting follow-up 2 are skipped by a stage-1 request rather than
 * getting the same nudge twice. Once the last step has gone out the entry is
 * dropped, so nobody is chased past MAX_FOLLOW_UPS.
 */
router.post('/sendFollowUpEmails', async (req, res, next) => {
  const {
    candidates: bodyCandidates,
    emailSubject,
    emailTemplate,
    theme,
    batchId,
    stage,
  } = req.body || {};

  if (stage !== undefined && stage !== null && !isStage(stage)) {
    return res
      .status(400)
      .json({ message: `stage must be between 1 and ${MAX_FOLLOW_UPS}` });
  }
  const requestedStage = isStage(stage) ? Number(stage) : undefined;

  // Either pass explicit candidates, or just a batchId (plus optionally a
  // stage) to work through that upload without listing everyone client-side.
  let candidates = bodyCandidates;
  if ((!Array.isArray(candidates) || candidates.length === 0) && batchId) {
    candidates = await store.listCandidates(batchId, { stage: requestedStage });
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({
      message: requestedStage
        ? `No candidates awaiting follow-up ${requestedStage}`
        : 'Provide a candidates array or a batchId with pending follow-ups',
    });
  }

  try {
    assertMailConfig();
    const transporter = getTransporter();

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const rowBatchId = candidate?.batchId || batchId;
      const stored = candidate?.email
        ? await store.get(candidate.email, rowBatchId)
        : undefined;

      if (!stored?.messageId) {
        skippedCount++;
        results.push({
          email: candidate?.email,
          status: 'skipped',
          reason: 'No original message id found',
        });
        continue;
      }

      const awaiting = nextFollowUp(stored);
      const target = requestedStage || awaiting;

      // Never send the wrong step: a follow-up 2 request cannot nudge someone
      // who is still waiting for follow-up 1, and vice versa.
      if (target !== awaiting) {
        skippedCount++;
        results.push({
          email: candidate.email,
          status: 'skipped',
          stage: target,
          reason: `Awaiting follow-up ${awaiting}, not follow-up ${target}`,
        });
        continue;
      }

      const merged = { ...stored, ...candidate };
      // Request copy, then that stage's built-in copy - so a bare
      // { batchId, stage } request is still sendable.
      const defaults = copyFor(target);
      const rawSubject = candidate.emailSubject || emailSubject || defaults.subject;
      const rawHtml = candidate.emailTemplate || emailTemplate || defaults.template;

      if (!rawHtml) {
        skippedCount++;
        results.push({
          email: candidate.email,
          status: 'skipped',
          stage: target,
          reason: 'No template provided',
        });
        continue;
      }

      // The conversation so far: reply to the newest message inside it, and
      // reference every message before it so clients nest the reply correctly.
      const thread = stored.thread?.length ? stored.thread : [stored.messageId];
      const parentId = thread[thread.length - 1] || stored.messageId;

      try {
        // Threading works best when the subject matches the original.
        const baseSubject =
          stored.subject || rawSubject || 'Following up';
        const { subject, html, text } = composeEmail({
          subject: baseSubject,
          template: rawHtml,
          candidate: merged,
          theme: candidate.theme || theme,
        });

        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

        const info = await transporter.sendMail({
          from: process.env.EMAIL_USERNAME,
          to: candidate.email,
          cc: normalizeCc(candidate.cc || stored.cc),
          subject: replySubject,
          html,
          text,
          inReplyTo: parentId,
          references: thread,
        });

        const { removed, nextFollowUp: upcoming } = await store.recordFollowUp(
          candidate.email,
          rowBatchId || stored.batchId,
          {
            messageId: info.messageId,
            subject: replySubject,
            stage: target,
          }
        );

        await contacts.recordSend({
          email: candidate.email,
          name: merged.name,
          companyName: merged.companyName,
          subject: replySubject,
          theme: candidate.theme || theme || undefined,
          batchId: rowBatchId || stored.batchId,
          batchLabel: stored.batchLabel,
          kind: followUpKind(target),
          followUpStage: target,
        });

        successCount++;
        results.push({
          email: candidate.email,
          status: 'fulfilled',
          stage: target,
          messageId: info.messageId,
          // null once the chain is finished - no further chasing.
          nextFollowUp: removed ? null : upcoming,
        });
        console.log(
          `${stageLabel(target)} sent to ${candidate.email}` +
            (removed ? ' (chain complete)' : ` (next: follow-up ${upcoming})`)
        );
      } catch (err) {
        failCount++;
        results.push({
          email: candidate.email,
          status: 'rejected',
          stage: target,
          reason: err.message,
        });
        console.error(`Follow-up failed for ${candidate.email}: ${err.message}`);
      }

      if (i < candidates.length - 1 && SEND_DELAY_MS > 0) {
        await sleep(SEND_DELAY_MS);
      }
    }

    const label = requestedStage ? stageLabel(requestedStage) : 'Follow-up';
    return res.status(failCount ? 207 : 200).json({
      message: failCount
        ? `${label}: ${failCount} email(s) failed`
        : `${label} emails sent successfully`,
      stage: requestedStage || null,
      successCount,
      failCount,
      skippedCount,
      results,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
