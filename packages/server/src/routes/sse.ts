import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ProjectContext } from '../middleware/project.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { sseManager } from '../services/sse-manager.js';
import { isSessionLive } from '../lib/member-tokens.js';
import { SSE_KEEPALIVE_MS } from '@plainspace/shared';

export const sseRoutes = new Hono<{ Variables: ProjectContext & AuthContext }>();

// GET /api/projects/:slug/events - SSE stream
sseRoutes.get('/', authMiddleware, async (c) => {
  const project = c.get('project');
  const member = c.get('member');
  const tokenHash = c.get('memberTokenHash');
  const tokenExpiresAt = c.get('memberTokenExpiresAt');

  // Defeat proxy buffering (nginx, Plesk, Cloudflare) even if upstream config drifts.
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache, no-transform');

  return streamSSE(c, async (stream) => {
    const keepAlive = { current: undefined as ReturnType<typeof setInterval> | undefined };
    let resolveClosed: () => void = () => {};
    let cleanedUp = false;

    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (keepAlive.current) {
        clearInterval(keepAlive.current);
      }
      // Broadcast updated presence after disconnect
      void sseManager.broadcast(project.id, 'presence', {
        online: sseManager.getOnlineMemberIds(project.id),
      });
      resolveClosed();
    };

    const client = sseManager.addClient(project.id, member.id, stream, cleanup, {
      sessionHash: tokenHash,
      expiresAt: tokenExpiresAt,
    });

    // Keep stream cleanup on the manager path so normal aborts and forced
    // disconnects clear the same timer/promise exactly once.
    stream.onAbort(() => {
      sseManager.removeClient(project.id, client.id);
    });

    // A logout (DELETE /session) landing between authMiddleware and the
    // addClient above runs disconnectSession before this client is registered,
    // missing it — leaving a stream live under a revoked token. Re-check the
    // session now: this closes that window from one side; disconnectSession
    // closes it from the other (a revoke after registration finds the client).
    if (!(await isSessionLive(tokenHash))) {
      sseManager.removeClient(project.id, client.id);
      return;
    }

    // Broadcast updated presence to all clients
    void sseManager.broadcast(project.id, 'presence', {
      online: sseManager.getOnlineMemberIds(project.id),
    });
    if (cleanedUp) return;

    // Send initial presence state to this client
    await stream.writeSSE({
      event: 'presence',
      data: JSON.stringify({ online: sseManager.getOnlineMemberIds(project.id) }),
    });
    if (cleanedUp) return;

    // Keep-alive ping
    keepAlive.current = setInterval(async () => {
      try {
        await stream.writeSSE({ event: 'ping', data: '' });
      } catch {
        sseManager.removeClient(project.id, client.id);
      }
    }, SSE_KEEPALIVE_MS);
    if (cleanedUp) {
      clearInterval(keepAlive.current);
      return;
    }

    // Keep stream open until client disconnects
    await closed;
  });
});
