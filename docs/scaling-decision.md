# Scaling decision: single node, scale vertically

**Status:** active. **Decided:** 2026-06-15.

## Decision

Plainspace runs as a **single application instance** (one container, behind the
Plesk reverse proxy, with the bundled Postgres). We scale **up** (a bigger box)
rather than **out** (more instances). This is a deliberate architectural
commitment, not an accident of the current deployment.

## Why

Three subsystems assume a single process, and the cost of removing each
assumption is wildly different:

| Subsystem                                  | Multi-instance cost                          |
| ------------------------------------------ | -------------------------------------------- |
| Background sweepers (reminders, retention) | trivial — now advisory-locked anyway         |
| Rate limiter (in-memory `Map`)             | moderate — would need Redis / a shared table |
| **SSE realtime fan-out**                   | **large** — needs a Redis pub/sub backbone   |

SSE is the real driver. A client streams from one process, but a mutation
arrives on whichever process served that HTTP request; with more than one
instance a change on instance B never reaches clients on instance A, so
realtime silently half-breaks. Fixing that means a pub/sub layer in front of
`sse-manager` — a genuine new architectural tier that contradicts the project's
KISS principle.

Expected load over the next ~12 months is low thousands of concurrent users,
and there is **no zero-downtime / HA requirement** (brief downtime during a
deploy is acceptable). Both fit comfortably on one well-provisioned VPS for a
workload this light. Going multi-node would be solving a problem we don't have.

## What we did instead (single-node hardening for the thousands-concurrent range)

- **Bounded DB pool + `statement_timeout`** (`db/connection.ts`): an unbounded
  pool would race past Postgres `max_connections` under load; a stuck query now
  fails instead of pinning a connection. Tunable via `DB_POOL_MAX` /
  `DB_STATEMENT_TIMEOUT_MS`.
- **SSE survives at scale**: the route already defeats proxy buffering
  (`X-Accel-Buffering: no`) and the container raises `nofile` to 65535 for the
  long-lived connections. The broadcast loop fans out in parallel with a
  per-write timeout so one stalled client can't block a Space.
- **Advisory-locked sweepers** (`lib/advisory-lock.ts`): correct even if a
  deploy briefly overlaps two app processes. `RUN_SWEEPERS=0` lets a future
  replica skip the redundant attempt.
- **Rate limiter stays in-memory** — correct and sufficient on one node.

## Revisit when

- Sustained concurrency materially exceeds the low thousands, or a single Space
  grows to thousands of simultaneous members, **or**
- Zero-downtime / high availability becomes a hard requirement.

The first multi-node step is a Redis pub/sub fan-out for SSE plus moving the
rate limiter to the same Redis; the sweepers are already safe.
