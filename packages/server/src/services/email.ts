import nodemailer from 'nodemailer';

// Fail-closed: anything other than an explicit 'development' is treated as
// production so a missing/mistyped NODE_ENV cannot silently route legal mail
// to stdout.
const isDev = process.env.NODE_ENV === 'development';
const SMTP_HOST = process.env.SMTP_HOST;

if (!isDev && !SMTP_HOST) {
  throw new Error('SMTP_HOST must be set in production so legal/contact email can be delivered');
}

// In development, log emails to console instead of sending
// In production, configure via SMTP env vars
const transporter = isDev
  ? null
  : nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@plainspace.org';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'hello@plainspace.org';
const APP_URL = process.env.APP_URL || 'https://plainspace.org';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendVerificationCode(
  email: string,
  code: string,
  projectName: string,
): Promise<void> {
  const safeName = escapeHtml(projectName);
  const privacyUrl = `${APP_URL}/privacy`;
  const subject = `Your verification code for "${projectName}"`;
  const text = `Your Plainspace code is: ${code}\n\nThis code expires in 10 minutes.\n\nEnter this code in the Plainspace app to continue.\n\nPrivacy Policy: ${privacyUrl}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Your Plainspace code</h2>
      <p>Your verification code for <strong>${safeName}</strong> is:</p>
      <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #6c63ff;">${code}</span>
      </div>
      <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
      <p style="color: #666; font-size: 12px;"><a href="${privacyUrl}">Privacy Policy</a></p>
    </div>
  `;

  if (isDev) {
    console.log(`\n[EMAIL] To: ${email}`);
    console.log(`[EMAIL] Subject: ${subject}`);
    console.log(`[EMAIL] Code: ${code}\n`);
    return;
  }

  await transporter!.sendMail({ from: FROM_EMAIL, to: email, subject, text, html });
}

