# Private-Space onboarding: deferred, link-join stays the default

**Status:** deferred — not building yet. **Noted:** 2026-06-18.

## Context

Identity today is **link-first and anonymous-friendly**: you share a Space URL,
join by typing a display name (`routes/members.ts` `POST /join`), and email is
_optional_, attached afterwards only for recovery / cross-device
(`routes/verification.ts`, `routes/auth.ts`). There is no "invite" concept in
the code — `grep -i invite` is empty. "Invite via link" just means "share the
Space URL".

`sharingMode: 'private'` only **turns link-joining off** (`routes/members.ts`
guards `/join`; `SharingModeControl.tsx` frames it as "Link joining: Off").
Existing email-verified members can still get back in, but **no new person can
join a private Space at all** — it's an onboarding dead end.

The open question raised: should we add an **email-invite** concept?

## Decision

**Don't tackle this prematurely.** Keep link-join as the casual default. Do not
replace it with email invites — that fights the product's touch-first,
anonymous-friendly character and adds a whole subsystem against KISS. Build a
private-Space onboarding path only **when a concrete need arises**, and at that
point choose between the two options below based on what "private" actually has
to mean.

## When the need arises, choose between

**Option 1 — gated link-join (preferred default).** A private Space still has a
shareable join link, but joining requires email verification instead of a bare
name. Reuses the existing verification rails (`request-verification` / `verify`
and the unauthenticated code pattern in `auth.ts`) — essentially "join + verify
fused". Smallest diff; keeps the link as the unit of sharing.
_Catch:_ it does **not** gatekeep — a leaked link still lets anyone in, just
email-identified rather than anonymous. What it buys is **accountability and
recoverable identity**, not a locked door.

**Option 2 — admin email-invite (only if true access control is required).**
Admin enters specific addresses; the system sends each a join code; only invited
emails can join. This is Option 1 **plus** an admin guest-list UI, pending-invite
state, resend/revoke, and "accept creates the member" logic. Genuinely curates
who may enter, but it's a heavier, less-casual product and exactly the kind of
speculative machinery to avoid without a real request.

**Pivot rule:** default to Option 1. Choose Option 2 only if the requirement is
specifically _"only these named people may ever join, and I curate the list."_
A shareable link with email-gating cannot provide that; anything short of it,
Option 1 covers more cheaply.

## Revisit when

- A real user/operator needs to onboard people into a **closed** Space (today
  impossible), **or**
- "Private" is asked to mean a curated guest list rather than just
  "anonymous link-join off".

Until then, the dead-end is acceptable for pre-launch / micro-scale operation.
