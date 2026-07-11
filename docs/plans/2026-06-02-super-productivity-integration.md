# Super Productivity ↔ Plainspace integration

**Date:** 2026-06-02
**Status:** Brainstorm / product vision — not ready to implement. Captures
several rounds of design discussion; concrete implementation plans (e.g.
device-code auth) should be split into their own dated plan docs as they
become ready.
**Goal:** Make Plainspace feel like a native part of working in Super
Productivity. SP stays the personal task surface; Plainspace becomes the
collaboration surface that gets summoned when a task needs other people.
The integration is what makes the seam invisible.

---

## Positioning

**SP is where tasks live by default. Plainspace is where they go when they
need other people.**

Most work in SP stays solo. The moment a task needs another human —
assigning it, asking for help, coordinating context — it "promotes" to a
Plainspace Space. Promotion carries the task, your identity, the assignee,
and (optionally) the body across. The assignee never installs SP; they get
the Plainspace invite they'd get anyway.

The current Plainspace integration API (`packages/server/src/routes/integration.ts`)
is built for the _opposite_ direction: read assigned tasks back into SP.
That direction still matters — it's how the assigner tracks the delegated
work (see "Waiting-on lane" below) — but the dominant flow is
**SP → Plainspace**, not Plainspace → SP.

## The trigger: a new Assignee field in SP

SP doesn't currently have assignment, because SP is single-user. The
integration adds an **Assignee** field on every SP task, **always visible**
(even for users with no Plainspace connection).

Reasons to always show it, not gate on "Plainspace configured":

- The empty field's prompt — _"Connect Plainspace to assign…"_ — is the
  single best ad Plainspace will ever get inside SP.
- Discoverability: users find the feature when they need it, not when they
  remember to enable an integration.
- Solo users lose nothing — the field is dormant for them.

Assigning to yourself is a no-op. Assigning to anyone else is the promotion
trigger.

## The promotion flow

1. SP task open. User types an email or name into Assignee.
2. SP detects "this isn't me" → confirm: _"Collaborate on this in
   Plainspace?"_
3. Browser opens to Plainspace, **already at Space creation**, pre-filled:
   - Space name from the task title
   - First item seeded with title + body
   - Assignee pre-invited
   - Me as creator
4. User reviews, hits Create. Plainspace fires its existing invite-email
   flow.
5. SP task gains a Plainspace badge + link. Per-task sync takes over from
   here.

Two clicks plus optional Space-name polish. No copy-paste.

## What happens to tasks assigned to someone else

The big conceptual addition this needs from SP: **a "Waiting on" lane.**
Tasks assigned away enter this state. It's the GTD pattern, and SP
arguably should have it anyway — the integration just motivates it.

A delegated task:

- **Leaves the active plan.** No Today count, no timer queue, no scheduling
  nags. Not your work anymore.
- **Stays visible in a Waiting-on filter.** One virtual filter, not a
  project. Sorted by assignee + last activity.
- **Loses solo-task affordances.** No timer, no sub-tasks UI, no estimate.
  Gains: live status from Plainspace, Space membership, "Open in
  Plainspace" link.
- **Keeps one private editable thing.** Your own follow-up note. Doesn't
  sync back. SP is allowed to be your private memory of the delegated
  task.

Auto-resolutions:

