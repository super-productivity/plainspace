# UX Improvements Design

## Overview

Six improvements to the Spaces UI: signup gate, invite link, wider layout, member assignment picker, per-list kanban with custom columns.

---

## 1. Signup Gate (Email Magic Link)

**Goal:** Creating a project or list requires a verified email. Joining via link does not.

### Flows

**Project creation:**

1. User enters email on the home screen → server sends magic link
2. User clicks link → lands on "Create your Space" form with email session active
3. Fills in project name, purpose, display name → project created, user is admin with verified email

**List creation (member without verified email):**

1. Member clicks "New List"
2. Inline prompt: _"Creating lists requires a verified email."_
3. Member enters email → magic link sent → clicks link → redirected back → list created

**Joining (unchanged):**

- Anyone with the join link enters a display name only — no email required
- Joined-only members can view, add/complete items, assign tasks
- They cannot create lists until they verify email

### Backend

Extend the existing `auth/request-verification` + `auth/verify` endpoints to issue an authenticated session on link click (not just flag the member as verified). The verified email is stored on the member record.

Gate `POST /api/projects` and `POST /api/projects/:slug/lists` behind email verification.

---

## 2. Invite Others (Share Link)

**Goal:** Sharing the join URL is the invite mechanism. Make it immediately visible.

### UI

- **Persistent "Invite" button in the header** — sits next to member avatars, always visible
- One click copies the join URL (`{origin}/{slug}/join`) to clipboard
- Button briefly shows "Copied!" confirmation
- **Empty state card** — when only 1 member exists, the members area shows the join URL inline with a copy button (no click to open required)
- Members panel still shows the link for reference; private projects show a "Reset link" option to regenerate the slug

### Backend

No changes — the join URL already works.

---

## 3. Wider Layout

**Goal:** More horizontal breathing room, especially for the board view.

- Increase `max-width` in `Shell.module.css` from `640px` to `960px`
- Increase board column width from `280px` to `~320px` to use the extra space
- No layout restructuring — single column shell is sufficient

---

## 4. Assign Any Member via "@"

**Goal:** The `@` button on an item opens a member picker, not just a self-assign toggle.

### UI

- Clicking `@` on an item opens a small popover listing all project members
- Each row: avatar chip + display name + checkmark if currently assigned
- Clicking a member assigns them; clicking the assigned member unassigns
- Click outside closes the popover
- The button reflects the assigned member's avatar/color when assigned, `@` when nobody is

### Backend

`PATCH /api/projects/:slug/items/:id` already accepts `assignedTo`. No schema changes — the frontend just passes any member's ID instead of only `myId`.

The full member list is already in the project store; `ListItem.tsx` reads it from there.

---

## 5. Per-List Kanban with Custom Columns

**Goal:** Each list can be viewed as its own kanban board. Default columns are Todo / In Progress / Done. Admins can define custom columns.

### Data Model

**`lists` table:** Add `columns` (jsonb, nullable).

- When null, default columns apply: `[{id:"todo",name:"Todo"},{id:"in_progress",name:"In Progress"},{id:"done",name:"Done"}]`
- Custom columns: ordered array of `{id: string, name: string}`

**`items` table:** Add `column_id` (varchar, default `'todo'`).

- Migration: `checked=false` → `column_id='todo'`, `checked=true` → `column_id='done'`
- `checked` and `column_id='done'` stay in sync — checking an item moves it to Done and vice versa

### UI

- Each `ListCard` gets its own List/Board toggle (global toggle removed)
- Board mode: items grouped into horizontal columns by `column_id`, drag between columns updates `column_id`
- **Custom columns (admin only):** "Manage columns" in the list overflow menu opens an editor — add, rename, reorder (drag), delete (items in deleted column move to Todo)
- Saving column config: `PATCH /api/projects/:slug/lists/:id` with `columns` array

### Backend Changes

- Add `columns` (jsonb, nullable) to `lists` table — new Drizzle migration
- Add `column_id` (varchar, default `'todo'`) to `items` table — new Drizzle migration
- Extend `PATCH /items/:id` to accept `columnId`
- Extend `PATCH /lists/:id` to accept `columns`

---

## Summary

| #   | Change                                         | Effort  |
| --- | ---------------------------------------------- | ------- |
| 1   | Email magic link gates project + list creation | Medium  |
| 2   | Always-visible Invite button in header         | Small   |
| 3   | Widen layout to 960px                          | Trivial |
| 4   | "@" opens member picker popover                | Small   |
| 5   | Per-list kanban with custom columns            | Large   |
