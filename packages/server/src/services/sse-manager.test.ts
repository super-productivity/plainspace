import type { SSEStreamingApi } from 'hono/streaming';
import { describe, expect, it, vi } from 'vitest';
import { SSEManager } from './sse-manager.js';

function createStream(): SSEStreamingApi {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    writeSSE: vi.fn().mockResolvedValue(undefined),
  } as unknown as SSEStreamingApi;
}

describe('SSEManager cleanup', () => {
  it('runs cleanup once for explicit removal', () => {
    const manager = new SSEManager();
    const stream = createStream();
    const cleanup = vi.fn();
    const client = manager.addClient('project', 'member', stream, cleanup);

    manager.removeClient('project', client.id);
    manager.removeClient('project', client.id);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(stream.close).not.toHaveBeenCalled();
    expect(manager.getClientCount('project')).toBe(0);
  });

  it('runs cleanup once when clients are force-closed', () => {
    const manager = new SSEManager();
    const streams = [createStream(), createStream(), createStream(), createStream()];
    const cleanups = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];

    for (let i = 0; i < streams.length; i += 1) {
      manager.addClient('project', 'member', streams[i], cleanups[i]);
    }

    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(streams[0].close).toHaveBeenCalledTimes(1);
    expect(manager.getClientCount('project')).toBe(3);

    manager.disconnectMember('project', 'member');
    manager.disconnectMember('project', 'member');

    for (const cleanup of cleanups) {
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
    for (const stream of streams) {
      expect(stream.close).toHaveBeenCalledTimes(1);
    }
    expect(manager.getClientCount('project')).toBe(0);
  });

  it('disconnects only streams authenticated by the revoked session', () => {
    const manager = new SSEManager();
    const revokedStream = createStream();
    const otherStream = createStream();
    const future = new Date(Date.now() + 60_000);
    manager.addClient('project', 'member', revokedStream, vi.fn(), {
      sessionHash: 'session-a',
      expiresAt: future,
    });
    manager.addClient('project', 'member', otherStream, vi.fn(), {
      sessionHash: 'session-b',
      expiresAt: future,
    });

    manager.disconnectSession('project', 'session-a');

    expect(revokedStream.close).toHaveBeenCalledTimes(1);
    expect(otherStream.close).not.toHaveBeenCalled();
    expect(manager.getClientCount('project')).toBe(1);
  });

  it('closes an authenticated stream at the session expiry boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
    const manager = new SSEManager();
    const stream = createStream();
    manager.addClient('project', 'member', stream, vi.fn(), {
      sessionHash: 'session',
      expiresAt: new Date(Date.now() + 1_000),
    });

    vi.advanceTimersByTime(1_000);

    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(manager.getClientCount('project')).toBe(0);
    vi.useRealTimers();
  });
});
