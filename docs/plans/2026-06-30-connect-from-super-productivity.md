# Connect-from-Super-Productivity: onboarding & handover design

**Date:** 2026-06-30 (rev. 2026-07-01 after a second four-lens review)
**Status:** Design + Phase-1 implementation plan, hardened by a second review round.
Ready to implement once the §10 security must-dos are accepted.
**Scope:** plainspace.org only — the landing + onboarding + token-handover flow
for a visitor who clicks **Open Plainspace** in Super Productivity's (SP) Connect
dialog. SP is an external input/consumer here, not part of this work.

This doc supersedes the loose task brief and folds in two rounds of four-lens UX
review (KISS conversion, value-first activation, seamless-handoff, friction/trust
red-team). Round 2 (2026-07-01) grounded every claim in code and surfaced two
account-takeover-class issues now captured in **§10 (security must-dos)** — read
that before building. It is the Plainspace-side capture; the broader product vision
lives in [`2026-06-02-super-productivity-integration.md`](./2026-06-02-super-productivity-integration.md).

---

## 0. The reframe that drives everything

`/connect/super-productivity` is **not a token-management page** ("create a Space →
open settings → generate token → copy"). That model is the funnel's biggest leak:
the visitor clicked **Connect** in another app and expects to be _set up_, not sent
on a settings safari.

It is a **guided first-Space setup that hands back a connection key.** A brand-new
SP visitor needs a Space ~99% of the time, so creating their first Space is the
valued thing they came to do — we **name it and guide it, we don't bury it.** The
connection key is the payoff at the end. The one guardrail (KISS): keep Space setup
to a single lightweight step — name it, one line on what it's for — _guided, not a
multi-screen project wizard_. The user should perceive: _"I set up my first Space
and got a key to paste back into SP."_

Three architecture facts are immovable; the UX job is to make each feel natural:

| Fact (verified in code)                                                                                                                                                   | UX consequence                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| No token without a **verified email in a Space** (`api-tokens.ts` requires `member.emailVerified`)                                                                        | Front-load email verification; guide the user through naming + creating their first Space in one lightweight, prefilled step, then mint. |
| **One nameless, account-wide token**, shown once; minting **revokes the prior one everywhere** (partial unique index on `email_lookup`)                                   | Reconnect must **never** silently regenerate. "Auto-named" is presentation-only — no DB change.                                          |
| **Passwordless** = email + 6-digit code (10-min expiry, **2-min per-email resend cooldown** — `CODE_REQUEST_WINDOW_MS`, _not_ 30s; the 30s value is a different endpoint) | The code-wait screen is the load-bearing wall; instrument and harden it. Resend countdown = 2 min or it 429s.                            |
| A planted code + a code-minting endpoint is a **guessing oracle** (`creation_verifications` has no attempt counter; only per-IP limiting)                                 | `POST /api/auth/connect` mints a password-equivalent, so it **must** add a per-email failed-attempt cap — see §10.1.                     |

---

## 1. Recommended flow (Phase 1)

The page resolves from client state (`getVerifiedWitnessSlug()` + the existing-token
check) into a small state machine, most-finished state first:

1. **Already connected** (active token exists locally) → **reconnect/rotate** screen (§3). Never auto-mint.
2. **Verified & ready, no token** (local witness) → **1-tap Connect** → mint → reveal. **1 tap (Copy).**
3. **Brand-new, signed-out** → guided first-Space setup below. **~5 taps.**
4. **Returning user, new device / cleared storage** → same email + code path; the new
   `POST /api/auth/connect` mints against their **existing** membership (no duplicate
   Space, no magic-link hop). If a token is already active elsewhere → reconnect screen.

### Happy path — brand-new visitor

```
Land ──▶ Name your first Space + email ──▶ 6-digit code ──▶ (Space created; key auto-minted) ──▶ "Your Space is ready — here's your key" ──▶ Paste into SP
```

What's **guided and visible:** naming their first Space, confirming their email,
and landing on "your Space _X_ is ready." What stays **invisible and automatic:**
the token mint — once the email verifies, the key is minted and revealed in the
same step, so the user never taps a separate "generate token." We guide the Space,
not the plumbing.

### Screen A — Connect landing (the highest-leverage screen)

Value-first, and framed as **"set up your first Space to finish connecting"** — the
Space is the visible thing they're making, the email is how we confirm it's them.
Provenance + reframe + a named-and-editable first Space + a real exit are the four
moves that defuse the top-of-funnel bounce.

```
┌──────────────────────────────────────────────┐
│ [SP logo]  Set up your first Space             │
│ ○ Opened from Super Productivity   (chip)      │
│                                                │
│ Some tasks involve people who'll never open    │
│ Super Productivity — a client, your            │
│ accountant, a landlord. Plainspace gives them  │
│ a shared page they can open in any browser:    │
│ no app, no login. Assign them a task in SP and │
│ it shows up here for them to follow.           │
│                                                │
│ ▸ How does this work?      (expand — the aha)  │  ← two SEPARATE toggles
│ ▸ Is this safe?            (expand — trust)    │
│                                                │
│ Your name                                      │
│ [ Johannes                                   ] │
│ This is how people you share a task with see   │
│ you.                                           │
│                                                │
│ Your first Space                               │
│ [ Johannes's Plainspace                      ] │  ← prefilled from name, editable
│ A shared list you and specific people can see. │
│ (We'll create this if it's your first time.)   │
│                                                │
│ Your email                                     │
│ [ you@example.com                            ] │
│ No password to make. We email one 6-digit code │
│ to confirm it's you — that's your login.       │
│                                                │
│ By connecting you agree to our Terms & Privacy │  ← <LegalNotice>
│ Policy, and confirm you are 16+.               │
│                                                │
│ [        Continue — email me a code        ]   │
└──────────────────────────────────────────────┘
```

- **Concrete value, not brand-poetry** (round-2 onboarding lens): the old "where your
  tasks go when they need other people" made the value line carry the whole
  motivational load in language a casual, tap-first user skims past. Lead with the
  picture (a client / accountant / landlord who'll never open SP), _then_ the headline
  "Set up your first Space" reads as the how.
- **Two separate expanders, not one middot-joined toggle.** "Is this safe?" targets the
  #1 conversion blocker for a stranger-site email ask, so it must be its own tap with a
  real payload (drafted in §6), not a control that unfurls the how-it-works story.
- **Two light fields, both earning their place:** _Your name_ is the display name an
  assignee will see (beats an ugly `jane.doe` default) — and the helper line now
  says so on screen. _Your first Space_ (labeled "Name your first Space") starts **empty**
  with a placeholder hint; if left blank it falls back to `"<Name>'s Plainspace"` at
  creation. (An earlier auto-fill from the name was dropped as unwanted.)
- **Softened commitment for the returning edge case:** the "(We'll create this if it's
  your first time.)" line keeps the named-Space value for the ~99% brand-new users while
  not lying to a returning-on-new-device user whose entered name `connect` will discard
  (their reveal says "welcome back" — see Screen C).
- **No first-page exit button** (removed per feedback: it did little without a return
  URL). The reconnect screen keeps its "Back to Super Productivity" escape; the details
  screen just has "Continue".

### Screen B — Code wait / verify (the load-bearing wall)

```
┌──────────────────────────────────────────────┐
│ Check your email                               │
│ We sent a 6-digit code to you@example.com      │
│ Wrong email? Edit it                           │
│                                                │
│ Enter the code and your Space goes live.       │  ← keep the payoff salient
│ [  1 2 3 4 5 6  ]   (numeric, one-time-code)   │  ← auto-submits on 6th digit
│                                                │
│ Didn't get it? Resend in 1:53                  │  ← 2-min cooldown, NOT 30s
│ Still nothing? Check spam — some work mail      │
│ servers delay it a minute or two.              │
└──────────────────────────────────────────────┘
```

- **Resend countdown = 2 min** (`CODE_REQUEST_WINDOW_MS`). A 30s countdown would let
  the user tap Resend into a server **429** on the most critical screen. (The 10-min
  code _expiry_ the plan cites elsewhere is correct.)
- **`pending-connect` must be the resolver's FIRST check, not just Screen B prose.**
  Persist `{ email, step:'verify', requestedAt }` to localStorage at `requestCreationCode`
  success; clear on reveal/abandon. onMount reads it _before_ the witness check: a
  non-expired (`< CODE_EXPIRY_MS`) pending-connect restores straight to `verify` with the
  email prefilled. Without this wiring, a reload/app-switch mid-verify drops to cold
  `details`, and re-submitting hits the 2-min cooldown 429 while the valid code sits
  unused in the inbox — a hard dead-end (round-2 handoff + red-team, both HIGH).
- **Trim the error taxonomy to what's load-bearing** (round-2 KISS): wrong-code,
  expired→auto-resend (safe: 10-min expiry ≫ 2-min cooldown), and one generic
  send-failure. Defer a fuller taxonomy until the funnel numbers say this screen leaks.
- **The `minting` spinner gets a label:** "Setting up 'Johannes's Plainspace'…" — the
  last beat to make the Space feel like their deliberate creation before the reveal.

### Screen C — Token reveal (shown once)

```
┌──────────────────────────────────────────────┐
│ 🎉 Your Space "Johannes's Plainspace" is ready │  ← lead with the Space, by name
│ One last step: paste this key into Super       │
│ Productivity so it can post here for you.       │
│ ⚠ Shown once — copy it now, you won't see it   │  ← Banner variant="warning"
│   again.                                        │
│ [ pat_V1StGXR8Z5jdHi6Bf3kq9TnLwPocE2yUaMbN ]   │  ← <code>, tap-to-select = equal path
│ [  Copy key  ]   (→ Copied ✓ / Copy failed…)   │
│                                                │
│ This key lets Super Productivity add and       │
│ update tasks in your Spaces for you. Treat it  │
│ like a password. Lasts 1 year; disconnect      │
│ anytime from a Space's settings.               │
│                                                │
│ [  Open Super Productivity  ]  ← if return-URL │
│  else: [ I've saved my key ] + "switch back to │
│  SP and paste it into the Connect box."        │
└──────────────────────────────────────────────┘
```

Reuses the show-once pattern from `ApiTokens.tsx` (`Banner` + code box + Copy), with
four round-2 corrections:

- **Lead with the Space, not the key.** The old header ("You're connected") both
  overclaimed (they haven't pasted anything yet) and abandoned the Space they just
  named 20s ago. Celebrate the Space by name; frame the key as "one last step." For a
  **returning** user (`connect` `created:false`) the header instead reads _"Welcome
  back — we connected this to your existing Spaces."_
- **Honest CTA.** The old "Done — I've pasted it in SP" was gated on _Copy_, so it could
  be tapped before any paste. When a validated `?return` deep-link exists, the button is
  **"Open Super Productivity"** and _does_ the handoff (this is the "both apps now work
  together" moment). Otherwise it's **"I've saved my key"** + instructions — never a
  claim the user didn't perform.
- **Clipboard can silently fail** — the SP launch often lands in an in-app webview where
  `navigator.clipboard.writeText` is blocked. `ApiTokens.tsx:60-66` sets `copied(true)`
  even when the write _rejects_ (`.catch(()=>{})`), which would un-gate on a copy that
  never happened and strand the user with a lost show-once key; the opposite failure
  bricks the gate forever. Fix: set `copied(true)` **only** inside the resolved branch;
  on reject show "Copy failed — tap the key to select it," and make **tap-to-select an
  equal path that also satisfies the gate**. Prefer an explicit **"I've saved my key"**
  confirm as the real gate over clipboard-success. `pat_…` appears only in the code box.
- **Validate `?return` before using it** (see §10.4): parse with `new URL()`, require
  `protocol === 'superproductivity:'` exactly, reject everything else, never interpolate
  the raw value into `href`/`location`, and never put the token in the return URL/fragment.

---

## 2. How much SP↔Plainspace model to teach now

**Teach now (one sentence + opt-in depth):** _the people you assign tasks to can
follow along in Plainspace, no SP account needed._ That's the entire concept budget
required to make confirming an email feel reasonable. The "How does this work?"
expander carries the aha for anyone who wants it.

**Defer (taught in-context, never on this landing):** the full "SP is home, Plainspace
is for people" positioning; the Waiting-on lane; per-contact vs. per-promotion Spaces;
what the assignee experiences (their **invite email** carries its own context). The
model becomes obvious at the first real assignment — explaining it cold is a
conversion tax.

---

## 3. Account states & the reconnect/rotate hazard

| State                                | Detection                                             | Flow                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-out, new                      | no known Spaces, no witness                           | guided first-Space setup → `createProject` → `createApiToken` → reveal                                                                              |
| Signed-out, returning (same browser) | `getVerifiedWitnessSlug()` present                    | skip create; one-tap Connect → mint (or reconnect if token exists)                                                                                  |
| Returning, **new device**            | email owns Spaces, nothing local                      | email + code → `connect` finds a membership by `emailLookup + emailVerified` (**not** `loadIntegrationScope` — §10.2) → mint (**no Space created**) |
| Signed-in, **unverified-only**       | membership exists but `emailVerified=false`           | `connect` treats the just-verified code as proof → **upgrades** the membership to verified → mint (§10.3). Must _not_ 404 into a duplicate Space.   |
| Signed-in, verified                  | verified member                                       | one-tap mint → reveal (or reconnect screen)                                                                                                         |
| **Already connected**                | local token, or `connect` returns `already-connected` | **reconnect screen — regenerate is first-class + warned (§3 rule 1)**                                                                               |

### The hazard (the trust-killer)

The token is account-wide, nameless, shown once, and **minting revokes the prior
one everywhere**. So "reconnect" naively = "silently break SP on every other device."
Rules:

1. **Never _auto_-regenerate on revisit** (no mint without an explicit, warned tap).
   But **don't dead-end either** (round-2 conversion, HIGH): on `/connect`, arrival
   _implies_ the SP in front of them lacks a working key (the token is show-once and
   unrecoverable — the server only ever returns metadata). "You're already connected —
   nothing to do here → Back to SP" strands the most common reconnect population (new
   SP install, lost key, SP got a 401). So keep the guard, but make **"Generate a new
   key" a first-class, `ConfirmDialog`-gated action**, not a buried "Lost the key?" link,
   and don't assert "nothing to do here."
2. **Show recency** (`createdAt` + `lastUsedAt`) so the user self-diagnoses: "last used
   today" means they're fine. Handle **`lastUsedAt === null`** ("Never used") exactly as
   `ApiTokens.tsx:114-116` does — the DTO field is nullable.
3. **Regenerate is deliberate + warned + names the blast radius, including multi-device:**
   _"One key works across all your Spaces and apps. Generating a new one instantly
   disconnects the old key everywhere. If you use Super Productivity on another device,
   that device will be signed out."_ Routes through the existing `ConfirmDialog`.
4. **Disclose scope BEFORE the mint tap** (round-2 red-team), not only on the reveal: the
   1-tap and returning paths mint a password-equivalent, so the "acts as you across all
   your Spaces; can create Spaces; complete/claim your tasks; revoke anytime" line must
   show _before_ Connect/Generate, not after.
5. **SP-side resilience (external ask, §11):** SP should treat a sudden `401` as "your
   connection was replaced elsewhere — reconnect?", turning a silent break into a
   one-tap recovery.

```
┌──────────────────────────────────────────────┐
│ Super Productivity needs a key                 │
│ You already have one active for you@example.com │
│ Created Jun 3 · Last used today.               │
│ If this copy of SP already has it, you're set. │
│ Otherwise, generate a fresh key below.         │
│ This key acts as you across all your Spaces.   │  ← scope, before the tap
│                                                │
│ [  Generate a new key  ]   ← first-class, warned│
│ ⚠ Disconnects the old key everywhere, incl.    │
│   Super Productivity on your other devices.    │
│ [  Back to Super Productivity  ]   ← secondary │
└──────────────────────────────────────────────┘
```

---

## 4. Phasing

### Phase 1 — Guided connect + returning-user mint (ships now, one small endpoint)

Contextual landing keyed on the route; load-time state machine; front-loaded email
verification; **guided first-Space setup** (named, editable) for brand-new users via
the existing `createProject` → `createApiToken` chain; **one new endpoint —
`POST /api/auth/connect`** — that mints a key for a _returning_ user (existing
verified membership) straight from email + code, so they never create a duplicate
Space and same-screen copy works for new and returning alike; show-once reveal with
copy + "paste into SP"; never-silent reconnect screen. Reuses `Button`, `TextField`,
`FormCard`, `Banner`, `LegalNotice`, `ConfirmDialog`, `Collapsible`. **No
project-creation logic is duplicated** — the endpoint mints against email identity
only (§9 has the contract).

### Why `POST /api/auth/connect` is in the first ship (was deferred as Phase 1.5)

The returning-user requirement makes it load-bearing, not optional:

- kills the **duplicate-junk-Space** problem for returning-on-new-device users,
- gives a clean account-level mint path (no Space-slug detour, no magic-link hop),
- is the natural home for Phase 2's device-token,
- backs a first-class **"Connect an app"** entry point later (surface this same page
  from settings — the token UI is otherwise buried four levels deep).

### Phase 2 — Device-code, no copy-paste (final-panel swap only)

RFC 8628 device-authorization (chosen over redirect+PKCE because there is **no
cookie session** to anchor a redirect on; the page reuses the existing localStorage
identity for consent):

- `POST /api/integration/device-code` → `{ device_code, user_code,
verification_uri_complete, expires_in: 600, interval: 5 }`
- `POST /api/integration/device-token` ← SP polls; returns `{ access_token }` on approval.
- The final panel becomes an **"Approve Super Productivity?"** consent screen
  showing a **match code** (anti-phishing, since we auto-open the verify URL). The
  **token travels only in the poll body over TLS — never a URL/fragment** (honoring
  the `DeviceLink.tsx` "secrets in fragment, never query" discipline, and going one
  better). Same upstream steps; **only the last screen swaps.** Also fixes the
  cross-device case (phone approves, desktop SP receives).

Consent copy (Phase 2): _"Super Productivity wants to connect to your Plainspace
account, you@example.com. It will be able to: see and update tasks assigned to you
across all your Spaces; create a Space when you assign a task; mark assigned tasks
done. It can't read Spaces you're not in, and never acts as anyone but you. Lasts
365 days; disconnect anytime in any Space's settings."_

---

## 5. Context-aware enhancement (optional, depends on SP)

If SP passes the originating task + assignee in the URL
(`?task=Redesign+landing&assignee=anna@acme.co`), the landing can become a
**two-sided activation moment**: pre-name the Space from the task, pre-fill "who's
this for?", and fire the existing invite-email flow — so the user's first contact
with Plainspace is their _real_ task reaching a _real_ coworker, not an empty Space.
This is the strongest activation idea in the exploration, but it **depends on an
SP-side change** and adds an (optional, skippable) invite step, so it is **not**
required for Phase 1 core. Treat as Phase 1.x once SP can supply the context.
(Note: SP's brief says the Space is normally chosen later inside SP's own picker, so
this enhancement is additive, not a replacement.)

---

## 6. Trust & safety copy (reused affordances)

- **Why email:** "Plainspace has no passwords. Your email is your login."
- **What a Space is:** "A shared list you and specific people can see — the only
  thing Plainspace stores."
- **What the key is (benefit-shaped, not "act as you"):** "Lets Super Productivity add
  and update tasks in your Spaces for you. Treat it like a password."
- **Account-level, plainly:** "One key covers all your Spaces."
- **How to revoke:** disconnect from a Space's settings — and, since this page already
  holds the email identity, expose revoke _from the connect page itself_ (it's slated to
  become the "Connect an app" hub). Don't make the only instruction a 4-level menu
  breadcrumb the user can't act on now and won't remember.
- **"Is this safe?" expander payload** (the split trust toggle from Screen A):
  - No passwords — your email is your login.
  - We only store the shared lists (Spaces) you make.
  - The key covers only your own Spaces, and you can revoke it anytime.
  - You're on the real plainspace.org — check your address bar.
- **Provenance is the address bar, not the chip.** The "Opened from Super Productivity"
  chip is presentational only — referrer-based provenance was deliberately dropped
  (`bdd8fab`), so it's spoofable and proves nothing. Don't imply it verifies origin; the
  visible `plainspace.org` address is the real trust signal.

---

## 7. Measurement

Funnel keyed on the route, split by entry (new vs. returning, hot vs. cold):
`land → form submit → code sent → verified → key copied → (SP connected, Phase 2)`.
Explicit kill criterion: if the value/aha expander measurably _lowers_ the create
rate for warm (in-SP) arrivals vs. a form-first variant, collapse it further for
that segment. Storytelling earns its place against the number, not taste.

---

## 8. Decided vs. open

**Decided (baked in, easily flipped):**

- Funnel-with-a-guided-first-Space (not a management page); auto-mint; load-time state
  machine. Creating the first Space is the valued step, named + editable, not hidden. _(user steer)_
- "Key" language; show-once reveal reuse; reveal gate is **"I've saved my key"**, not
  clipboard-success (round-2: `writeText` can silently fail in SP's webview). _(4/4)_
- Never-silent-rotate reconnect screen with blast-radius warning. _(4/4, top risk)_
- Value-first first screen framed as "set up your first Space" + opt-in aha.
- **Named, editable first-Space field** (prefilled from name, ~5 taps). _(user steer)_
- **Returning users covered in the first ship** via one small endpoint,
  `POST /api/auth/connect` — email+code → mint against an existing membership, no
  duplicate Space, no magic-link hop. _(user steer)_

**Open (want product steer):**

- **SP context pass-through** (`?task`/`?assignee`) — pursue the two-sided
  activation hot path? Depends on an SP-side change.
- **Escape hatch**: just "I'll connect later," or also a read-only "see an example
  Space" (needs a demo Space to exist)? Recommend the link only, for now.
- **Token lifetime/scope** stays the existing 365-day account-wide single token for
  Phase 1; per-device named tokens are the thing to revisit _only if_ multi-device
  SP turns out common (would dissolve the rotate hazard).

**Confidence: 92%** (up from 88% — a second review round grounded every claim in code
and converted the two biggest risks from unknowns into specified fixes). The `connect`
endpoint is an assembly of verified pieces: code verify+consume (`projects.ts:96-118`),
membership lookup (`integration.ts:47-52`, **used correctly per §10.2**), token mint
(`api-tokens.ts:38-51`), active-token query (`api-tokens.ts:72-78`), member-token issue
(`issueMemberToken`), all in a file that already imports the code/email infra
(`public-auth.ts`). Round-2 also verified the security surface: no attempt counter on
`creation_verifications`, per-IP-only limiting, the `tosVersion` filter + current
`TOS_VERSION`, the partial unique index, non-transactional mint, and the dev-mode
`emailVerified` logic. The residual risk is **execution of §10** (the endpoint is only
safe with those guards) and SP-side capabilities (clipboard read/clear, custom-protocol
registration, task-context pass-through) — all external to this repo, enumerated in §11.

---

## 9. Phase 1 implementation plan (file-by-file)

One new SolidJS route + one small server endpoint. **Brand-new** users reuse the
existing `requestCreationCode` → `createProject` (which mints a **verified, isCreator**
member — `projects.ts:129` — so the next call works) → `createApiToken(slug)` chain.
**Returning** users (existing verified membership) go through the one new endpoint,
`POST /api/auth/connect`, which mints a key from email + code without creating a Space.
The web decides new-vs-returning by _trying connect first and falling back to
`createProject` on a `no-account` 404_ — so it never has to guess, and the endpoint
never duplicates project-creation logic.

### Files

**Create**

- `packages/web/src/routes/Connect.tsx` — the connect funnel (state machine below).
- `packages/web/src/routes/Connect.module.css` — page styling (reuse tokens from
  `global.css`; lean on `FormCard`/`Banner` so this stays small).
- `packages/web/src/routes/Connect.test.tsx` — branch coverage (mirror `Home.test.tsx`).

**Edit**

- `packages/server/src/routes/public-auth.ts` — add `POST /api/auth/connect` (contract
  below). Sibling of `request-creation-code`/`find-spaces`; reuses that file's rate-limit
  - code + email-crypto imports. Adds ~45 lines (file goes 158 → ~205, under 300).
- `packages/server/src/routes/public-auth.test.ts` (or the existing server test file for
  this router) — cover connect's outcomes **including the §10 security cases**: no-account
  404 (unused code), unverified-only → upgrade + mint, already-connected (no mint, stale-ToS
  user detected), connected mint + revoke prior, forced rotate, **per-email attempt cap
  locks the code after N wrong tries**, and concurrent-force → one 401 (0-row consume).
- `packages/shared/src/…` — add `ConnectRequestSchema` (`{ email, code, force? }`) and the
  `ConnectResponse` union: `{ status:'no-account', code:'no-account' }` |
  `{ status:'already-connected', apiToken, email, spaceCount }` | `{ status:'connected',
token, created, email, spaceCount, witness }` next to the other auth DTOs.
- `packages/web/src/lib/api.ts` — add `connect: (data) => request<ConnectResponse>('/auth/connect', …)`.
- `packages/web/src/App.tsx` — `const Connect = lazy(() => import('./routes/Connect'))`
  and `<Route path="/connect/super-productivity" component={Connect} />`. A
  two-segment static path never collides with the one-segment `/:slug`, so order is
  safe; place it with the other static routes for readability.
- `packages/web/src/lib/identity.ts` — (a) add `getVerifiedWitnessSlug(): string | null`
  that returns the slug **only if `getToken(slug)` is non-null** (dead-witness guard, §10.8);
  (b) make `clearIdentity(slug)` also clear `VERIFIED_WITNESS_KEY` when it matches the
  cleared slug; (c) add tiny `getPendingConnect()/savePendingConnect()/clearPendingConnect()`
  helpers for the resume-first resolver.

> No `components/ui` change → no `/_styleguide` update needed (we add a route, not a
> shared primitive). If any reveal/consent bit gets extracted into a primitive later,
> update the styleguide then.

### Server: `POST /api/auth/connect` (the one new endpoint)

Public and **code-gated**. It mints a password-equivalent, so it carries more guards
than a plain code check — the **§10 security must-dos are part of this contract, not
optional polish.** Request: `{ email, code, force?: boolean }`. `lookup = emailIndex(email)`.

1. **Rate-limit two ways:** per-IP (reuse `checkRateLimit`/`getClientIp`) **and per-email
   failed-attempt cap** (§10.1) — without the per-email cap this endpoint is a
   brute-force account-takeover oracle. Parse the body.
2. **Verify the code** against `creationVerifications` (`emailLookup` + `code` + `!usedAt`
   - not expired) — **do not consume it yet.** Invalid → count the failed attempt (§10.1)
     → `401`. Verify _before_ any account/membership/token query (§10.6): that ordering is
     what prevents email enumeration, so it must never be reordered.
3. `members = db.query.members.findMany(where emailLookup = lookup)` — **by
   `emailLookup` only, plus `emailVerified` handling below. Do NOT use
   `loadIntegrationScope`** (§10.2): it also filters `tosVersion === TOS_VERSION`, so a
   returning user with stale ToS (the whole installed base after any ToS bump) would read
   as _no account_ → duplicate Space + silent token revoke.
   - **verified member exists** → proceed to step 4.
   - **only unverified members exist** → the just-verified code proves email control, so
     **upgrade** them (`emailVerified = true`, set `tosVersion`/`tosAcceptedAt`) and
     proceed (§10.3). This is the "signed-in, unverified" state — it must mint, not 404.
   - **no members at all** → `404 { code: 'no-account' }` (a machine-readable
     discriminator in the body — §10.5), code left **unused** so the web falls through to
     `createProject` with the _same_ code.
4. `active = live token for lookup` (the `api-tokens.ts:72-78` GET query).
   - `active && !force` → `200 { status: 'already-connected', apiToken:
serializeApiToken(active), email, spaceCount }`. Code left **unused**. (Never silently
     rotate — the web shows the reconnect screen; "Generate new key" re-calls with `force`.)
5. Else → **consume the code atomically and bail if it's already gone** (`update … where
usedAt IS NULL`; **if 0 rows updated → `401`**, mirroring `projects.ts:116-118` — the
   current prose omitted this guard, and without it two concurrent `force` taps
   double-revoke and hit the partial-unique-index → 500; §10.7). Then, in **one
   transaction**, `revokeActiveTokens(lookup)` + insert a token from a verified member's
   `emailCiphertext/emailIv/emailLookup` (per `api-tokens.ts:38-51`). Also mint a member
   **session token** for one membership (`issueMemberToken`) so the new device can become
   a witness. → `200 { status: 'connected', token, created: false, email, spaceCount,
witness: { slug, memberToken, memberId, projectName } }`.

**Response shape** (shared `ConnectResponse` union): `no-account` (404, body `{ code }`),
`already-connected` (`apiToken` + `email` + `spaceCount`), `connected` (`token` + `email`

- `spaceCount` + `witness`). The `email`/`spaceCount`/`witness` fields exist because
  `serializeApiToken` carries none of them (`id/createdAt/lastUsedAt/expiresAt` only), yet
  the reconnect screen must name the _real_ owning email and the returning-user reveal
  wants "connected across your N Spaces" warmth (round-2 handoff #2/#9).

`revokeActiveTokens` + the mint insert should move to a small shared `lib/api-token.ts`
helper reused by `api-tokens.ts` (DRY) so the transactional version is the only one.

### `Connect.tsx` state machine

```
type ConnectState =
  | 'resolving'    // onMount: figure out which branch
  | 'details'      // email + name + first-Space name
  | 'verify'       // 6-digit code
  | 'minting'      // connect / create running (spinner)
  | 'reveal'       // show-once key
  | 'connected';   // already-connected / reconnect screen
```

**onMount resolver (most-finished first). Guiding rule: anyone who already has a
Space or an account never sees "set up your first Space" — they get a connect /
reconnect screen, and we mint against an _existing_ membership.** The PAT is
account-wide (a held token authorizes every verified membership for the email — see
`loadIntegrationScope`, `integration.ts:47`, though note its `tosVersion` filter is
_not_ usable for account detection, §10.2), so any one verified Space yields a key
covering all their projects — no Space picker.

0. **`pending-connect` first (round-2 fix).** If a non-expired `{ email, step:'verify',
requestedAt }` sits in localStorage → restore straight to `verify`, email prefilled.
   This is what makes a reload/app-switch mid-verify resume instead of dead-ending on the
   2-min cooldown (Screen B note).
1. `witnessSlug = getVerifiedWitnessSlug()`. **Guard it against a dead witness (§10.8):**
   `getVerifiedWitnessSlug()` returns the slug only if `getToken(slug)` is non-null (mirror
   `getProofToken`'s null-when-token-gone semantics), and `clearIdentity` must clear the
   witness key when it clears that slug — otherwise a deleted witness Space perpetually
   routes returning users to cold `details`. If a live witness → `api.getApiToken(witnessSlug)`:
   - token metadata → `connected` (local reconnect screen, `createdAt`/`lastUsedAt`).
   - `null` → verified-ready: one-button **"Connect Super Productivity"** → `mintAndReveal(witnessSlug)`.
     **Re-check for an active token immediately before that mint** and divert to the
     reconnect screen if one appeared (closes the TOCTOU silent-rotate, §10.7).
   - throws 401/404 (witness gone) → fall through.
2. **Else, before `details`, try known Spaces** (round-2 handoff #4): for a
   `listKnownSpaces()` slug that has a local token, `getApiToken(slug)` → token → `connected`;
   `null` → 1-tap connect. Recovers the warm path for stale-witness / join-only returning
   users instead of treating them as brand-new.
3. **Else → `details`**, email prefilled from `getPlainspaceEmail()`. **No separate recover
   branch** — the new-device _returning_ user and the brand-new user both go through email
   → code, and `connect` tells them apart from the email itself, so neither is pushed into
   a duplicate Space.

**Details → verify → connect-or-create (the unified tail):**

- `handleDetailsSubmit`: validate email + name (the Space name is optional and no longer
  auto-filled; `createFirstSpace` falls back to `` `${name()}'s Plainspace` `` when blank).
  → `api.requestCreationCode({ email })` →
  **persist `pending-connect` on success** → `verify`.
- `handleVerifySubmit`: `/^\d{6}$/` guard → `connectOrCreate(code)`.
- `connectOrCreate(code)` — state `minting`:
  ```
  try {
    const r = await api.connect({ email: email(), code });   // returning user?
    if (r.status === 'already-connected') {                  // token active elsewhere
      savePlainspaceEmail(r.email);                          // remember, even here
      setActive(r.apiToken); setPendingCode(code); setState('connected'); return;
    }
    // status 'connected' — seed local identity so THIS device becomes a witness
    savePlainspaceEmail(r.email);
    saveIdentity(r.witness.slug, r.witness.memberToken, r.witness.memberId, r.witness.projectName);
    saveVerifiedWitnessSlug(r.witness.slug);
    clearPendingConnect(); revealKey(r.token, { created: false, spaceCount: r.spaceCount });
  } catch (e) {
    if (e instanceof ApiError && e.body?.code === 'no-account') {   // NOT bare 404 (§10.5)
      const res = await api.createProject({
        name: spaceName(), displayName: name(), email: email(), code,   // same code
      });
      savePlainspaceEmail(email()); saveVerifiedWitnessSlug(res.project.slug);
      saveIdentity(res.project.slug, res.token, res.member.id, res.project.name);
      const t = await api.createApiToken(res.project.slug);
      clearPendingConnect(); revealKey(t.token, { created: true });
    } else { addToast('Could not connect — check the code and try again.'); setState('verify'); }
  }
  ```
- **Gate the fallback on `e.body?.code === 'no-account'`, never bare `e.status === 404`**
  (round-2 conversion #3 + red-team #2): any unrelated 404 (bad deploy, CDN, gateway)
  would otherwise spawn the duplicate junk-Space the endpoint exists to prevent.
- **Persist on the `connected` branch** (round-2 handoff #2): without saving the email +
  seeding a witness from `r.witness`, a new-device returning user is never recognized —
  cold every visit, and a back/reload after reveal loses everything. The `created:false`
  flag drives the "welcome back — connected to your existing Spaces" reveal header; the
  discarded Space name they typed is thus never presented as a created Space.

**Reveal screen** (Screen C copy) reuses `ApiTokens.tsx:81-94`'s show-once pattern but
does **not** copy its `handleCopy` verbatim: set `copied(true)` **only inside the
resolved branch** of `writeText` (the original `.catch(()=>{})` flips it even on failure
— §10.3). On reject, show "Copy failed — tap the key to select it," and make
**tap-to-select an equal path that also satisfies the gate**; prefer an explicit **"I've
saved my key"** confirm over clipboard-success as the real gate. Header leads with the
Space (or "Welcome back…" when `created:false`). The primary action is **"Open Super
Productivity"** iff `useSearchParams().return` passes the §10.4 URL validation; else
**"I've saved my key"** + instructions. `pat_…` appears only in the code box.

**Reconnect screen** = the §3 copy; "Generate a new key" is a **first-class**,
`ConfirmDialog`-gated action (§3 rule 1). Two entry points:

- reached **locally** (live witness token) → `createApiToken(witnessSlug)`.
- reached via **connect `already-connected`** (new device, `pendingCode` held) →
  `api.connect({ email, code: pendingCode, force: true })`. **If that 401s because the
  held code expired** (it can sit unused for the full 10-min window), don't dead-end —
  route back to `verify` with a fresh `requestCreationCode` (§10.6). Both success paths → `reveal`.

### Reused, not rebuilt

- API: `requestCreationCode`, `createProject`, `createApiToken`, `getApiToken`,
  `ApiError` (with `.body` for the `no-account` discriminator) — already in `lib/api.ts`;
  **new:** `connect`.
- Server: `checkRateLimit`/`getClientIp`, `emailIndex`/`encryptedEmailFields`, the
  `creationVerifications` verify+consume, `issueMemberToken`, `revokeActiveTokens` + mint
  from `api-tokens.ts` (extract to `lib/api-token.ts`) — all existing.
- Identity: `getPlainspaceEmail`, `savePlainspaceEmail`, `saveVerifiedWitnessSlug`,
  `saveIdentity`, `clearIdentity` (now witness-aware) + new `getVerifiedWitnessSlug`
  (guarded) and `get/save/clearPendingConnect`.
- UI: `FormCard`, `TextField`, `Button`, `Banner`, `LegalNotice`, `ConfirmDialog`,
  `CollapseToggle`/`CollapseBody` (the two "How does this work? / Is this safe?" expanders).

### Build steps (each paired with its check)

1. **Shared DTOs** — `ConnectRequestSchema` + the `ConnectResponse` union in `packages/shared`.
   _Verify:_ `npm run -w packages/shared build` / typecheck passes.
2. **`POST /api/auth/connect`** in `public-auth.ts` with **all §10 guards from the start**
   (per-email attempt cap, membership-by-`emailLookup` not `loadIntegrationScope`,
   unverified-upgrade, `no-account` discriminator, 0-row-consume abort + transactional
   revoke+mint, witness session token) + server test. _Verify:_ server vitest (embedded-pg)
   green across the §10 cases listed in the test-file bullet — not just the happy path.
3. **`api.connect`** in `lib/api.ts`; **`getVerifiedWitnessSlug()` (guarded)**,
   witness-aware `clearIdentity`, and `pending-connect` helpers in `identity.ts`.
   _Verify:_ web typecheck + a unit test that a cleared identity clears the witness key.
4. **Route + scaffold** — lazy route; `Connect.tsx` renders a stub. _Verify:_
   `npm run -w packages/web build` clean; `/connect/super-productivity` renders the stub
   and `/:slug` still loads a Space.
5. **Details form + copy** (Screen A: split expanders, name helper, softened Space line),
   name↔Space-name sync, submit → `requestCreationCode` → **persist `pending-connect`** →
   `verify`. _Verify:_ form renders; submit advances to the code step (dev echo).
6. **Verify + `connectOrCreate`** (fallback gated on `code:'no-account'`; save email + seed
   witness on `connected`). _Verify (run with `NODE_ENV` unset/non-development — §10 dev
   note):_ brand-new email → reveal with real `pat_…` + created Space; an email owning a
   verified Space → key **without** a new Space; an unverified-only membership → upgraded +
   key, still no new Space.
7. **Reveal screen** (Screen C) — Space-led header, clipboard-fail path (`copied` only on
   resolve; tap-to-select = equal gate), validated `?return`, honest CTA. _Verify:_ on a
   forced `writeText` reject, the gate does **not** open on a failed copy and tap-to-select
   still lets the user proceed.
8. **onMount resolver** (`pending-connect` first, guarded witness, known-Spaces fallback)
   **+ reconnect screen** (first-class warned regenerate, both entry points, stale-code →
   re-request). _Verify:_ seed localStorage / mock `connect` per branch — pending-connect →
   verify; local token → reconnect; witness no-token → 1-tap; already-connected → reconnect
   - force; stale witness slug → not treated as brand-new; empty → details.
9. **`Connect.test.tsx`** — render per state (mock `api`), assert reveal shows the key once,
   the gate holds on copy-failure, and the fallback fires **only** on `code:'no-account'`
   (a bare 404 does not create a Space). _Verify:_ `npm run -w packages/web test` green.
10. **Full check** — `npm run check` (typecheck + lint), accounting for the known
    pre-existing prettier drift on main.

### Explicitly out of Phase 1 (tracked for later)

- Device-code endpoints + consent screen (Phase 2).
- First-class **"Connect an app"** entry point reusing this page from Space settings
  (the same `/api/auth/connect` seam backs it).
- Reading `?task`/`?assignee` SP context for the two-sided activation hot path
  (Phase 1.x, depends on SP).
- Per-device **named** tokens (would dissolve the rotate hazard + the multi-device
  ping-pong) — revisit trigger: >1 user reports a device silently disconnected (§8).
- Funnel analytics events — wire to the app's analytics if/when one exists; otherwise
  defer (no telemetry lib is in the web bundle today).

---

## 10. Security & correctness must-dos (from round-2 review — part of the contract)

These are **not** optional hardening; the endpoint mints a password-equivalent, and
several are code-confirmed defects in the round-1 contract. Each cites where it bites.

1. **Per-email brute-force cap (CRITICAL).** `creation_verifications` has no attempt
   counter and the only limit is per-IP, while `request-creation-code` plants a live code
   for _any_ email named. So `connect` — which mints an account-wide PAT and revokes the
   victim's token on a hit — is a guessing oracle: N proxied IPs ≈ N× guesses against a
   6-digit code in a 10-min window. **Fix:** a per-email (blind-index) failed-attempt cap
   that invalidates the code after ~5 wrong tries (mirror the existing
   `verificationAttemptEmailKey` pattern in `verification.ts:160` / a `checkRateLimit` on
   `emailIndex(email)`). The 2-min per-email re-plant cooldown then bounds total guesses.
   (Arguably backfill `POST /api/projects` too; mandatory here.) **Accepted tradeoff
   (round-2 security W1):** because the cap is checked before the code logic, someone who
   knows a victim's email can burn 5 junk-code calls to 429-lock the whole `/connect`
   funnel for that email for the ~10-min window (repeatable). Bounded, doesn't touch
   existing connections, and consistent with the codebase's other per-email caps —
   loosening it reopens brute-force, so we keep it and document the tradeoff.
2. **Account detection must not use `loadIntegrationScope` (HIGH) — and the mint must
   refresh ToS.** `loadIntegrationScope` filters `tosVersion === TOS_VERSION`
   (`integration.ts:52`; `TOS_VERSION` = `2026-06-01`). Two consequences, both handled:
   (a) _Detection:_ every user on the prior ToS would read as _no account_ → duplicate
   Space + silent PAT revoke. **Fix:** detect membership by `emailLookup` (+ verified
   handling in §10.3) only; drop `tosVersion` from the check. (b) _Functionality (round-2
   correctness):_ detection alone isn't enough — the _minted_ PAT is itself resolved by
   `loadIntegrationScope`, so a stale-ToS user would get a `200 connected` token that
   resolves to **zero Spaces** (inert key). **Fix:** inside the mint transaction, refresh
   `tosVersion`/`tosAcceptedAt` on **all** the email's verified memberships. The connect
   page collects consent (`<LegalNotice action="connecting">`), so this is legitimate, and
   it makes the account-wide token actually cover the user's Spaces.
3. **Upgrade unverified-only memberships instead of 404-ing (HIGH).** A user _added_ to a
   Space but never verified there has only `emailVerified=false` rows; `loadIntegrationScope`
   (and any verified-only query) returns empty → duplicate Space. The just-verified code
   _is_ proof of email control. **Fix:** if only unverified members exist, set them
   verified (+ `tosVersion`/`tosAcceptedAt`) and mint; only truly-memberless emails 404.
4. **Validate `?return` (MEDIUM, XSS/open-redirect).** Parse with `new URL()`; require
   `url.protocol === 'superproductivity:'` exactly (a `startsWith` check is bypassable);
   reject everything else; never interpolate the raw value into `href`/`location`; never
   put the token in the return URL or fragment (Phase 2 already commits to token-in-body).
5. **Machine-readable `no-account` discriminator (MEDIUM).** Return `{ code: 'no-account' }`
   in the 404 body; the web fallback must gate on `e.body?.code === 'no-account'`, not bare
   `e.status === 404`, or any stray 404 (bad deploy/CDN) spawns a duplicate Space.
6. **Enumeration ordering is load-bearing (INFO→enforce).** The real defense is
   _verify-first ordering_: no account/membership/token query runs before the code verify,
   so account state is only ever revealed to a caller who already proved email control with
   a valid code. Enforce that ordering in code + test. (Note: past the code check the
   statuses do differ — `no-account` 404 vs `already-connected`/`connected` 200 — so they
   are _not_ byte-identical; that's fine, because reaching any of them requires the valid
   code. The invariant to protect is the ordering, not response-shape uniformity.)
7. **Atomic-consume abort + transactional mint (MEDIUM).** After the `update … where
usedAt IS NULL`, **if 0 rows changed → 401** (`projects.ts:116-118` does this; the mint
   in `api-tokens.ts` is non-transactional and the round-1 prose dropped the guard). Wrap
   `revokeActiveTokens` + insert in one transaction, else concurrent `force` taps
   double-revoke and violate `idx_api_tokens_active_email` → 500. Also close the resolver's
   1-tap **TOCTOU**: re-check for an active token immediately before `createApiToken`.
8. **Dead-witness self-heal (MEDIUM).** `clearIdentity` (`identity.ts:65`) does _not_ clear
   `VERIFIED_WITNESS_KEY`, so a deleted witness Space leaves a slug that routes returning
   users to cold `details` forever. **Fix:** `getVerifiedWitnessSlug()` returns the slug
   only when `getToken(slug)` is non-null, and `clearIdentity` clears the witness key on a
   match.

**Dev-mode note (resolved):** previously, with `NODE_ENV=development`, `createProject`
skipped code verification and stamped a brand-new creator `emailVerified=false`, so the
follow-up `createApiToken` returned **400 "Add an email…"** and the brand-new reveal
dead-ended in dev. `createProject` now verifies + consumes a _supplied_ code regardless of
env and sets `emailVerified` from that (`proofVerified || codeVerified`), so the brand-new
flow completes in dev too. Production is unchanged (a valid code or proof token is still
mandatory); codeless dev creation still works and stays unverified.

---

## 11. SP-side contract (external asks — enumerated so SP can implement in parallel)

Plainspace can't ship the seamless story alone; these are the asks _on Super Productivity_.
Documented here so they're explicit, not assumed:

- **Return URL:** define the param SP passes (name + shape) so "Open Super Productivity" /
  "I'll connect later" can bounce back. Plainspace validates it per §10.4; SP must register
  the `superproductivity://` scheme. The deep link deliberately carries **no token** — so SP
  must provide a paste target and, ideally, read the clipboard when the deep link fires.
- **401 handling:** treat a sudden `401` on a previously-working key as "your connection was
  replaced on another device — reconnect?" (one-tap re-open of this page), not a hard error.
  This converts the account-wide-token rotation from a silent break into a recoverable event.
- **Mobile clipboard fragility:** app-switching can clear the clipboard or evict the browser
  tab holding the show-once key. Plainspace mitigations: an explicit "I've saved my key"
  gate (not clipboard-success), and a short-lived `sessionStorage` flag so a reload back to
  the reveal lands on a "Did SP get your key? [Regenerate]" recovery screen rather than the
  cold resolver. SP's clipboard-read-on-return closes the loop from its side.
- **(Optional, Phase 1.x) task context:** if SP passes `?task`/`?assignee`, Plainspace can
  pre-name the Space and fire the invite flow (§5).
