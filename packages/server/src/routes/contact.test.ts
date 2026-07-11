import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendContactMessage } = vi.hoisted(() => ({
  sendContactMessage: vi.fn(),
}));

vi.mock('../services/email.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/email.js')>()),
  sendContactMessage,
}));

import { createApp } from '../app.js';

const app = createApp();
const connEnv = {
  incoming: { socket: { remoteAddress: '198.51.100.10', remotePort: 1234, remoteFamily: 'IPv4' } },
} as unknown as Parameters<typeof app.request>[2];

beforeEach(() => {
  sendContactMessage.mockReset();
});

describe('POST /api/contact — delivery failures', () => {
  it('does not copy the submitter email into application logs', async () => {
    // A real SMTP rejection can carry the message envelope (including the
    // submitter's reply-to address) in its message/response. Logging the whole
    // error object would leak it; only the scrubbed shape must reach the log.
    const deliveryError = Object.assign(new Error('550 rejected recipient private@example.com'), {
      code: 'EENVELOPE',
    });
    sendContactMessage.mockRejectedValue(deliveryError);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request(
      '/api/contact',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'private@example.com',
          category: 'general',
          message: 'Please help',
        }),
      },
      connEnv,
    );

    expect(res.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith('Contact form delivery failed', {
      name: 'Error',
      code: 'EENVELOPE',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private@example.com');
    errorSpy.mockRestore();
  });
});