// "Find my Spaces": emails the address owner one-click sign-in links to the
// Spaces they added this email to, so they can re-open one on a device whose
// localStorage was wiped or never had it — e.g. an iOS home-screen PWA, which
// gets a fresh storage container separate from Safari. Each link carries a
// single-use login code in the URL *fragment* (never sent to the server) plus
// the owner's email, so opening it redeems the code client-side for a fresh
// token — no code typing.
export async function sendSpacesList(
  email: string,
  spaces: { slug: string; name: string; code: string }[],
): Promise<void> {
  const emailParam = Buffer.from(email, 'utf8').toString('base64url');
  const links = spaces.map((s) => ({
    name: s.name,
    url: `${APP_URL}/${s.slug}#login=${s.code}.${emailParam}`,
  }));
  const subject = 'Your Plainspace Spaces';
  const text =
    `Here are the Spaces linked to this email. Open a link to sign in — no code needed:\n\n` +
    links.map((l) => `${l.name}: ${l.url}`).join('\n') +
    `\n\nThese links sign you in and expire shortly. Don't forward them.`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Your Spaces</h2>
      <p>Open a link to sign in — no code needed:</p>
      <ul style="padding-left: 18px;">
        ${links
          .map(
            (l) =>
              `<li style="margin: 8px 0;"><a href="${escapeHtml(l.url)}">${escapeHtml(l.name)}</a></li>`,
          )
          .join('')}
      </ul>
      <p style="color: #666; font-size: 14px;">These links sign you in and expire shortly. Don't forward them.</p>
    </div>
  `;

  if (isDev) {
    console.log(`\n[EMAIL] To: ${email}`);
    console.log(`[EMAIL] Subject: ${subject}`);
    for (const l of links) console.log(`[EMAIL] ${l.name}: ${l.url}`);
    console.log('');
    return;
  }

  await transporter!.sendMail({ from: FROM_EMAIL, to: email, subject, text, html });
}

// Item reminder fallback. Sent by the reminder sweep when the target member
// has no push subscriptions (iOS Safari without PWA install, denied
// permission, never subscribed). Body includes the item text — SMTP is
// already a disclosed subprocessor, unlike FCM/Mozilla Autopush which we
// avoid by keeping push payloads to IDs only.
export async function sendReminderEmail(input: {
  toEmail: string;
  itemText: string;
  projectName: string;
  itemUrl: string;
}): Promise<void> {
  const safeText = escapeHtml(input.itemText);
  const safeProject = escapeHtml(input.projectName);
  const safeUrl = escapeHtml(input.itemUrl);
  const truncated = input.itemText.length > 60 ? input.itemText.slice(0, 57) + '…' : input.itemText;
  const subject = `Reminder: ${truncated}`;
  const text = `Reminder for "${input.itemText}" in ${input.projectName}.\n\nOpen: ${input.itemUrl}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Reminder</h2>
      <p>${safeText}</p>
      <p style="color: #666; font-size: 14px;">in <strong>${safeProject}</strong></p>
      <a href="${safeUrl}" style="display: inline-block; background: #6c63ff; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">Open task</a>
    </div>
  `;

  if (isDev) {
    console.log(`\n[REMINDER] To: ${input.toEmail}`);
    console.log(`[REMINDER] Subject: ${subject}`);
    console.log(`[REMINDER] Link: ${input.itemUrl}\n`);
    return;
  }

  await transporter!.sendMail({ from: FROM_EMAIL, to: input.toEmail, subject, text, html });
}

const CONTACT_SUBJECTS: Record<string, string> = {
  general: 'Contact: General',
  bug: 'Contact: Bug report',
  privacy: 'Contact: Privacy / DSAR',
  legal: 'Contact: Legal notice',
  'dsa-notice': 'Contact: DSA notice',
};

export async function sendContactMessage(input: {
  name?: string;
  email: string;
  category?: string;
  message: string;
}): Promise<void> {
  const safeName = escapeHtml(input.name?.trim() || 'Anonymous');
  const safeEmail = escapeHtml(input.email);
  const safeMessage = escapeHtml(input.message);
  const subject = CONTACT_SUBJECTS[input.category ?? 'general'] ?? CONTACT_SUBJECTS.general;
  const text = `From: ${input.name?.trim() || 'Anonymous'} <${input.email}>\n\n${input.message}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Plainspace contact form message</h2>
      <p><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
      <pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4f5; border-radius: 8px; padding: 16px;">${safeMessage}</pre>
    </div>
  `;

  if (isDev) {
    console.log(`\n[CONTACT] From: ${input.name?.trim() || 'Anonymous'} <${input.email}>`);
    console.log(`[CONTACT] To: ${CONTACT_EMAIL}`);
    console.log(`[CONTACT] Message:\n${input.message}\n`);
    return;
  }

  await transporter!.sendMail({
    from: FROM_EMAIL,
    to: CONTACT_EMAIL,
    replyTo: input.email,
    subject,
    text,
    html,
  });
}

// DSA Art. 16(4): acknowledgement of receipt to the notice submitter
// "without undue delay". Skipped when the CSAM path was used without an
// email (anonymous report under Art. 16(2)(c)).
export async function sendDsaNoticeAck(input: {
  submitterEmail: string;
  noticeId: string;
}): Promise<void> {
  const subject = 'Plainspace: we received your DSA Art. 16 notice';
  const text =
    `Thank you for your notice. We have received it and will assess it ` +
    `in a timely and non-arbitrary manner under Article 16 of the EU ` +
    `Digital Services Act.\n\n` +
    `Reference: ${input.noticeId}\n\n` +
    `If we need more information, we will reply to this email address. ` +
    `If our decision affects content you reported, we will inform you of ` +
    `the outcome and the redress options available to you.\n\n` +
    `— Plainspace`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">We received your notice</h2>
      <p>Thank you for your notice. We have received it and will assess it
      in a timely and non-arbitrary manner under Article 16 of the EU
      Digital Services Act.</p>
      <p><strong>Reference:</strong> ${escapeHtml(input.noticeId)}</p>
      <p>If we need more information, we will reply to this email address.
      If our decision affects content you reported, we will inform you of
      the outcome and the redress options available to you.</p>
      <p>— Plainspace</p>
    </div>
  `;

  if (isDev) {
    console.log(`\n[DSA-ACK] To: ${input.submitterEmail}`);
    console.log(`[DSA-ACK] Notice: ${input.noticeId}\n`);
    return;
  }

  await transporter!.sendMail({
    from: FROM_EMAIL,
    to: input.submitterEmail,
    subject,
    text,
    html,
  });
}

// Forwards the structured notice to the operator inbox. Plaintext mirror of
// what landed in `dsa_notices`; the row is the durable record, the email is
// the inbox-level alert.
export async function sendDsaNoticeToOperator(input: {
  noticeId: string;
  category: string;
  contentLocation: string;
  projectSlug?: string | null;
  itemId?: string | null;
  attachmentId?: string | null;
  submitterName?: string | null;
  submitterEmail?: string | null;
  reason: string;
}): Promise<void> {
  const subject = `[DSA notice] ${input.category}: ${input.contentLocation.slice(0, 60)}`;
  const refLines = [
    `Notice ID: ${input.noticeId}`,
    `Category: ${input.category}`,
    `Content location: ${input.contentLocation}`,
    input.projectSlug ? `Project slug: ${input.projectSlug}` : null,
    input.itemId ? `Item ID: ${input.itemId}` : null,
    input.attachmentId ? `Attachment ID: ${input.attachmentId}` : null,
    input.submitterName ? `Submitter: ${input.submitterName}` : null,
    input.submitterEmail
      ? `Submitter email: ${input.submitterEmail}`
      : 'Submitter: anonymous (CSAM path)',
  ]
    .filter(Boolean)
    .join('\n');
  const text = `${refLines}\n\n--- Reason ---\n${input.reason}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 720px; margin: 0 auto;">
      <h2 style="color: #b91c1c;">DSA Art. 16 notice received</h2>
      <pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4f5; border-radius: 8px; padding: 16px;">${escapeHtml(refLines)}</pre>
      <h3>Reason</h3>
      <pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #fef2f2; border-radius: 8px; padding: 16px;">${escapeHtml(input.reason)}</pre>
    </div>
  `;

  if (isDev) {
    console.log(`\n[DSA-OPERATOR] ${subject}`);
    console.log(text);
    return;
  }

  await transporter!.sendMail({
    from: FROM_EMAIL,
    to: CONTACT_EMAIL,
    replyTo: input.submitterEmail ?? undefined,
    subject,
    text,
    html,
  });
}

