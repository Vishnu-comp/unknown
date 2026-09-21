// Saved batches: "send later" means "keep it until I press Send".
// Nothing sends on its own, so no scheduler and no always-on server.

import express from 'express';
import * as drafts from '../utils/draftStore.js';
import { runSendJob } from './sendEmails.js';

const router = express.Router();

/** GET /api/drafts — saved batches, newest first. */
router.get('/drafts', async (req, res, next) => {
  try {
    res.json({ drafts: await drafts.listDrafts() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/drafts/:id — one saved batch including its candidates. */
router.get('/drafts/:id', async (req, res, next) => {
  try {
    const draft = await drafts.getDraft(req.params.id);
    if (!draft) return res.status(404).json({ message: 'Saved batch not found' });
    res.json({ draft });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/drafts — save a batch for later.
 * body: { candidates, emailSubject, emailTemplate, theme, label, note,
 *         batchId, batchLabel }
 */
router.post('/drafts', async (req, res, next) => {
  try {
    const {
      candidates,
      emailSubject,
      emailTemplate,
      theme,
      label,
      note,
      batchId,
      batchLabel,
    } = req.body || {};

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ message: 'Candidates array is required' });
    }
    if (!emailSubject || !emailTemplate) {
      return res.status(400).json({ message: 'emailSubject and emailTemplate are required' });
    }

    const now = new Date().toISOString();
    const draft = {
      id: drafts.newDraftId(),
      label: label || batchLabel || 'Saved batch',
      note: note || '',
      createdAt: now,
      updatedAt: now,
      candidates,
      emailSubject,
      emailTemplate,
      theme,
      batchId,
      batchLabel,
    };

    await drafts.saveDraft(draft);
    res.status(201).json({ message: 'Saved', drafts: await drafts.listDrafts() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/drafts/:id/send — send a saved batch now.
 * Removed from the saved list once it has been sent.
 */
router.post('/drafts/:id/send', async (req, res, next) => {
  try {
    const draft = await drafts.getDraft(req.params.id);
    if (!draft) return res.status(404).json({ message: 'Saved batch not found' });

    const { successCount, failCount, results } = await runSendJob({
      candidates: draft.candidates,
      emailSubject: draft.emailSubject,
      emailTemplate: draft.emailTemplate,
      theme: draft.theme,
      batchId: draft.batchId,
      batchLabel: draft.batchLabel || draft.label,
    });

    // Keep it on failure so nothing is lost and it can be retried.
    if (successCount > 0 && failCount === 0) {
      await drafts.removeDraft(draft.id);
    }

    res.status(failCount ? 207 : 200).json({
      message: failCount ? `${failCount} email(s) failed` : 'All emails sent successfully',
      successCount,
      failCount,
      results,
      kept: failCount > 0,
      drafts: await drafts.listDrafts(),
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/drafts/:id — discard a saved batch. */
router.delete('/drafts/:id', async (req, res, next) => {
  try {
    const draft = await drafts.getDraft(req.params.id);
    if (!draft) return res.status(404).json({ message: 'Saved batch not found' });

    await drafts.removeDraft(req.params.id);
    res.json({ message: 'Removed', drafts: await drafts.listDrafts() });
  } catch (err) {
    next(err);
  }
});

export default router;