- **Closed in Plainspace** → greens out in SP, archives on the normal
  completed-task schedule. No notification (you'll see it on next glance).
- **Re-assigned back to you** → re-emerges as a normal task with a subtle
  "Anna sent this back" badge. Now eligible for Today again.
- **Re-assigned to a third person** → still in your Waiting-on, updated
  avatar. No churn.

Editable in SP: the Assignee field. Changing it pushes back to Plainspace.
This is the only direction of bi-directional assignment that's safe — you
acting on your own task, not Plainspace dictating into a third party's SP.

## Default Space targeting: per-contact, not per-task

The choice that decides whether the assignee's inbox stays manageable.

- **Per-contact (default):** a "Me + Anna" Space, reused for everything you
  collab on. Matches how 1:1 work actually feels — ongoing relationship,
  not 47 disposable rooms. Activity log accumulates meaning.
- **Per-promotion (explicit override):** each promoted task = fresh Space.
  For kickoff projects and formal initiatives.

Behavior: remember the user's last pick per assignee. If your last three
assignments to Anna all went to the "Me + Anna" Space, the fourth defaults
there.

## The contact book emerges by accident

Once you've assigned things to Anna a few times, SP knows her email and
display. Autocomplete handles the rest. Plainspace doesn't need its own
contacts model; SP grows one as a side-effect of using the integration.

## Auth: device-code, not copy-paste

The existing PAT flow (Space → settings → create token → copy → paste into
SP) is fine for an early v1 but breaks the seamless feel. Target UX:

1. SP "Connect Plainspace" → browser opens to a Plainspace page, already
   logged-in.
2. Page shows: _"Approve Super Productivity?"_ → Yes.
3. SP polls a Plainspace endpoint, gets the same kind of token
   `apiTokens` already stores.

Scope this as its own Plainspace plan — one route pair
(`POST /api/integration/device-code`,
`POST /api/integration/device-token`) plus a small approve page. Small,
real, useful even before any SP work lands, and unblocks the rest of the
seamless story.

## Opening a Space signed-in — deferred (needs a short-lived grant)

**Status: NOT shipped.** A `POST /api/integration/space-link` endpoint (PAT +
`{ spaceId }` → a `#claim` URL) was prototyped to cover Auth goal #1 for the
**view-my-Space** click — the case where SP opens the Space in the OS default
browser via `shell.openExternal`, which holds no web session even after Connect
ran. It was reverted after review for a security reason, and is captured here so
it can be built correctly when SP actually needs it.

**Why the naïve version is wrong.** Minting a normal **member session token**
from the PAT expands the blast radius of a compromised PAT: a member token
authenticates the full member web API for that Space — including destructive ops
the integration API can't do (delete Space, remove members, data export) — and
`member_tokens` currently never expire and are **not** revoked when the PAT is
revoked. So a PAT-only leak could mint persistent, higher-privilege sessions that
survive the user revoking the leaked PAT. (The "strictly less powerful than the
PAT" framing used in the prototype was wrong: the member token is narrower in
scope but deeper in capability.)

**How to build it right (when SP needs it):** hand back a **short-lived,
single-use login grant**, not a durable member session — e.g. a dedicated grant
row (short TTL, `used_at`) exchanged for a session on page load, or give
`member_tokens` an `expires_at` + a revoke-on-PAT-revoke link and a sweeper. Keep
the `spaceId`-intersected-with-membership scoping (a foreign/unknown Space is
404, no probe) and the fragment-not-query discipline from the prototype.

**Until then**, the connect-side fix already signs users in for the common case
(same browser as Connect, and returning users via the reconnect screen). A
genuinely fresh browser falls back to the Space's existing **"Open by email"**
recover flow — one extra step, no new credential surface.

## Asymmetry to preserve

- **SP → Plainspace writes:** check/uncheck, time tracked, notes-as-
  comments, presence ("I'm working on this now"), assignment changes on
  your own task.
- **Plainspace → SP reads:** title/list/column/assignment changes,
  removals, reminders.
- **What SP must _not_ be allowed to do:** restructure the Space's
  lists/columns, dictate assignment into a third party's SP, demote a
  Space back to a solo task.

## Latency target

≤5s from action to visible-elsewhere. Slow enough that polling is
acceptable; fast enough that team chat happening next to the task in the
Space stays coherent with what SP shows.

## Where this work actually lives

- **Super Productivity repo (most of it):** the Assignee field, the
  Waiting-on lane, the promotion confirm, the Plainspace provider plugin,
  the contact book.
- **Plainspace repo (small, scoped):** device-code auth; `?updatedSince=`
  on `GET /api/integration/tasks`; `updated_at` column on `items`;
  surfacing `remindAt` and list info on the task DTO; a signed-in space-link
  handover (deferred — see above). Each justified by a real plugin need, not
  speculative.
- **Cross-cutting product narrative:** belongs in the SP repo, alongside
  SP's own product docs. This file is the Plainspace-side capture of the
  shared vision.

## Non-goals

- Multi-collaborator assignment. Plainspace's `assignedTo` is single;
  multi-collab is what Space _membership_ expresses, not item assignment.
- Demoting a Space back to a solo SP task. Once shared, it lives in the
  Space.
- Pushing assignment from Plainspace into a teammate's SP — they may not
  have it, and we never want Plainspace writing into someone else's local
  app.
- Plainspace growing schema to mirror SP's richness (sub-tasks, tags,
  estimates). Notes can become activity-log comments; the rest stays
  SP-local. KISS.
- A delegation-chain UI in SP. The Space's activity log tells the chain
  story; SP shows the _current_ assignee only.
- Webhook push from Plainspace → SP. SP runs locally; relay infra not
  worth it. Polling with `updatedSince` is enough.

## Open questions to resolve before implementation

- **Confirm modal vs. silent promotion.** Is the "Collaborate on this in
  Plainspace?" step necessary, or should typing a non-me email just
  promote? Confirm is safer against typos but adds friction. Lean toward
  confirm for v1.
- **Body mapping.** SP task notes are markdown and can be long; Plainspace
  `items.text` is `varchar(500)`. First line becomes the item title — but
  where does the rest go? Scratchpad entry on the Space? First comment on
  the item? Truncate?
- **Per-contact Space naming.** "Me + Anna" reads weird. "Anna" alone is
  ambiguous (whose perspective?). Probably let the user name at creation,
  default suggestion = assignee's display name.
- **Delegated-task auto-archive timing.** Same window as solo done tasks,
  or longer (delegator may want follow-up visibility)?
- **What the SP plugin reads to mirror identity.** Plainspace member
  identity (avatar index, color, display name) is per-Space, not global.
  Either pick one Space's identity to surface in SP, or aggregate. Likely
  fine to defer.
