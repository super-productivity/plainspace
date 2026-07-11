#!/bin/bash
# Backup Postgres + uploads to $BACKUP_DIR (default ./backups), encrypted with
# GPG (AES-256, symmetric). Retains the last $RETAIN_DAYS (default 30).
#
# One-time host setup. The passphrase must be readable by the non-root,
# docker-group user that runs this script via cron — do NOT make it 0400
# root:root or the cron can't read it (replace <user> with that user):
#   sudo install -d -m 0750 -o root -g <user> /etc/plainspace/secrets
#   sudo sh -c 'umask 077; openssl rand -base64 32 > /etc/plainspace/secrets/backup_passphrase'
#   sudo chown root:<user> /etc/plainspace/secrets/backup_passphrase
#   sudo chmod 0440 /etc/plainspace/secrets/backup_passphrase
#   # ALSO escrow the passphrase off-host (password manager + sealed envelope).
#   # Losing the passphrase = backups are unreadable forever.
#
# GnuPG <= 2.3 also needs loopback-pinentry enabled once per user that runs
# the script (Debian 12 ships 2.2). Ubuntu 24.04 ships 2.4 where this is
# default. Harmless either way:
#   install -d -m 0700 ~/.gnupg
#   grep -qxF allow-loopback-pinentry ~/.gnupg/gpg-agent.conf 2>/dev/null \
#     || echo allow-loopback-pinentry >> ~/.gnupg/gpg-agent.conf
#   gpgconf --kill gpg-agent || true
#
# Run from the repo root (next to docker-compose.yml). Schedule via cron:
#   0 3 * * *  cd /path/to/plainspace && ./scripts/backup.sh >>/var/log/plainspace-backup.log 2>&1

# pipefail is required so a failing `pg_dump | gpg` fails the script even
# when gpg's exit is 0; otherwise a broken dump would silently produce an
# encrypted empty stream.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
DB_USER="${POSTGRES_USER:-spaces}"
DB_NAME="${POSTGRES_DB:-spaces}"
# Timestamp (not just date): deploy.sh backs up on every deploy, and a
# same-day retry after a failed migration must not overwrite the good
# pre-failure dump with the damaged database.
DATE="$(date +%F-%H%M%S)"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/etc/plainspace/secrets/backup_passphrase}"

if [[ ! -r "$PASSPHRASE_FILE" ]]; then
  echo "ERROR: passphrase file not readable: $PASSPHRASE_FILE" >&2
  echo "       See script header for one-time setup." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

PG_OUT="$BACKUP_DIR/pg-$DATE.dump.gpg"
echo "==> Dumping postgres -> $PG_OUT"
# pg_dump --format=custom is already compressed and pg_restore-readable.
docker compose exec -T db pg_dump --format=custom -U "$DB_USER" "$DB_NAME" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --pinentry-mode loopback \
        --passphrase-file "$PASSPHRASE_FILE" \
        -o "$PG_OUT"

# Attachments are disabled (see project CLAUDE.md) — no object storage in
# use, so Postgres is the only data store this script needs to cover. If
# attachments come back on S3-compatible storage, bucket versioning + object
# lock is the planned backup mechanism for that data class.

echo "==> Self-test: decrypt + pg_restore --list $PG_OUT"
# Round-trips the encrypted blob: catches corrupted dumps, wrong-passphrase
# regressions, and pg_restore-incompatible format drift. Runs pg_restore
# inside the db container so the host doesn't need postgresql-client.
gpg --batch --quiet --pinentry-mode loopback \
    --passphrase-file "$PASSPHRASE_FILE" \
    --decrypt "$PG_OUT" \
  | docker compose exec -T db pg_restore --list >/dev/null

echo "==> Verifying backup size"
ls -lh "$PG_OUT"
# Sanity floor: a successful encrypted custom-format pg_dump of an empty
# schema is already several hundred bytes.
test "$(stat -c%s "$PG_OUT" 2>/dev/null || stat -f%z "$PG_OUT")" -gt 200

echo "==> Pruning backups older than $RETAIN_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'pg-*.dump.gpg' -o -name 'pg-*.sql.gz' \) \
  -mtime "+$RETAIN_DAYS" -print -delete

echo "==> Done"
