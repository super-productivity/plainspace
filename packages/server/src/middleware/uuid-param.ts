import type { MiddlewareHandler } from 'hono';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Single accepted-UUID-format definition for the server; the integration
// routes use it inline where they need their own 404 body shape.
export const isUuid = (value: string): boolean => UUID_RE.test(value);

// Reject a non-UUID path param with a 404 before it is bound into a
// uuid-column eq(), where Postgres would raise 22P02 and the request would
// surface as a 500 (any authenticated member could generate log noise that
// looks like real errors).
export function uuidParam(name: string): MiddlewareHandler {
  return async (c, next) => {
    if (!isUuid(c.req.param(name) ?? '')) {
      return c.json({ error: 'Not found' }, 404);
    }
    return next();
  };
}
