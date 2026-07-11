# MVP Readiness Plan

**Date:** 2026-05-18  
**Status:** Draft  
**Goal:** Close the product and operational gaps that would make the Plainspace
MVP fragile or misleading at launch.

## Scope

This plan is deliberately limited to launch-critical work:

- A returning user can regain access to their existing membership.
- Email verification has a complete user path and supports private Spaces/API
  tokens.
- The public product promise matches the shipped UI, especially attachments.
- Production setup is verified: mail, migrations, storage, backups, observability,
  legal/abuse contact paths, and release smoke tests.

Not included: billing, analytics, invite emails, full kanban board mode, custom
columns UI, mobile app, advanced admin analytics, or horizontal scaling.

## Phase 1 - Fix Product-Blocking Gaps

### 1. Account recovery / returning-user login

**Problem:** The per-Space member token only lives in browser `localStorage`.
If a user clears storage or switches devices, they cannot recover the same
membership. Open Spaces allow duplicate rejoin; private Spaces can lock the user
out.

**Approach:**

- Add a passwordless recovery flow scoped to one Space:
  1. User opens `/:slug/join`.
  2. User chooses "Already joined? Email me a sign-in code."
  3. User enters their email.
  4. Server sends a 6-digit code if a verified member with that email exists in
     the Space.
  5. Code exchange returns a fresh per-Space member token and member id.
- Use the same generic success message whether an email exists or not to avoid
  membership enumeration.
- Rate-limit per IP, per email, and per member where applicable.
- Mark old recovery codes as used and expire them after 10 minutes.
- **Token rotation decision:** on successful recovery, overwrite the member's
  existing `tokenHash` (rotate-on-recover). This kicks any prior browser the
  user still had open, which is the correct default for a "recover access"
  flow. The schema today stores a single `tokenHash` per member
  (`drizzle/0009_hash_member_tokens.sql`); allowing multiple concurrent tokens
  would need a separate session table and is out of MVP scope.

**Backend tasks:**

- Add a recovery-code table (or extend an existing verifications table with a
  purpose column) — the per-project `email_verifications` flow is the closest
  pattern to follow.
- Add endpoints under `POST /api/projects/:slug/auth/request-login-code` and
  `POST /api/projects/:slug/auth/verify-login-code`, mirroring the existing
  `request-verification` / `verify` pair in `server/src/routes/auth.ts`.
- Issue a new member token on successful login and overwrite the stored hash
  (token hashing itself is already in place — see migration 0009).
- Add tests for success, unknown email, invalid/expired/reused code, private
  Space recovery, and rate limits.

**Frontend tasks:**

- Add a returning-user path to `Join.tsx`.
- Save the returned identity with the existing `saveIdentity`.
- Keep normal open-Space join simple for first-time users.

**Acceptance criteria:**

- A verified member can recover access on a clean browser.
- A private Space member can recover access without asking an admin.
- Unknown emails do not reveal whether the address is a member.
- Reused/expired/invalid codes fail.

### 2. Complete email verification for private features

**Problem:** Creating a Space proves the creator controls an email address, but
the resulting member is not marked `emailVerified` (see
`server/src/routes/projects.ts` — the creator insert omits the field, so it
defaults to `false`). There is no `EmailVerify` component in the web app yet;
`components/members/ApiTokens.tsx` shows a static "Verify your email to
generate API tokens" hint with no action wired to it, and there is no UI
anywhere to change `sharingMode`, even though `api.updateSettings` already
wraps the server endpoint.

**Approach:**

- Mark the creator as `emailVerified: true` when project creation uses a valid
  creation verification code (one-line change in the creator-insert).
- Build an `EmailVerify` component and mount it in the members panel when the
  current member is not verified and tries to use private mode or API tokens.
- Add a visible admin control for `sharingMode` (the API wrapper already
  exists; it just has no caller) so private mode is actually reachable from
  the UI.
- When verification succeeds, refresh or update the member in store so the
  private/API-token UI unlocks without a full reload.

**Backend tasks:**

- Set `emailVerified: true` for production project creators after verified
  creation.
- Ensure development behavior remains convenient but does not leak `devCode` in
  production.
- Add focused API tests for creator verification state.

**Frontend tasks:**

- Build an `EmailVerify` component (does not exist yet) and mount it in the
  member panel, replacing the dead-end hint in `ApiTokens.tsx`.
- Add sharing-mode controls for admins that call the existing
  `api.updateSettings` wrapper.
- Surface backend errors for private-mode activation instead of silently failing.

**Acceptance criteria:**

- A newly created production Space can be made private immediately by its
  creator.
- An unverified joined member can verify email from the UI and then create API
  tokens.
- E2E covers private-mode activation and API-token unlock.

### 3. Resolve attachment promise mismatch

**Problem:** Terms and Privacy promise attachments up to 10 MB and the backend
supports them, but the task UI never mounts `AttachmentUpload` or
`AttachmentList`. `ListItem.tsx` accepts an `attachments` prop and discards it
— the components exist under `components/attachments/` but are not imported
anywhere in the lists UI.

**Decision needed:** Ship attachments in MVP, or remove the public attachment
promise until after MVP.

**Preferred MVP path:** Ship existing attachment UI.

**Tasks if shipping attachments:**

- Import `AttachmentUpload` and `AttachmentList` in `ListItem.tsx` and render
  them against the `attachments` prop that is already passed in.
- Add delete controls or explicitly defer deletion UI if API-only deletion is
  acceptable for beta.
- Show upload errors in the task row or toast area.
- Verify signed URLs, preview thumbnails, text/PDF downloads, size/type limits,
  and attachment persistence after restart.
- Confirm `UPLOAD_DIR` is persistent in production.

