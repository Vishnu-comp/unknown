// Scheduled "send later" jobs.
//
// Gmail's own Schedule send is a UI-only feature — it is not exposed over SMTP
// or the Gmail API — so the delay is handled here and the backend must be
// awake at send time. Deploy it somewhere always-on (see DEPLOY.md).

import express from 'express';
import * as jobs from '../utils/scheduleStore.js';
import * as scheduler from '../utils/scheduler.js';

const router = express.Router();

/** GET /api/schedule — all jobs, soonest first. */
router.get('/schedule', async (req, res, next) => {
  try {
    res.json({
      jobs: await jobs.listJobs(),
      serverTime: new Date().toISOString(),
      activeTimers: scheduler.activeTimerCount(),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/schedule/:id — one job including its results. */
router.get('/schedule/:id', async (req, res, next) => {
  try {
    const job = await jobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/schedule — queue a batch for later.
 * body: { runAt (ISO), candidates, emailSubject, emailTemplate, theme,
 *         batchId, batchLabel, label }
 */
router.post('/schedule', async (req, res, next) => {
  try {
    const {
      runAt,
      candidates,
      emailSubject,
      emailTemplate,
      theme,
      batchId,
      batchLabel,
      label,
    } = req.body || {};

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ message: 'Candidates array is required' });
    }
    if (!emailSubject || !emailTemplate) {
      return res.status(400).json({ message: 'emailSubject and emailTemplate are required' });
    }

    const when = new Date(runAt);
    if (!runAt || Number.isNaN(when.getTime())) {
      return res.status(400).json({ message: 'runAt must be a valid ISO date-time' });
    }
    // Small tolerance for clock skew between browser and server.
    if (when.getTime() < Date.now() - 60_000) {
      return res.status(400).json({ message: 'runAt is in the past' });
    }

    const job = {
      id: jobs.newJobId(),
      label: label || batchLabel || 'Scheduled send',
      status: 'scheduled',
      runAt: when.toISOString(),
      createdAt: new Date().toISOString(),
      candidates,
      emailSubject,
      emailTemplate,
      theme,
      batchId,
      batchLabel,
      progress: { sent: 0, failed: 0, total: candidates.length },
    };

    await jobs.createJob(job);
    scheduler.arm(job);

    res.status(201).json({ message: 'Scheduled', job: await jobs.getJob(job.id) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/schedule/:id — cancel a pending job (or remove a finished one). */
router.delete('/schedule/:id', async (req, res, next) => {
  try {
    const job = await jobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    scheduler.cancel(job.id);

    if (job.status === 'scheduled') {
      await jobs.updateJob(job.id, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
      });
      return res.json({ message: 'Cancelled', jobs: await jobs.listJobs() });
    }

    await jobs.removeJob(job.id);
    res.json({ message: 'Removed', jobs: await jobs.listJobs() });
  } catch (err) {
    next(err);
  }
});

export default router;
