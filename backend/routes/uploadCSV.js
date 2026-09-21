import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'csv');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^\w.\-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) || file.mimetype.includes('csv');
    cb(ok ? null : new Error('Only .csv files are allowed'), ok);
  },
});

router.post('/uploadCSV', upload.single('csvFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  res.status(200).json({ fileName: req.file.filename });
});

router.get('/getCSVFile/:fileName', (req, res) => {
  // basename() prevents ../ path traversal
  const fileName = path.basename(req.params.fileName);
  const filePath = path.join(UPLOAD_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'CSV file not found' });
  }
  res.type('text/csv').sendFile(filePath);
});

export default router;