**Fallback path if deferring attachments:**

- Remove attachment references from `Terms.tsx` and `Privacy.tsx` (the
  homepage does not mention attachments today, so no change there) and from
  the smoke test list.
- Hide API-token integration assumptions that mention attachments, if any.
- Keep backend routes but treat them as unreleased.

**Acceptance criteria:**

- Public copy matches actual UI behavior.
- If shipped, users can upload, view/download, and delete or otherwise manage
  attachments without hidden test-only controls.
- Files survive deploy/restart.

## Phase 2 - Production Readiness

### 4. Verify project-creation email gate

Depends on §6 (production SMTP) being configured first.

**Tasks:**

- Test `POST /api/auth/request-creation-code` in production mode.
- Test happy path through the home page.
- Test invalid, expired, reused, and missing codes.
- Test per-email and per-IP rate limits.
- Confirm `devCode` is never returned unless `NODE_ENV=development`.

**Acceptance criteria:**

- Production mode cannot create a Space without a valid emailed code.
- Failed code attempts are rate-limited enough to protect the 6-digit code.

### 5. Apply migrations and deploy order

**Tasks:**

- Apply `packages/server/drizzle/0010_new_penance.sql` locally against a fresh DB.
- Confirm it creates the schema needed by creation verification.
- Document deploy order: migrate first, then deploy app code.
- Run migration against production before first public traffic.

**Acceptance criteria:**

- Fresh setup and migrated setup both pass build/e2e.
- Production has the migration before code uses `creation_verifications`.

### 6. Configure production email

**Tasks:**

- Configure SMTP env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL`.
- Configure SPF, DKIM, and DMARC for `plainspace.org`.
- Send real creation, in-Space verification, recovery, and contact-form emails.
- Confirm delivery to Gmail and one non-Gmail inbox.
- Confirm messages do not land in spam.

**Acceptance criteria:**

- Every user-facing email flow works in production.
- Logs do not contain verification codes in production.

### 7. Storage, backups, and signed URLs

**Tasks:**

- Set `UPLOAD_DIR` to persistent storage. _(Obsolete: attachments disabled in
  code per `CLAUDE.md`; restore from commit `c4e44d4` if re-enabling.)_
- ~~Set `URL_SIGNING_SECRET` to a stable random value with at least 32 chars.~~
  _(Obsolete: the code that consumed this secret was removed; dropped from
  compose + env templates on 2026-05-21.)_
- Upload/download/restart/download again. _(N/A while attachments disabled.)_
- Confirm Postgres backups exist.
- Confirm uploaded-file backups exist or consciously accept no backup for beta
  and remove "backup" claims that would be false. _(N/A while attachments
  disabled; backup scope is Postgres-only per `docs/deployment.md` §7.)_

**Acceptance criteria:**

- Files and signed links behave predictably across restarts.
- Backup posture matches Privacy/Terms wording.

### 8. Minimal observability

**Tasks:**

- Add uptime monitoring for `/health`.
- Add an error sink or explicitly document "shipping blind" for private beta.
- Ensure production logs omit secrets, tokens, and verification codes.

**Acceptance criteria:**

- An outage or server-side exception becomes visible without waiting for a user
  report.

## Phase 3 - Legal And Operations

### 9. Mailboxes and abuse process

**Tasks:**

- Set up `hello@plainspace.org` as the monitored legal mailbox, with labels/rules
  for privacy requests and DSA notices.
- Verify inbound mail reaches a monitored inbox.
- Write a short abuse runbook: who reads reports, how a Space is reviewed,
  how content/member/Space removal works, and response SLA.

**Acceptance criteria:**

- Every public legal/contact address is real and monitored.
- Abuse reports have a concrete handling path.

### 10. DPA, legal review, and records

**Tasks:**

- Complete the Hetzner DPA before storing real user data there.
- Review Terms, Privacy, Impressum, Subprocessors, ROPA, and legal notes with a
  German IT lawyer before public launch.
- Update ROPA with signed DPA status and any processor changes.

**Acceptance criteria:**

- Legal pages match actual product behavior and infrastructure.
- Processor records are current before real user data is processed.

## Phase 4 - Release Verification

### 11. Full local/release test pass

**Tasks:**

- `npm run check`
- `npm run build`
- `npm run test:e2e`
- Manual smoke test (recovery and attachment items are conditional on the
  Phase 1 decisions shipping):
  - Create Space
  - Recover login on a clean browser _(requires §1)_
  - Join open Space
  - Make Space private _(requires §2)_
  - Recover/login to private Space _(requires §1 + §2)_
  - Add, edit, delete, restore task
  - Assign task
  - Scratchpad edit/save
  - Invite link
  - Presence/reconnect banner
  - Attachment upload/download/delete _(requires §3 shipped, not deferred)_
  - API token creation/revoke after email verification
  - Contact form

**Acceptance criteria:**

- Automated checks pass.
- Manual smoke test passes in production-like mode.

### 12. Cut release

**Tasks:**

- Push local commits.
- Deploy migrations.
- Deploy app.
- Confirm `/health`.
- Run production smoke test.
- Create a short launch note with known beta limitations.

**Acceptance criteria:**

- The MVP is usable by a small external beta group without relying on local
  dev-only behavior or undocumented operator intervention for normal flows.

## Recommended Order

1. Account recovery.
2. Creator/member email verification and private-mode UI.
3. Attachment decision and implementation/copy alignment.
4. Production email and migrations.
5. Storage/backups/signed URL secret.
6. Observability.
7. Mailboxes, abuse runbook, DPA/legal review.
8. Full release verification.

This order keeps user-access risks first, then product-promise consistency, then
the operational work that must be proven in the real environment.
