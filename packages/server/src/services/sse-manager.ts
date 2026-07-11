import type { SSEStreamingApi } from 'hono/streaming';
import type { SSEEvent } from '@plainspace/shared';

type SSEEventName = SSEEvent['event'];
type SSEEventData<E extends SSEEventName> = Extract<SSEEvent, { event: E }>['data'];

interface SSEClient {
  id: string;
  memberId: string;
  sessionHash?: string;
  stream: SSEStreamingApi;
  cleanup: () => void;
  cleanedUp: boolean;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

const MAX_STREAMS_PER_MEMBER = 3;
// A broadcast write that hasn't resolved within this window means the client
// is backpressured or gone; treat it as dead so one stalled socket can't hold
// up delivery to everyone else in the Space.
const SSE_WRITE_TIMEOUT_MS = 5_000;

function writeWithTimeout(
  client: SSEClient,
  message: { event: string; data: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSE write timeout')), SSE_WRITE_TIMEOUT_MS);
    client.stream.writeSSE(message).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('SSE write failed'));
      },
    );
  });
}

export class SSEManager {
  private connections = new Map<string, Set<SSEClient>>();

  addClient(
    projectId: string,
    memberId: string,
    stream: SSEStreamingApi,
    cleanup: () => void = () => {},
    session?: { sessionHash: string; expiresAt: Date },
  ): SSEClient {
    const client: SSEClient = {
      id: crypto.randomUUID(),
      memberId,
      sessionHash: session?.sessionHash,
      stream,
      cleanup,
      cleanedUp: false,
    };

    if (!this.connections.has(projectId)) {
      this.connections.set(projectId, new Set());
    }
    const clients = this.connections.get(projectId)!;

    // Enforce per-member cap: close the oldest streams above the limit.
    // Set iteration order is insertion order, so the first match is the oldest.
    const memberClients = [...clients].filter((c) => c.memberId === memberId);
    while (memberClients.length >= MAX_STREAMS_PER_MEMBER) {
      const oldest = memberClients.shift()!;
      this.removeClientFromSet(projectId, clients, oldest, { closeStream: true });
    }

    clients.add(client);
    if (session) {
      client.expiryTimer = setTimeout(
        () => this.removeClientFromSet(projectId, clients, client, { closeStream: true }),
        Math.max(0, session.expiresAt.getTime() - Date.now()),
      );
    }
    return client;
  }

  removeClient(projectId: string, clientId: string): void {
    const clients = this.connections.get(projectId);
    if (!clients) return;

    for (const client of clients) {
      if (client.id === clientId) {
        this.removeClientFromSet(projectId, clients, client);
        break;
      }
    }
  }

  disconnectMember(projectId: string, memberId: string): void {
    const clients = this.connections.get(projectId);
    if (!clients) return;

    const toRemove: SSEClient[] = [];
    for (const client of clients) {
      if (client.memberId === memberId) {
        toRemove.push(client);
      }
    }

    for (const client of toRemove) {
      this.removeClientFromSet(projectId, clients, client, { closeStream: true });
    }
  }

  disconnectSession(projectId: string, sessionHash: string): void {
    const clients = this.connections.get(projectId);
    if (!clients) return;

    for (const client of [...clients]) {
      if (client.sessionHash === sessionHash) {
        this.removeClientFromSet(projectId, clients, client, { closeStream: true });
      }
    }
  }

  // Drop every client of a Space at once — used when the Space itself is
  // deleted, after a final `project.deleted` broadcast tells clients to leave.
  disconnectProject(projectId: string): void {
    const clients = this.connections.get(projectId);
    if (!clients) return;

    for (const client of [...clients]) {
      this.removeClientFromSet(projectId, clients, client, { closeStream: true });
    }
  }

  // Callers on the request path deliberately do NOT await this (`void
  // sseManager.broadcast(...)`): the returned promise resolves only after
  // every client write settles (up to SSE_WRITE_TIMEOUT_MS for a stalled
  // socket), and one backpressured client must not add latency to the
  // mutation response. Per-client event ordering is still preserved without
  // awaiting: every writeSSE traverses the identical await structure inside
  // hono's streaming helper before enqueueing to the (order-preserving)
  // stream writer, so same-depth FIFO microtasks keep call order — re-check
  // this on a hono upgrade. Await broadcast only when the streams are closed
  // right afterwards (Space delete).
  async broadcast<E extends SSEEventName>(
    projectId: string,
    event: E,
    data: SSEEventData<E>,
  ): Promise<void> {
    const clients = this.connections.get(projectId);
    if (!clients) return;

    const payload = JSON.stringify(data);
    // Fan out in parallel so a slow/backpressured client doesn't stall delivery
    // to the rest of the Space. Snapshot the client list first since failed
    // writes mutate the set during cleanup.
    const targets = [...clients];
    const results = await Promise.allSettled(
      targets.map((client) => writeWithTimeout(client, { event, data: payload })),
    );

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.removeClientFromSet(projectId, clients, targets[i], { closeStream: true });
      }
    });
  }

  getOnlineMemberIds(projectId: string): string[] {
    const clients = this.connections.get(projectId);
    if (!clients) return [];

    const memberIds = new Set<string>();
    for (const client of clients) {
      memberIds.add(client.memberId);
    }
    return Array.from(memberIds);
  }

  getClientCount(projectId: string): number {
    return this.connections.get(projectId)?.size ?? 0;
  }

  private removeClientFromSet(
    projectId: string,
    clients: Set<SSEClient>,
    client: SSEClient,
    options: { closeStream?: boolean } = {},
  ): void {
    if (!clients.delete(client)) return;

    if (!client.cleanedUp) {
      client.cleanedUp = true;
      try {
        client.cleanup();
      } catch {
        // Cleanup is best-effort; the manager must still drop and close clients.
      }
    }

    if (client.expiryTimer) {
      clearTimeout(client.expiryTimer);
    }

    if (options.closeStream) {
      try {
        void client.stream.close().catch(() => {
          // Stream may already be closed; ignore.
        });
      } catch {
        // Stream may already be closed; ignore.
      }
    }

    if (clients.size === 0) {
      this.connections.delete(projectId);
    }
  }
}

export const sseManager = new SSEManager();
