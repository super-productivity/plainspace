import { Hono } from 'hono';
import { ContactMessageSchema } from '@plainspace/shared';
import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';
import { sendContactMessage } from '../services/email.js';

const PER_IP_WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 3;

export const contactRoutes = new Hono();

contactRoutes.post('/', async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(`contact:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW_MS)) {
    return c.json({ error: 'Too many messages, please try again later' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ContactMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 422);
  }

  try {
    await sendContactMessage(parsed.data);
  } catch (err) {
    // The submitter address is already delivered to the configured contact
    // mailbox; keep that PII out of long-lived logs. A raw SMTP error can carry
    // the message envelope (including the reply-to address), so log only its
    // shape, never the whole error object.
    console.error('Contact form delivery failed', {
      name: err instanceof Error ? err.name : 'unknown',
      code: err instanceof Error ? (err as { code?: string }).code : undefined,
    });
    return c.json({ error: 'Could not deliver your message, please try again later' }, 502);
  }
  return c.json({ message: 'Message sent' });
});
