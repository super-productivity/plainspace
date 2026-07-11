# Content-removal Statement-of-Reasons in code

**Date:** 2026-05-21
**Status:** Draft (not for pre-launch — see "Why not now")
**Goal:** Send a DSA Art. 17 Statement of Reasons programmatically when an
admin removes content (an item / task) as an enforcement action, mirroring
the existing member-removal SoR path. Once shipped, broaden Terms.tsx §8
back to "If we remove content you contributed…" without the programmatic
gap.

## Why not now

Pre-launch / friends-and-family scale, DSA-notice volume is ≤ a handful
per year. Operators can compose SoRs manually from
`docs/dsa-sor-templates.md` and send by hand. The Terms wording shipped
in commit `f049ce7` (Batch C) narrows the promise to "membership removal
or content removal as an enforcement action", which is honest about the
current operator-manual path.

Trigger to ship this: any of

- DSA-notice volume exceeds ~1/quarter sustained, or
- A real Art. 16 notice arrives and an operator-manual SoR feels
  too slow / error-prone, or
- A beta tester opts into B2B-style operator features that need a
  notice-and-action audit trail.

## What lands when this ships

Single PR, ~4–6 h of focused work. No DB migration; reuses existing
`activity.meta` JSONB.

### 1. Server — `packages/server/src/routes/items.ts`

Modify `DELETE /api/projects/:slug/items/:itemId`. Two paths now:

- **Routine delete** (current behaviour): no body, soft-delete via
  `deletedAt`, broadcast `item.deleted`. Available to any member of
  the project.
- **Enforcement delete**: body `{ reason: string, language?: 'en'|'de' }`,
  **`requireAdmin` middleware**. Same soft-delete, then:
  1. Look up the item's `createdBy` member.
  2. If the creator still has a member row in this project and an
     encrypted email is present, decrypt and call
     `sendStatementOfReasons`:
     ```ts
     await sendStatementOfReasons({
       toEmail: creatorEmail,
       language: body.language ?? 'en',
       action: `Removal of your task from the Space "${project.name}".`,
       factsAndCircumstances: body.reason,
       groundReference: 'Plainspace Terms of Service §7 (Acceptable Use)',
     }).catch((err) => {
       console.error('Failed to send Statement of Reasons (content)', {
         projectId: project.id,
         itemId,
         err,
       });
     });
     ```
  3. Persist the audit trail in `activity.meta`:
     `{ reason, sorSent: <bool>, sorLanguage: <'en'|'de'>, sorRecipient: <memberId> }`.
     This is what an auditor reads later; matches the shape of the
     member-removal entry in `routes/admin.ts` (the `member.removed` handler).

**Edge cases (handle in order):**

- Creator already self-deleted (member row gone or authorship nulled):
  skip SoR, set `sorSent: false`, `sorSkipReason: 'creator-not-resident'`.
- Item has no creator (legacy data, `createdBy` null): same — skip SoR
  with `sorSkipReason: 'no-creator-on-record'`.
- SMTP failure: same as auth.ts — log, don't block the delete. The
  activity row records the attempt.

**Authorization** — easiest: split into two endpoints rather than branch
inside one. Lower complexity, no body-driven middleware switch:

- `DELETE /items/:itemId` — `authMiddleware` only. Current behaviour.
- `POST /items/:itemId/enforce-removal` — `authMiddleware` +
  `requireAdmin`. New body shape. Internally calls the same soft-delete
  helper plus the SoR path.

The split also makes the audit log unambiguous (`action: 'item.removed_with_sor'`
vs `'item.deleted'`).

### 2. Shared — `packages/shared/src/validation.ts`

Add Zod schema:

```ts
export const ItemEnforceRemovalSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
  language: z.enum(['en', 'de']).optional(),
});
```

10-char floor matches the spirit of Art. 17 ("factual and legal grounds");
2000-char ceiling protects template injection.

### 3. Web — admin-only menu item

`packages/web/src/components/lists/ListItem.tsx` (or wherever the item
context menu lives) — admin-only entry "Remove with notice…". Opens a
small dialog:

- **Reason** textarea (Zod-mirrored constraints: 10–2000 chars).
- **Language** radio: English / Deutsch (default English).
- **Submit** → `POST /items/:itemId/enforce-removal` with the body.
- **Cancel** → close.

Use the existing `Dialog` primitive from `components/ui` — same shape
as the admin member-removal prompt (`MemberList.tsx`), but a real
dialog instead of `prompt()`. Bonus: this is a chance to also upgrade
MemberList's `prompt()` to the same component (P3 finding from the
client-side audit).

### 4. Terms.tsx §8 revert (post-ship)

When this lands, broaden the §8 SoR wording back to its pre-Batch-C
shape (one PR after the implementation, paired with a `TOS_VERSION`
bump):

> Statement of reasons (DSA Art. 17). If we remove content you
> contributed, or suspend your account, we will tell you what was
> affected, the factual and legal basis for our decision, and how
> you can object to it.

Don't widen the wording before the code lands — the gap is what Batch
C tightened.

### 5. CLAUDE.md cleanup

Remove the "DSA Art. 17 Statement-of-Reasons scope (revisit after
launch)" section in `CLAUDE.md` once this plan ships; the gap it
documents no longer exists.

## Tests

- **Unit** (server): mock the email transport. Assert
  `sendStatementOfReasons` called with the right args when admin posts
  `/enforce-removal` with a reason. Assert it is **not** called on
  the routine `DELETE` path.
- **Unit**: skip-paths — creator self-deleted, no-creator-on-record,
  SMTP throws — all leave the item soft-deleted and the activity row
  recorded with the right `sorSent` flag.
- **e2e** (`packages/e2e/tests/`): two-browser scenario. Admin in
  browser A clicks "Remove with notice" on browser B's task with reason
  "spam link". Browser B receives the SoR email (assert via the dev
  SMTP log capture the existing tests use). Reason text appears in the
  audit log.

## Out of scope (don't bundle)

- **Scratchpad SoR**: scratchpad is shared content with no per-edit
  attribution; an enforcement removal there is operator-manual via
  `UPDATE scratchpads SET content = ''`. Revisit if scratchpads ever
  grow per-edit history.
- **List / Space deletion SoR**: deleting a whole Space already cascades
  every member's content; treat as "Space deletion" notice rather than
  per-item SoR. Different runbook (`erasure-runbook.md`).
- **SoR for restoration**: if an admin restores an item that was
  enforcement-removed, no SoR is sent. The audit row updates with
  `restoredAt`.

## Acceptance

- [ ] `POST /items/:itemId/enforce-removal` lands, admin-only, sends
      SoR via SMTP, soft-deletes the item, records activity with full audit
      meta.
- [ ] Routine `DELETE /items/:itemId` unchanged in behaviour and tests.
- [ ] Web UI has admin-only "Remove with notice…" entry; routine delete
      still one-click for any member.
- [ ] Terms.tsx §8 broadened in a follow-up PR with `TOS_VERSION` bump.
- [ ] CLAUDE.md "DSA Art. 17 Statement-of-Reasons scope" section
      removed.
- [ ] `npm run typecheck && npm run lint && npm run test:e2e` green.
