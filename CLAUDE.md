# Project Notes

## Guiding Principle: KISS

- Simplicity and low LOC are explicit goals. Prefer the shortest correct solution.
- Don't introduce abstractions, options, or layers until concrete duplication or a real second caller justifies them.
- Avoid speculative flexibility, defensive checks for impossible cases, and feature flags for hypothetical needs.
- When two implementations are equally correct, pick the one with fewer lines.

## Single-node by design (don't "fix" this)

- Plainspace runs as one app instance and scales vertically. The in-memory
  rate limiter (`lib/rate-limit.ts`) and the in-process SSE manager
  (`services/sse-manager.ts`) intentionally assume a single process — do NOT
  swap them for Redis / a distributed store as a "scalability improvement"
  without an actual multi-node requirement. The sweepers are advisory-locked
  (`lib/advisory-lock.ts`) so a deploy overlap is safe; a replica can set
  `RUN_SWEEPERS=0`. Full reasoning and the revisit triggers live in
  `docs/scaling-decision.md`.

## Attachments (disabled)

- Attachment uploads/downloads are intentionally disabled. The DB schema
  (`attachments` table), shared `Attachment` type, SSE events, and the
  `AttachmentList` / `AttachmentUpload` web components are kept, but the
  server no longer mounts upload/delete routes, no longer serializes
  attachments on `GET /api/projects/:slug` (returns `attachments: []`),
  no longer touches S3 in the retention sweep, and no longer needs any
  `S3_*` env vars to boot.
- To re-enable: restore `packages/server/src/routes/attachments.ts` and
  `packages/server/src/lib/uploads.ts` from commit `c4e44d4` of the
  pre-open-source private repo (`johannesjo/spaces`), restore
  `serializeAttachment` in `packages/server/src/lib/serialize.ts`, re-mount
  `attachmentRoutes` and the `serializeAttachment` call in
  `packages/server/src/routes/projects.ts`, restore the S3 delete block in
  `packages/server/src/services/retention.ts`, and set
  `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
  (see `docker-compose.e2e.yml` for a MinIO sidecar).
- Don't add new code that depends on attachment storage while this is off.

## DSA Art. 17 Statement-of-Reasons scope (revisit after launch)

- Today `sendStatementOfReasons` only fires programmatically on
  admin-initiated **member removal** (`packages/server/src/routes/admin.ts`).
  Content removal as an enforcement action (e.g. response to a DSA Art. 16
  notice) is operator-manual: compose from `docs/dsa-sor-templates.md` and
  send by hand.
- Terms `§8` (`packages/web/src/routes/Terms.tsx`) is currently scoped to
  match: SoR is promised for membership removal and "content removal as an
  enforcement action", not for routine self-deletions. This is defensible
  for pre-launch / micro-scale operation but is operationally fragile at
  any DSA-notice volume.
- **After launch**, build the content-removal SoR flow in code: add an
  optional "enforcement reason" input on admin/operator item-delete paths,
  call `sendStatementOfReasons` with the affected member's email, persist
  the reason + SoR-sent flag on the activity-log entry. Then the broader
  Terms wording (the previous version) can return without overclaiming.
- Known gap: `member.removed` activity rows (the Art. 17 decision record)
  are kept 3 years by the retention sweeper, but `activity` cascades on
  project delete — deleting a Space erases its enforcement records early.
  Tolerated at micro-scale; move enforcement records out of `activity`
  (no cascade) when building the content-removal SoR flow above.
- Priority hint: revisit when DSA-notice volume exceeds ~1/quarter or when
  any beta tester reports a real Art. 16 notice that required content
  takedown.

## UI Components And Styleguide

- Prefer extracting reusable UI primitives early instead of duplicating one-off form controls, buttons, badges, and toggles.
- Shared web UI primitives live in `packages/web/src/components/ui`.
- Keep the styleguide route at `/_styleguide` updated when adding or changing shared UI components, tokens, or interaction patterns.
- Use existing CSS design tokens from `packages/web/src/styles/global.css` before introducing new colors, spacing, radii, or shadows.
