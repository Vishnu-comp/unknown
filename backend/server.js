import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';

import uploadRoutes from './routes/uploadCSV.js';
import emailRoutes from './routes/sendEmails.js';
import galleryRoutes from './routes/gallery.js';
import scheduleRoutes from './routes/schedule.js';
import { runSendJob } from './routes/sendEmails.js';
import * as scheduler from './utils/scheduler.js';
import { UPLOAD_DIR } from './routes/uploadCSV.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Static access to uploaded CSVs
app.use('/api/uploads/csv', express.static(UPLOAD_DIR));

// CSV upload/download
app.use('/api', uploadRoutes);
// sendCustomEmails + followups + sendFollowUpEmails
app.use('/api', emailRoutes);
// Review-only theme gallery
app.use('/api', galleryRoutes);
// Scheduled "send later" jobs
app.use('/api', scheduleRoutes);

app.use((req, res) => res.status(404).json({ message: `Not found: ${req.originalUrl}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  console.error('Unhandled error:', err);
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

// Wire the scheduler to the shared send loop, then re-arm persisted jobs.
scheduler.setRunner((job) =>
  runSendJob({
    candidates: job.candidates,
    emailSubject: job.emailSubject,
    emailTemplate: job.emailTemplate,
    theme: job.theme,
    batchId: job.batchId,
    batchLabel: job.batchLabel,
  })
);

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  scheduler.restore().catch((err) => console.error('Scheduler restore failed:', err));
});

export default app;
