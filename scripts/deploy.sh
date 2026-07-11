#!/bin/bash
# Deploy the current checkout on the production box (invoked via `npm run deploy`).
# Safety nets on top of a bare `docker compose pull && up -d`: pre-deploy
# backup, a rollback image tag, a post-deploy health gate, and a prune that
# can't delete the rollback image. Why each exists: docs/self-hosting.md §4/§8.
# The host never builds — CI publishes the image to GHCR and this script
# pulls it (some hosts can't run BuildKit at all; see docs/self-hosting.md §4).
set -euo pipefail

cd "$(dirname "$0")/.."

git pull --ff-only

# Unconditional: the backup is the only way back from a bad migration
# (Drizzle has no rollback). If the db isn't running, backup.sh fails and the
# deploy aborts — a first-ever deploy goes through `docker compose up`
# directly per docs/self-hosting.md §4, not this script.
./scripts/backup.sh

# Tag the current image as the rollback handle BEFORE the pull below retags
# :latest onto the new image. A tagged image is never dangling, so the prune
# below can't remove it regardless of its age.
prev_id="$(docker compose images -q app 2>/dev/null | head -n1 || true)"
if [ -n "$prev_id" ]; then
  docker tag "$prev_id" plainspace-app:rollback
fi

# Pull the image CI built for THIS commit — not the mutable :latest. git pull
# above already advanced the checkout, but CI only moves :latest minutes later
# (and never if that commit's CI is red), so pulling :latest could silently
# ship a stale image while the deploy looks green. Pinning to the commit sha
# means an unpublished/red commit fails here (set -e) instead. Then retag it
# to the :latest ref the compose file uses and recreate without invoking a
# builder: --no-build makes a missing image a hard error, not an in-place
# build (which dies on hosts that can't run BuildKit). The GHCR package is
# public, so no `docker login` is needed to pull.
image="ghcr.io/super-productivity/plainspace-app"
sha="$(git rev-parse HEAD)"
docker pull "$image:$sha"
docker tag "$image:$sha" "$image:latest"
docker compose up -d --no-build

# Health gate: poll the image's built-in HEALTHCHECK (wget /health) instead
# of guessing the published port from .env. `compose up -d --wait` would do
# this in one flag but needs Compose v2.20+, which the deliberately-frozen
# prod Docker may predate. The entrypoint runs migrations before serving, so
# allow a couple of minutes.
echo "==> Waiting for app to become healthy"
app_id="$(docker compose ps -q app)"
status=unknown
for _ in $(seq 1 36); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$app_id" 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then
    echo "==> Deploy healthy"
    docker image prune -f
    exit 0
  fi
  sleep 5
done

echo "ERROR: app is '$status', not healthy — the old container is gone and this deploy is NOT serving." >&2
echo "       Inspect with: docker compose logs --tail=100 app" >&2
echo "       Roll back to the previous image (no rebuild, survives the broken checkout):" >&2
echo "         docker tag plainspace-app:rollback \$(docker inspect -f '{{.Config.Image}}' \"$app_id\")" >&2
echo "         docker compose up -d --no-build app" >&2
echo "       Then restore the pre-deploy dump if the failed migration wrote anything (docs/self-hosting.md §7, Restore)." >&2
exit 1
