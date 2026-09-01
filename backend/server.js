import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';

import uploadRoutes from './routes/uploadCSV.js';
import emailRoutes from './routes/sendEmails.js';
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

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

export default app;
