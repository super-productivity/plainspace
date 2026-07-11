#!/bin/bash
# Print a quick production stats dashboard: projects, members (users), and
# recent activity. Reads the Postgres container directly via docker compose —
# the db exposes no host port, so this is the access path.
#
# Run from the repo root (next to docker-compose.yml), e.g. on the prod host:
#   cd /path/to/plainspace && ./scripts/stats.sh
#
# The "active" window defaults to 30 days; override with DAYS:
#   DAYS=7 ./scripts/stats.sh
#
# Note on "users": there is no global users table — a person is a `members`
# row per project, so the same human in N Spaces is N member rows. We also
# report distinct people deduped by the encrypted email blind-index
# (email_lookup); display-name-only members (NULL lookup) can't be deduped
# and so aren't counted in `unique_people`.

set -euo pipefail

DB_USER="${POSTGRES_USER:-spaces}"
DB_NAME="${POSTGRES_DB:-spaces}"
DAYS="${DAYS:-30}"

# DAYS feeds an interval below; keep it a plain positive integer.
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "DAYS must be a positive integer, got: $DAYS" >&2; exit 1; }

docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -v days="$DAYS" <<'SQL'
\echo
\echo '== Totals =='
SELECT
  (SELECT count(*) FROM projects)                                                   AS projects,
  (SELECT count(*) FROM members)                                                    AS member_rows,
  (SELECT count(*) FROM members WHERE email_verified)                               AS verified_members,
  (SELECT count(DISTINCT email_lookup) FROM members WHERE email_lookup IS NOT NULL) AS unique_people;

\echo 'Active in the last' :days 'days (from the activity log):'
SELECT
  count(DISTINCT project_id) AS active_projects,
  count(DISTINCT member_id)  AS active_members
FROM activity
WHERE created_at > now() - (:days * interval '1 day');

\echo
\echo '== Live sessions (currently signed in, one row per device) =='
-- Filter on expires_at so this matches what actually authenticates
-- (sessionForToken requires expires_at > now()). Counting every row would
-- include lapsed 7-day sessions the retention sweep hasn't purged yet, which
-- over-reports "signed in" — often above the active-member count.
SELECT
  count(*)                  AS sessions,
  count(DISTINCT member_id) AS members_signed_in
FROM member_tokens
WHERE expires_at > now();
SQL
