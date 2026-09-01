import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { getTransporter, assertMailConfig } from '../utils/mailer.js';
import * as store from '../utils/messageStore.js';
import {
  fillTemplate,
  normalizeQuotes,
  htmlToText,
  normalizeCc,
  sleep,
} from '../utils/template.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Delay between mails in a single batch (Gmail rate-limit friendly).
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 15000);

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

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
 * POST /api/sendCustomEmails
 * body: { candidates: [{ email, name, companyName, jobDescription, jobId, cc,
 *                        emailSubject?, emailTemplate? }],
 *         emailSubject?, emailTemplate? }
 *
 * Sends sequentially, stores each Message-ID for later follow-ups.
 */
router.post('/sendCustomEmails', async (req, res, next) => {
  const { candidates, emailSubject, emailTemplate } = req.body || {};

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ message: 'No candidates provided' });
  }

  try {
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

        const subject = normalizeQuotes(fillTemplate(rawSubject, candidate));
        const html = normalizeQuotes(fillTemplate(rawHtml, candidate));
        const cc = normalizeCc(candidate.cc);

        const info = await transporter.sendMail({
          from: process.env.EMAIL_USERNAME,
          to: candidate.email,
          cc,
          subject,
          html,
          text: htmlToText(html),
          attachments: buildAttachments(),
        });

        await store.save(candidate.email, {
          messageId: info.messageId,
          subject,
          name: candidate.name,
          companyName: candidate.companyName,
          jobDescription: candidate.jobDescription,
          jobId: candidate.jobId || '',
          cc,
          sentAt: new Date().toISOString(),
        });

        successCount++;
        results.push({ email: candidate.email, status: 'fulfilled' });
        console.log(`Sent to ${candidate.email} (${successCount} ok so far)`);
      } catch (err) {
        failCount++;
        results.push({ email: candidate?.email, status: 'rejected', reason: err.message });
        console.error(`Failed to send to ${candidate?.email}: ${err.message}`);
      }

      if (i < candidates.length - 1 && SEND_DELAY_MS > 0) {
        await sleep(SEND_DELAY_MS);
      }
    }

    console.log(`Job finished: ${successCount} success, ${failCount} failed`);

    return res
      .status(failCount ? 207 : 200)
      .json({
        message: failCount ? `${failCount} email(s) failed` : 'All emails sent successfully',
        successCount,
        failCount,
        results,
      });
  } catch (err) {
    return next(err);
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

/** GET /api/followups — candidates awaiting a follow-up. */
router.get('/followups', async (req, res, next) => {
  try {
    res.status(200).json({ candidates: await store.listCandidates() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sendFollowUpEmails
 * Replies in the original Gmail thread using inReplyTo/references.
 * Successful follow-ups are removed from the store so nobody is chased twice.
 */
router.post('/sendFollowUpEmails', async (req, res, next) => {
  const { candidates, emailSubject, emailTemplate } = req.body || {};

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ message: 'Candidates array is required' });
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
      const stored = candidate?.email ? await store.get(candidate.email) : undefined;

      if (!stored?.messageId) {
        skippedCount++;
        results.push({
          email: candidate?.email,
          status: 'skipped',
          reason: 'No original message id found',
        });
        continue;
      }

      const merged = { ...stored, ...candidate };
      const rawHtml = candidate.emailTemplate || emailTemplate;

      if (!rawHtml) {
        skippedCount++;
        results.push({ email: candidate.email, status: 'skipped', reason: 'No template provided' });
        continue;
      }

      try {
        // Threading works best when the subject matches the original.
        const baseSubject =
          stored.subject || candidate.emailSubject || emailSubject || 'Following up';
        const subject = normalizeQuotes(fillTemplate(baseSubject, merged));
        const html = normalizeQuotes(fillTemplate(rawHtml, merged));

        await transporter.sendMail({
          from: process.env.EMAIL_USERNAME,
          to: candidate.email,
          cc: normalizeCc(candidate.cc || stored.cc),
          subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
          html,
          text: htmlToText(html),
          inReplyTo: stored.messageId,
          references: [stored.messageId],
        });

        await store.remove(candidate.email);

        successCount++;
        results.push({ email: candidate.email, status: 'fulfilled' });
        console.log(`Follow-up sent to ${candidate.email}`);
      } catch (err) {
        failCount++;
        results.push({ email: candidate.email, status: 'rejected', reason: err.message });
        console.error(`Follow-up failed for ${candidate.email}: ${err.message}`);
      }

      if (i < candidates.length - 1 && SEND_DELAY_MS > 0) {
        await sleep(SEND_DELAY_MS);
      }
    }

    return res.status(failCount ? 207 : 200).json({
      message: failCount ? `${failCount} follow-up(s) failed` : 'Follow-up emails sent successfully',
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
