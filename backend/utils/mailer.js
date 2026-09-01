import nodemailer from 'nodemailer';

let transporter;

/**
 * Single shared Gmail transporter.
 * EMAIL_PASSWORD must be a Google "App Password", not the account password.
 */
export function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? 'true') === 'true',
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
      pool: true,
      maxConnections: 1,
      // Only for self-hosted/dev SMTP with a self-signed certificate.
      // Leave unset for Gmail.
      ...(process.env.SMTP_REJECT_UNAUTHORIZED === 'false'
        ? { tls: { rejectUnauthorized: false } }
        : {}),
    });
  }
  return transporter;
}

export function assertMailConfig() {
  if (!process.env.EMAIL_USERNAME || !process.env.EMAIL_PASSWORD) {
    const err = new Error(
      'EMAIL_USERNAME / EMAIL_PASSWORD are not configured. Copy .env.example to .env.'
    );
    err.statusCode = 500;
    throw err;
  }
}
