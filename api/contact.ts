import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || '');

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

  if (!process.env.RESEND_API_KEY) {
    return res
      .status(500)
      .json({ error: 'E-Mail Service ist nicht konfiguriert.' });
  }

  const { name, childName, email, phone, message, agb, privacy, page } =
    (req.body || {}) as {
      name?: string;
      childName?: string;
      email?: string;
      phone?: string;
      message?: string;
      agb?: boolean;
      privacy?: boolean;
      page?: string;
    };

  // Простая серверная валидация (на случай, если кто-то обойдёт фронт)
  if (!name || !childName || !email || !phone || !agb || !privacy) {
    return res
      .status(400)
      .json({ error: 'Bitte füllen Sie alle Pflichtfelder aus.' });
  }

  const to = process.env.CONTACT_TO_EMAIL;
  if (!to) {
    return res
      .status(500)
      .json({ error: 'Kontakt-E-Mail ist nicht konfiguriert.' });
  }

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
    const { error } = await resend.emails.send({
      // Пока используем стандартный отправитель Resend
      from: 'Clavis Kontaktformular <onboarding@resend.dev>',
      to,
      subject,
      text: textBody,
      replyTo: email,
    });

    if (error) {
      console.error('Resend error', error);
      return res.status(500).json({ error: 'Fehler beim Senden der E-Mail.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Mail send error', err);
    return res.status(500).json({ error: 'Fehler beim Senden der E-Mail.' });
  }
}
