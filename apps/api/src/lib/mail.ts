import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

let transporter: Transporter;

function getTransport(): Transporter {
  if (transporter) return transporter;
  if (env.SMTP_HOST && env.SMTP_PORT) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  } else {
    // MVP fallback: log messages to console instead of sending.
    transporter = nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: MailInput): Promise<void> {
  const t = getTransport();
  const info = await t.sendMail({ from: env.MAIL_FROM, ...input });
  if (!env.SMTP_HOST) {
    // eslint-disable-next-line no-console
    console.log(`\n[MAIL → ${input.to}] ${input.subject}\n${input.text}\n`);
  }
  return void info;
}
