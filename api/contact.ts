import nodemailer from 'nodemailer';

export default async function handler(req: any, res: any) {
  const ALLOWED_ORIGINS = [
    'https://my.readymag.com',
    'https://readymag.com',
    'https://readymag.website',
  ];

  const origin = req.headers.origin as string | undefined;
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : '';

  // CORS для любого ответа
  res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, childName, email, phone, message, agb, privacy, page } =
    req.body || {};

  // Простая серверная валидация (на всякий случай)
  if (!name || !childName || !email || !phone || !agb || !privacy) {
    return res
      .status(400)
      .json({ error: 'Bitte füllen Sie alle Pflichtfelder aus.' });
  }

  const to = process.env.CONTACT_TO_EMAIL;
  const from = process.env.CONTACT_FROM_EMAIL || process.env.CONTACT_TO_EMAIL;

  if (!to) {
    return res
      .status(500)
      .json({ error: 'Kontakt-E-Mail ist nicht konfiguriert.' });
  }

  // Настройка SMTP из env
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false', // по умолчанию true
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const subject = `[Clavis Kontaktformular] Neue Nachricht von ${name}`;

  const textBody = `
    Neue Nachricht vom Kontaktformular:

    Name:        ${name}
    Kind:        ${childName}
    E-Mail:      ${email}
    Telefon:     ${phone}
    AGB:         ${agb ? 'ja' : 'nein'}
    Datenschutz: ${privacy ? 'ja' : 'nein'}
    Seite:       ${page || '-'}

    Nachricht:
    ${message || '(keine Nachricht)'}
  `.trim();

  try {
    await transporter.sendMail({
      to,
      from,
      subject,
      text: textBody,
      replyTo: email, // чтобы можно было просто нажать "Ответить" клиенту
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Mail send error', err);
    return res.status(500).json({ error: 'Fehler beim Senden der E-Mail.' });
  }
}