// DSA Art. 17 Statement of Reasons. Sent to the affected user on any
// moderation action (content removal, member suspension, membership termination).
// Templates DE+EN are mirrored from docs/dsa-sor-templates.md.
export async function sendStatementOfReasons(input: {
  toEmail: string;
  language: 'en' | 'de';
  action: string; // e.g. "removed your task from project ABC"
  factsAndCircumstances: string;
  groundReference: string; // e.g. "Plainspace Terms of Service § 7"
}): Promise<void> {
  const subject =
    input.language === 'de'
      ? 'Mitteilung zu einer Moderationsentscheidung in Ihrem Plainspace-Space'
      : 'Notice of a moderation decision in your Plainspace Space';

  const text =
    input.language === 'de'
      ? [
          'Hallo,',
          '',
          `wir teilen Ihnen eine Moderationsentscheidung gemäß Art. 17 der EU-Verordnung über digitale Dienste (DSA) mit:`,
          '',
          `Maßnahme: ${input.action}`,
          `Sachverhalt: ${input.factsAndCircumstances}`,
          `Rechtsgrundlage: ${input.groundReference}`,
          'Automatisierte Entscheidungsfindung: nein',
          '',
          'Wenn Sie die Entscheidung für unzutreffend halten, können Sie binnen',
          '30 Tagen per Antwort auf diese E-Mail Widerspruch einlegen. Es steht',
          'Ihnen ferner frei, den Rechtsweg vor einem deutschen Gericht zu',
          'beschreiten.',
          '',
          '— Plainspace',
        ].join('\n')
      : [
          'Hello,',
          '',
          `We are notifying you of a moderation decision under Article 17 of the EU Digital Services Act:`,
          '',
          `Action: ${input.action}`,
          `Facts and circumstances: ${input.factsAndCircumstances}`,
          `Legal / contractual ground: ${input.groundReference}`,
          'Automated decision-making: no',
          '',
          'If you believe the decision is incorrect, you may object by replying',
          'to this email within 30 days. You also have the right to bring this',
          'matter before a German court.',
          '',
          '— Plainspace',
        ].join('\n');

  const safeAction = escapeHtml(input.action);
  const safeFacts = escapeHtml(input.factsAndCircumstances);
  const safeGround = escapeHtml(input.groundReference);
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">${input.language === 'de' ? 'Moderationsentscheidung' : 'Moderation decision'}</h2>
      <dl>
        <dt><strong>${input.language === 'de' ? 'Maßnahme' : 'Action'}</strong></dt>
        <dd>${safeAction}</dd>
        <dt><strong>${input.language === 'de' ? 'Sachverhalt' : 'Facts and circumstances'}</strong></dt>
        <dd>${safeFacts}</dd>
        <dt><strong>${input.language === 'de' ? 'Rechtsgrundlage' : 'Legal / contractual ground'}</strong></dt>
        <dd>${safeGround}</dd>
        <dt><strong>${input.language === 'de' ? 'Automatisierte Entscheidung' : 'Automated decision-making'}</strong></dt>
        <dd>${input.language === 'de' ? 'nein' : 'no'}</dd>
      </dl>
      <p>${
        input.language === 'de'
          ? 'Bei abweichender Auffassung können Sie binnen 30 Tagen per Antwort auf diese E-Mail Widerspruch einlegen. Es steht Ihnen ferner frei, den Rechtsweg vor einem deutschen Gericht zu beschreiten.'
          : 'If you believe the decision is incorrect, you may object by replying to this email within 30 days. You also have the right to bring this matter before a German court.'
      }</p>
      <p>— Plainspace</p>
    </div>
  `;

  if (isDev) {
    console.log(`\n[SOR ${input.language}] To: ${input.toEmail}`);
    console.log(text);
    return;
  }

  await transporter!.sendMail({
    from: FROM_EMAIL,
    to: input.toEmail,
    subject,
    text,
    html,
  });
}
