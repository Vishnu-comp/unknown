// Contact history + pre-send validation.

import express from 'express';
import * as contacts from '../utils/contactStore.js';
import { validateRows } from '../utils/validateRows.js';

const router = express.Router();

/**
 * POST /api/validate
 * body: { candidates: [...] }
 * Annotates each row with errors/warnings/prior-contact info. Read-only:
 * calling this never sends anything and never writes to the contact log.
 */
router.post('/validate', async (req, res, next) => {
  try {
    const { candidates } = req.body || {};
    if (!Array.isArray(candidates)) {
      return res.status(400).json({ message: 'Candidates array is required' });
    }
    const { rows, summary } = await validateRows(candidates);
    res.json({ rows, summary });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contacts?search=&limit= — everyone ever emailed, newest first. */
router.get('/contacts', async (req, res, next) => {
  try {
    const { search = '', limit } = req.query;
    const list = await contacts.listContacts({
      search: String(search),
      limit: Math.min(Number(limit) || 500, 2000),
    });
    res.json({ contacts: list, stats: await contacts.stats() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/contacts/:email — one contact with full send history. */
router.get('/contacts/:email', async (req, res, next) => {
  try {
    const contact = await contacts.getContact(req.params.email);
    if (!contact) return res.status(404).json({ message: 'No history for that address' });
    res.json({ contact });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/contacts/:email — forget someone (they stop being flagged). */
router.delete('/contacts/:email', async (req, res, next) => {
  try {
    const contact = await contacts.getContact(req.params.email);
    if (!contact) return res.status(404).json({ message: 'No history for that address' });

    await contacts.removeContact(req.params.email);
    res.json({ message: 'Removed', stats: await contacts.stats() });
  } catch (err) {
    next(err);
  }
});

export default router;
