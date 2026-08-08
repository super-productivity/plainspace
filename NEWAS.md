# Plainspace Fork (Newas) — SP integration unassign/delete

Adds PAT integration endpoints used by the Super Productivity Newas fork:

- `POST /api/integration/tasks/:taskId/unassign` — clear caller assignment (claim pool)
- `DELETE /api/integration/tasks/:taskId` — soft-delete when assigned to caller

See also: `/home/yuna/git/super-productivity-fork` (`NEWAS.md`).

Forgejo: https://forgejo.fsociety00.cc/yuna/plainspace-fork

Branch: `newas/integration-unassign-delete`
