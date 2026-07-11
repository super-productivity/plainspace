# Contributing

Thanks for your interest! Plainspace is young as an open-source project —
issues, bug reports, and small focused PRs are the most helpful
contributions right now. For larger changes, please open an issue first so
we can agree on the approach before you invest time.

## Development setup

1. Install Node.js 22 and Docker.
2. `npm ci`
3. `cp .env.example .env` and adjust the local database settings.
4. `npm run db:up` — starts PostgreSQL and applies migrations.
5. `npm run dev` — starts the API and the web app.

## Before you open a PR

- `npm run check` must pass (typecheck + ESLint + Prettier).
- `npm test` must pass; add or update tests for behavior you change.
  Bug fixes should come with a test that fails without the fix.
- Commit format: `type(scope): description` (feat, fix, docs, style,
  refactor, test, chore), imperative mood, under 72 chars.

## Design philosophy (KISS)

Simplicity and low line count are explicit goals here — see `CLAUDE.md` for
the working rules. In short:

- Prefer the shortest correct solution; no speculative abstractions,
  options, or layers without a concrete second caller.
- The app intentionally runs as **one** process — the in-memory rate
  limiter and SSE manager are not bugs to fix
  (`docs/scaling-decision.md`).
- Match existing patterns; shared UI primitives live in
  `packages/web/src/components/ui` and are showcased at `/_styleguide`.

## Migrations

Do not run `npm run db:generate` for new schema changes yet — Drizzle
snapshots stop at migration 0012; post-0012 migrations are hand-written
SQL plus `_journal.json` (see README).
