import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectSSE, disconnectSSE } from './sse';
import { resetState, state } from './store';

const SLUG = 'demo';
const IDENTITY_KEY = `spaces:projects:${SLUG}`;

function seedIdentity(token = 'tok-1') {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ token, memberId: 'm-self' }));
}

type ReadResult = { value?: Uint8Array; done: boolean };
type FakeStream = ReturnType<typeof createFakeStream>;

// Hand-rolled reader instead of a real ReadableStream so a test can push
// chunks or inject a failure at an exact point in the reconnect dance.
function createFakeStream() {
  let pendingResolve: ((r: ReadResult) => void) | null = null;
  let pendingReject: ((e: unknown) => void) | null = null;
  const backlog: Array<{ chunk: ReadResult } | { error: unknown }> = [];

  function deliver(entry: { chunk: ReadResult } | { error: unknown }) {
    if (!pendingResolve || !pendingReject) {
      backlog.push(entry);
      return;
    }
    const resolve = pendingResolve;
    const reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    if ('chunk' in entry) resolve(entry.chunk);
    else reject(entry.error);
  }

  const reader = {
    read(): Promise<ReadResult> {
      const next = backlog.shift();
      if (next) {
        return 'chunk' in next ? Promise.resolve(next.chunk) : Promise.reject(next.error);
      }
      return new Promise<ReadResult>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    },
    releaseLock() {},
  };

  return {
    body: { getReader: () => reader },
    emit(text: string) {
      deliver({ chunk: { value: new TextEncoder().encode(text), done: false } });
    },
    fail(error: unknown = new Error('stream dropped')) {
      deliver({ error });
    },
  };
}

// Fake timers don't fake microtasks; a handful of awaits drains the promise
// chain between a fetch settling and the read loop reaching reader.read().
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// jsdom's Location is unforgeable (spyOn(location, 'assign') throws), but the
// vitest global exposes window.location as a configurable property, so the
// whole object can be swapped for a stub.
const locationReplace = vi.fn();
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: {
      origin: 'http://localhost:3000',
      href: 'http://localhost:3000/',
      replace: locationReplace,
    },
    configurable: true,
  });
});

let streams: FakeStream[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  streams = [];
  fetchMock = vi.fn(async () => {
    const stream = createFakeStream();
    streams.push(stream);
    return { status: 200, ok: true, body: stream.body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  // Pin the backoff jitter to its upper bound: delay === base === 1000 * 2^attempts.
  vi.spyOn(Math, 'random').mockReturnValue(1);
  locationReplace.mockClear();
  resetState();
});

afterEach(() => {
  disconnectSSE(); // clears module-level timers/abort state that persists between tests
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetState();
});

describe('first connect', () => {
  it('fetches the event stream with the stored bearer token and dispatches events to the store', async () => {
    seedIdentity('tok-1');
    const onReconnect = vi.fn();
    connectSSE(SLUG, onReconnect);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/projects/${SLUG}/events`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(state.connected).toBe(true);

    streams[0].emit('event: presence\ndata: {"online":["m-self","m2"]}\n\n');
    await flush();
    expect(state.presence).toEqual(['m-self', 'm2']);

    // The first connect is paired with the initial project load — no resync.
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe('reconnect with backoff and resync', () => {
  it('backs off exponentially, fires onReconnect exactly once per recovery, and resets the backoff', async () => {
    seedIdentity();
    const onReconnect = vi.fn();
    connectSSE(SLUG, onReconnect);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Drop the stream → first retry scheduled at the initial 1000ms delay.
    streams[0].fail();
    await flush();
    expect(state.connected).toBe(false);

    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush();
    // The retry itself failed — no resync yet, and the next delay doubles.
    expect(onReconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await flush();

    // Stream re-established → exactly one resync, connection restored.
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(state.connected).toBe(true);

    // Attempts reset on the successful read: the next drop starts the
    // backoff ladder over at 1000ms instead of continuing at 4000ms.
    streams[1].fail();
    await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await flush();
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });
});

describe('unauthorized recovery', () => {
  it('clears the stored identity and redirects to /join on a 401', async () => {
    seedIdentity();
    fetchMock.mockResolvedValueOnce({ status: 401, ok: false, body: null } as unknown as Response);
    connectSSE(SLUG);
    await flush();

    expect(localStorage.getItem(IDENTITY_KEY)).toBeNull();
    expect(locationReplace).toHaveBeenCalledWith(`/${SLUG}/join`);
    expect(state.connected).toBe(false);
  });

  it('lands in recover mode when a plainspace email is saved', async () => {
    seedIdentity();
    localStorage.setItem('spaces:plainspaceEmail', 'jo@example.com');
    fetchMock.mockResolvedValueOnce({ status: 401, ok: false, body: null } as unknown as Response);
    connectSSE(SLUG);
    await flush();

    expect(locationReplace).toHaveBeenCalledWith(`/${SLUG}/join?recover=1`);
  });

  it('recovers instead of dead-ending when the token vanishes before a reconnect fires', async () => {
    seedIdentity();
    connectSSE(SLUG);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    streams[0].fail();
    await flush();
    // Another tab left the Space while we were waiting to reconnect.
    localStorage.removeItem(IDENTITY_KEY);

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no tokenless retry loop
    expect(locationReplace).toHaveBeenCalledWith(`/${SLUG}/join`);
  });
});

describe('event dispatch resilience', () => {
  it('skips malformed JSON and survives a throwing handler without killing the read loop', async () => {
    seedIdentity();
    connectSSE(SLUG);
    await flush();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Malformed wire data: silently skipped.
    streams[0].emit('event: presence\ndata: {not-json\n\n');
    await flush();
    expect(state.presence).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();

    // Valid JSON that makes the store handler throw (`null.itemId`): logged, not fatal.
    streams[0].emit('event: item.deleted\ndata: null\n\n');
    await flush();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('item.deleted'),
      expect.any(TypeError),
    );

    // The loop is still alive: a later valid event dispatches normally.
    streams[0].emit('event: presence\ndata: {"online":["m2"]}\n\n');
    await flush();
    expect(state.presence).toEqual(['m2']);
    expect(state.connected).toBe(true);
  });
});
