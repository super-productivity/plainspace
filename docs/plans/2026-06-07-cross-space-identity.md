# Cross-Space Identity & Social Login Plan

**Date:** 2026-06-07
**Status:** Phases 1 + 2 implemented (rotation-consistent, option 2a). Phase 3
(Apple/Google social login) tracked as a follow-up issue.
**Goal:** Give people a "one sign-in, my Spaces follow me across devices" experience
without abandoning anonymous join or building a central person→everything identity
record. Lay an honest on-ramp to social login (Apple/Google) for the mobile-heavy
audience.

> **Naming note.** This doc's "Option A / Option B" refers to the **identity data
> model**. It is unrelated to `docs/plans/2026-05-20-option-a-migration.md`, whose
> "Option A" is a hosting/infra decision (Hetzner + R2 + email encryption + DSA).
> Different axis, reused letter.

---

## Verdict

Adopt **Option B — a thin, additive identity layer that preserves per-Space
isolation** — implemented as the industry-standard "Linear hybrid" model
(_authentication is global, authorization stays tenant-scoped_). Do **not** adopt
Option A (a normalized global `users` table that owns memberships) unless/until the
product pivots to identity-centric features (see "When to flip to A").

This was the unanimous conclusion of three independent evaluations:

- **Engineering cost/risk:** Option A ≈ 1,100–1,250 LOC across 15–18 files, ~3–4
  weeks, one-way migration, _very high_ risk (breaks token semantics, breaks the
  web client's localStorage format, risky backfill of every member row). Option B
  ≈ low hundreds of LOC, days, additive and reversible — and is ~70–80% of A's
  foundation if A is ever needed.
- **Product values / privacy:** A contradicts three documented values — KISS
  (`CLAUDE.md`), per-Space isolation, and the deliberate "no central PII map"
  posture (`docs/security-decisions.md` treats email as the GDPR primary
  identifier; A concentrates them into one breach/subpoena/SAR surface).
- **Industry best practice:** B _is_ the recommended default for privacy-first,
  multi-tenant products; A is the "GitHub model," right only when the _person_ is
  the durable high-value object. Here the _Space_ is durable and the person is
  deliberately lightweight.

Crucially, B is **not a compromise toward A** — it is its own correct pattern.
Signal / Standard Notes prove you can have multi-device recovery without a
queryable central identity graph.

---

## Relationship to PR #8 ("Move Spaces overview into the people panel")

PR #8 (`claude/spaces-button-mobile-layout-qFp2q`, open) adds a **"Your Spaces"**
section to `packages/web/src/components/members/MemberList.tsx`, populated by
`otherSpaces()` → `listKnownSpaces()`. That helper reads **localStorage only**
(`packages/web/src/lib/identity.ts:113`), so the list is **device-local**: a fresh
phone shows nothing.

That section is the exact surface this plan upgrades. **All web work here builds
directly on PR #8's `MemberList` changes**, so we should land on top of PR #8's
branch (or after it merges) to avoid conflicts in `MemberList.tsx` /
`MemberList.module.css`. No design conflict — this plan makes PR #8's list work
across devices.

---

## Current state (verified against repo)

- **No global account.** `members` is keyed per Space (`schema.ts:38`); identity is
  a per-Space bearer token (`tokenHash`, unique index `idx_members_token_hash`).
- **One token per member.** Recovery (`verify-login-code`) _rotates_ the token,
  which logs the member out on other devices for that Space. This is existing,
  shipped behavior.
- **Cross-Space discovery already exists but is email-only and write-only:**
  `POST /api/auth/find-spaces` (`public-auth.ts:33`) looks up all Spaces for a
  verified email via the blind index (`idx_members_email_lookup`) and _emails_ the
  list (anti-enumeration). It never returns the list to the client.
- **Web identity is per-slug localStorage** (`identity.ts`): `spaces:projects:{slug}`
  holds `{token, memberId, name}`; `spaces:plainspaceEmail` holds one device-wide
  email for prefill.
- **Merge logic exists:** `mergeMemberInto` (`services/member-merge.ts`) already
  absorbs a duplicate guest member into the canonical verified one and reassigns
  all member-owned rows. The guest-claim path reuses this.

The key insight: **the data to power cross-device "Your Spaces" already lives in
`members` keyed by `emailLookup`.** Phase 1 needs an authenticated read of it — no
new table.

---

## Plan (phased; each phase is independently shippable)

### Phase 1 — Server-backed "Your Spaces" (cross-device discovery)

The minimal change that delivers the core "my Spaces follow me" win, using only the
existing OTP identity. **No new table, no schema change.**

- **Server:** add an authenticated `GET /api/projects/:slug/auth/my-spaces` (lives
  in `auth.ts`, behind `authMiddleware`). It reads the _caller's own_
  `member.emailLookup` and, if the member has a verified email, returns every
  `{slug, name}` whose member shares that `emailLookup` and `emailVerified = true`
  (same query shape as `find-spaces`, `public-auth.ts:56`, but returned inline to a
  caller who already proved control of that email). Anonymous callers get `[]`.
  - Privacy: only returned to an authenticated caller for _their own_ verified
    email; no enumeration surface added.
- **Web:** in `MemberList.tsx` (PR #8's section), merge the server result with
  `listKnownSpaces()`, de-duped by slug. Server entries the device has no local
  token for render as links into that Space's recovery (email prefilled), since
  each Space still has its own token.
- **Result:** on a fresh device, after signing into _one_ Space, the panel shows
  _all_ the user's Spaces. Switching into one not yet on the device prompts a
  single OTP for that Space.

**Effort:** ~0.5–1 day. Files: `packages/server/src/routes/auth.ts`,
`packages/web/src/lib/api.ts`, `packages/web/src/components/members/MemberList.tsx`,

- one server test, + the PR #8 e2e (`packages/e2e/tests/home-recovery.spec.ts`)
  extended for the cross-device case.

### Phase 2 — One-verification multi-Space recovery (the cross-device "magic")

Turn "sign in once" into "sign in once → all my Spaces are ready on this device."

- **Server:** extend the recovery flow so a single email verification can hydrate
  every Space for that verified email. Two sub-options to decide at build time:
  - **(2a) Rotation-consistent (KISS, recommended first):** on verify, rotate and
    return `{slug, token, memberId}` for _all_ matching members. Matches today's
    one-token-per-member model (recovering on device B still logs out device A per
    Space — same as now, just applied across all Spaces at once).
  - **(2b) Concurrent multi-device:** introduce a `sessions` table (multiple tokens
    per member) so device A stays logged in. This is a real schema change and is
    the natural bridge toward Option A's session model — defer unless concurrent
    multi-device is explicitly wanted.
- **Anti-enumeration / abuse:** reuse the existing rate limits and the generic-response
  posture from `find-spaces`/`request-login-code`. Tokens are only ever returned
  after a valid OTP.
- **Web:** on successful multi-Space verify, `saveIdentity()` for each returned
  Space; route the user to their last-opened or chosen Space.

**Effort:** ~1–1.5 days for (2a). (2b) adds ~1–2 days + a migration.
Files: `packages/server/src/routes/auth.ts` (or `public-auth.ts`),
`packages/web/src/routes/{Home,Join}.tsx`, `packages/web/src/lib/{api,identity}.ts`,
e2e `recover-login.spec.ts`.

> Phases 1–2 deliver all three stated goals — _simpler mental model, cross-space
> identity, seamless multi-device_ — **without** a global account table and
> **without** OAuth. This is the honest KISS core.

### Phase 3 — Apple / Google social login (optional, additive)

Only when social login is actually wanted. This is the first _real second caller_
that justifies a stable account record, so it introduces the thin `accounts` table.

- **Schema:** add `accounts` (stable `id`, optional encrypted email + blind index,
  reuse `lib/email-crypto.ts`) and `account_identities` (`accountId`, `provider`,
  `providerSub`) — credentials attach to an account, **keyed off the provider
  `sub`, never the email** (Apple "Hide My Email" relays aren't stable keys). Add a
  nullable `members.accountId`. Backfill is additive: one account per unique
  verified `emailLookup`.
- **Auth:** OAuth callback → resolve/create account by `providerSub` → drive the
  same Phase-2 multi-Space hydration. **Link-on-login, not silent linking:** when a
  provider email matches an existing verified email, prompt the user to prove the
  existing credential before linking (prevents takeover via spoofed provider
  emails).
- **Keep OTP as primary.** Apple/Google are _additional_ credentials. This also
  keeps App Store Guideline 4.8 moot until/unless we ship a native/wrapped app with
  social buttons (a browser PWA is not bound by 4.8; if we add Google in a native
  app we must also offer an equivalent privacy login, which our own email/OTP can
  satisfy).
- **Apple specifics:** register the sending domain for the private-email relay so
  forwarded mail isn't bounced.

**Effort:** ~3–5 days incl. provider setup, callback, link-on-login, tests.
This is where the `accounts` table earns its keep — deferred to here on KISS
grounds (don't build the abstraction until the second caller exists).

---

## Design decisions / guardrails (from best-practice research)

1. **Auth global, authz tenant-scoped.** One credential reaches many Spaces;
   memberships, roles, and tokens stay per-Space.
2. **Upgrade in place.** When a guest registers/verifies, promote the existing
   per-Space member via `mergeMemberInto` — never mint a parallel record.
3. **Key identity off provider `sub` + verified email; link-on-login only.**
4. **Anonymous join stays first-class.** "Skip for now" remains; registration is
   never forced. The shopping-list use case is untouched.
5. **No central plaintext person→everything map.** Phases 1–2 derive "your Spaces"
   from the per-Space `members.emailLookup` blind index at read time; we do not
   persist a queryable cross-Space graph. Phase 3's `accounts` row holds only a
   stable id + (encrypted) email + provider subs.

---

## Privacy / legal touch-points

- Phases 1–2 add **no new persisted PII linkage** — only an authenticated read of
  existing per-Space data. Likely no Privacy/ROPA change beyond a sentence.
- Phase 3 introduces a stable `accounts` record and a third-party processor
  (Apple/Google). That **does** require: Subprocessors entry, Privacy update, and a
  note in `docs/security-decisions.md` acknowledging the (minimal) central account
  record. Revisit `Terms.tsx` §8 wording if identity semantics change.

---

## When to flip to Option A (global accounts)

Build A only if one becomes true (all three evaluations agreed on these):

- Identity becomes the product (durable public profiles, reputation, social graph).
- Going upmarket: enterprise SSO (SAML) / SCIM provisioning / org-level account
  governance becomes a deal requirement.
- A cross-Space feature needs a real-time authoritative person index (global
  search across all your Spaces, unified per-person billing).
- Privacy-first is dropped as a differentiator (removes A's main cost).

Until then, B is the _permanent_ answer, and Phase 3's `accounts` table is already
~70–80% of A's foundation if the day comes.

---

## Open risks

1. **Phase 2 token rotation UX:** (2a) logs other devices out per Space on
   recovery. Consistent with today, but if "stay signed in everywhere" is expected,
   we need (2b) `sessions`. Decide before building Phase 2.
2. **Phase 3 account-linking edge cases:** same person via Apple-relay, Google, and
   raw email looks like three identities. Link-on-login mitigates; needs careful
   tests.
3. **PR #8 dependency:** web changes assume PR #8's `MemberList` structure. Land on
   its branch or after merge.
4. **Anti-enumeration:** the new inline `my-spaces` read must stay strictly
   self-scoped and rate-limited so it can't become a Space-discovery oracle.
5. **Eager-rotation lost-response lockout (accepted):** Phase 2 rotates every
   other Space's token inside the verify transaction, so if the HTTP response is
   lost in transit the caller is briefly locked out of those Spaces (old tokens
   dead, new ones never delivered). Recoverable by re-running open-by-email. This
   is the same property single-Space recovery already has, amplified to N; we
   can't avoid it without rotating lazily (which would mean not returning other
   tokens at all, i.e. dropping Phase 2). Accepted given the rotation-consistent
   choice. The post-commit presence broadcast is wrapped so it can never turn a
   committed rotation into a 500.

---

## Recommended sequencing

1. Land PR #8.
2. **Phase 1** (cross-device discovery) — small, high value, no schema risk.
3. **Phase 2a** (one-verification multi-Space recovery) — the seamless win.
4. Reassess: is concurrent multi-device (2b/`sessions`) or social login (Phase 3)
   the higher priority? Build whichever the product actually needs next.
