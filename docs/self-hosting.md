# Self-hosting

Run your own Plainspace with Docker. The app runs as one container (Hono
server + the prebuilt SolidJS SPA) with Postgres in a sibling container. A
reverse proxy of your choice terminates TLS and forwards traffic to the app
port.

```
[ browser ] --HTTPS--> [ reverse proxy (TLS + domain) ] --HTTP--> [ 127.0.0.1:3000 ]
                                                                        |
                                                                        v
                                                               [ app (Hono) ] -- [ postgres ]
```

## 1. Prerequisites

- A Linux host with [Docker Engine](https://docs.docker.com/engine/install/)
  and the compose plugin (`docker compose version`), plus `git` and
  `openssl`. Run the stack as a regular user in the `docker` group, not as
  root.
- A domain with an A (and AAAA if you have IPv6) record pointing at the host
  that will terminate TLS. Let's Encrypt won't issue a certificate until DNS
  resolves to the box serving the challenge. Verify with
  `dig +short plainspace.example.com`.
- An SMTP mailbox the app can send from (invitations, verification, and
  contact email). Any provider or self-hosted mail server works.

## 2. Get the code

```sh
git clone https://github.com/super-productivity/plainspace.git
cd plainspace
```

The checkout provides `docker-compose.yml`, the env template, and the
backup/deploy scripts. The app image itself is prebuilt and pulled from
GHCR (§4) — you don't need Node.js on the server.

## 3. Configure environment

```sh
cp .env.production.example .env
chmod 600 .env
$EDITOR .env
```

Required values:

- `APP_URL` — public HTTPS URL your users see (e.g.
  `https://plainspace.example.com`). All email/integration/share links are
  built from this; the app does not derive the scheme from request headers,
  so include `https://`.
- `POSTGRES_PASSWORD` — strong password for the bundled Postgres. It is
  embedded directly into `DATABASE_URL`, so **avoid characters that need
  URL-encoding**: `@ : / # ? % &`. Letters, digits, and `- _ .` are safe.
  Generate one with `openssl rand -base64 24 | tr -d '/+='`.
- `PLAINSPACE_EMAIL_ENC_KEY` + `PLAINSPACE_EMAIL_INDEX_KEY` —
  application-layer encryption keys for the `members.email` column and all
  email-bearing verification/token tables. Generate **on the server** (avoid
  laptop disk + shell history) and the two **must differ**:
  ```sh
  openssl rand -base64 32   # PLAINSPACE_EMAIL_ENC_KEY
  openssl rand -base64 32   # PLAINSPACE_EMAIL_INDEX_KEY
  ```
  The server refuses to start in production without both. **Losing both
  keys = total PII loss for every encrypted-email row.** Escrow each key in
  two off-host locations (password manager + sealed envelope) before the
  first user signs up.
- `SMTP_*` / `FROM_EMAIL` / `CONTACT_EMAIL` — your mail server or provider
  (§6). In production `SMTP_HOST` is required so contact and verification
  email can be delivered.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web Push
  credentials; `docker-compose.yml` refuses to start without all three.
  Generate once:
  ```sh
  npx --yes web-push generate-vapid-keys
  ```
  Set `VAPID_SUBJECT=mailto:hello@plainspace.example.com` (any reachable
  `mailto:` URL a push service can contact you at). **Rotation is
  destructive:** changing the keys forces every `push_subscriptions` row to
  re-register on the user's next visit. Escrow alongside the email keys.

`APP_PORT` defaults to `3000` and `APP_BIND` defaults to `127.0.0.1` — only
a reverse proxy on the same host can reach the container. If your proxy
runs on a different host, see the note at the end of §5.

## 4. Pull and run

The host does not build the image. CI builds it on every push to `main` and
publishes it to GHCR (`ghcr.io/super-productivity/plainspace-app`, public —
no `docker login` needed). First start:

```sh
docker compose pull
docker compose up -d --no-build
```

The entrypoint runs Drizzle migrations against the bundled Postgres on
every start, then launches the server. Check status:

```sh
docker compose ps
docker compose logs -f app
curl http://127.0.0.1:3000/health
```

Updating later:

```sh
npm run deploy   # scripts/deploy.sh: git pull --ff-only → pre-deploy backup →
                 # tag previous image as plainspace-app:rollback → pull the
                 # GHCR image for the checked-out commit (aborts if CI hasn't
                 # published it yet) → compose up -d --no-build → wait for the
                 # container HEALTHCHECK → docker image prune -f
```

(Or by hand: `git pull && docker compose pull && docker compose up -d
--no-build` — but then you're skipping the pre-update backup, rollback tag,
and health gate the script provides. `deploy.sh` needs the backup setup
from §7 first.)

The script fails loudly (exit 1 with a rollback recipe) when the app
doesn't reach `healthy` within ~3 minutes: `docker compose up -d` alone
returns before the entrypoint runs migrations, so a failed migration would
otherwise crash-loop while the update looked green. The
`plainspace-app:rollback` tag keeps the previous image available — tagged
images are never dangling, so the prune can't remove it.

> **Why pull a prebuilt image instead of building on the host?**
> Reproducibility (the exact image CI tested is what runs), no build
> toolchain on the server, and some virtualized hosts (e.g.
> OpenVZ/Virtuozzo containers) can't run BuildKit at all. If you prefer to
> build your own image, `docker compose build` works on any normal
> Docker host; CI's `docker-smoke` job shows the env needed to boot it.

> **Every scripted deploy takes a backup first** (`scripts/deploy.sh` runs
> `./scripts/backup.sh` automatically; see §7). Migrations run at startup
> and Drizzle has no rollback — the pre-deploy dump is the way back if one
> goes wrong (§8, "If migrations fail at startup").

> **Run exactly one `app` container.** The in-memory SSE connection
> registry, the in-memory rate limiter, and the reminder sweep's crash
> recovery all assume a single Node process. With replicas, clients
> connected to one process miss events broadcast by the other, rate limits
> multiply per process, and the sweep can re-arm rows another process is
> mid-delivery on. Scale vertically instead (see
> `docs/scaling-decision.md`).

## 5. Reverse proxy

Your proxy owns the domain, the TLS certificate, and inbound port 443, and
forwards everything for the domain to the app port. Two things are
non-negotiable for any proxy:

- **Don't buffer responses** — the app uses Server-Sent Events
  (`/api/projects/<slug>/events`) for live updates; buffering breaks them.
  (No WebSocket headers needed — it's SSE, not WebSocket.)
- **Send exactly one `X-Forwarded-For` value** — the app trusts one proxy
  hop and reads the **last** XFF value for rate limiting. Overwrite the
  header with the client address; don't append to whatever the client sent.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name plainspace.example.com;

    # ssl_certificate ...; ssl_certificate_key ...;  (e.g. via certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;                     # nginx defaults to 1.0 upstream, which kills SSE keep-alive
        proxy_set_header Connection "";             # clear hop-by-hop "close" so the SSE stream isn't torn down per chunk
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Overwrite, do not append. The app trusts exactly one upstream hop
        # and reads the *last* X-Forwarded-For value; appending
        # ($proxy_add_x_forwarded_for) lets a malicious client place a
        # spoofed IP at position 0.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: proxy_buffering off is the critical setting.
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;

        # Baseline security headers. Note: once a location block has any
        # add_header, nginx stops inheriting server-level headers — repeat
        # them all here.
        add_header Strict-Transport-Security "max-age=15768000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
        # CSP: the app loads only /assets/*.js from self, no third-party
        # CDN. Inline styles are needed (Vite emits some; the SPA sets CSS
        # custom properties); inline scripts are not.
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
    }
}
```

### Caddy

Caddy issues and renews the TLS certificate automatically and its default
`X-Forwarded-For` handling (append) is safe here because the app reads the
last value:

```caddyfile
plainspace.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1   # stream SSE immediately, no buffering
    }
    header {
        Strict-Transport-Security "max-age=15768000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
}
```

Sanity check once the proxy is live: `https://plainspace.example.com/health`
should return `{"status":"ok"}` with a valid certificate.

> **Proxy on a different host?** Set `APP_BIND` in `.env` to the docker
> host's LAN IP (preferred), or to `0.0.0.0` **with a firewall rule in
> place first** — otherwise port 3000 is briefly public. Then point the
> proxy at `http://<docker-host>:3000` and verify the port is unreachable
> from anywhere else.

## 6. Email

The app sends over SMTP (nodemailer). Point `.env` at any mailbox you
control:

- `SMTP_HOST` — your mail server or provider hostname (must match its TLS
  cert)
- `SMTP_PORT=587` with `SMTP_SECURE=false` — STARTTLS. Use `SMTP_PORT=465`
  with `SMTP_SECURE=true` for implicit TLS (some networks block outbound
  587; 465 is the usual fallback).
- `SMTP_USER` / `SMTP_PASS` — mailbox credentials
- `FROM_EMAIL` — the sender address users see
- `CONTACT_EMAIL` — where the contact form delivers

Apply with `docker compose up -d app`, then trigger an outbound email (the
contact form at `/contact` works) and watch `docker compose logs -f app`.
Test the SMTP endpoint independently if mail seems to vanish:

```sh
openssl s_client -starttls smtp -connect mail.example.com:587 -crlf
```

**Deliverability:** publish SPF, DKIM, and DMARC records for the sending
domain or the app's mail will land in spam. Verify by sending a test email
to `check-auth@verifier.port25.com` or via `mail-tester.com`.

## 7. Backups & restore

One stateful piece on the host: the Postgres volume
`plainspace_postgres_data`. (Attachments are disabled in code; see
`CLAUDE.md`.)

### Backup

`scripts/backup.sh` wraps the Postgres dump with a timestamp, GPG
encryption (AES-256, symmetric), a self-test that decrypts the just-written
dump and runs `pg_restore --list` against it, and a retention sweep.

One-time setup — the script refuses to run without the passphrase file
(replace `<user>` with the docker-group user that runs the cron):

```sh
sudo install -d -m 0750 -o root -g <user> /etc/plainspace/secrets
sudo sh -c 'umask 077; openssl rand -base64 32 > /etc/plainspace/secrets/backup_passphrase'
sudo chown root:<user> /etc/plainspace/secrets/backup_passphrase
sudo chmod 0440 /etc/plainspace/secrets/backup_passphrase
# ALSO escrow the passphrase off-host (password manager + sealed envelope).
# Losing the passphrase = backups are unreadable forever.
```

On Debian 12 (GnuPG 2.2) also enable loopback pinentry once:

```sh
install -d -m 0700 ~/.gnupg
grep -qxF allow-loopback-pinentry ~/.gnupg/gpg-agent.conf 2>/dev/null \
  || echo allow-loopback-pinentry >> ~/.gnupg/gpg-agent.conf
gpgconf --kill gpg-agent || true
```

Run from the repo root:

```sh
./scripts/backup.sh
# writes ./backups/pg-YYYY-MM-DD-HHMMSS.dump.gpg, self-tests it, prunes
# archives older than RETAIN_DAYS (default 30)
```

Tunables: `BACKUP_DIR`, `RETAIN_DAYS`, `BACKUP_PASSPHRASE_FILE`. Schedule
it in the crontab of the same non-root user (create the log file first —
the user can't create files under `/var/log`):

```sh
sudo install -m 0640 -o <user> -g <user> /dev/null /var/log/plainspace-backup.log
```

```cron
0 3 * * *  cd /path/to/plainspace && ./scripts/backup.sh >>/var/log/plainspace-backup.log 2>&1
```

Ship the encrypted archives off-server (rclone to S3/B2, rsync to another
host, …) — local-only backups don't survive disk loss. The archives are
AES-256 ciphertext, safe to transit over plain SFTP.

### Restore

```sh
# decrypt and restore the custom-format dump into a running db:
gpg --batch --pinentry-mode loopback \
    --passphrase-file /etc/plainspace/secrets/backup_passphrase \
    --decrypt pg-2026-05-01.dump.gpg \
  | docker compose exec -T db pg_restore --clean --if-exists --no-owner --no-privileges \
      -U "${POSTGRES_USER:-spaces}" -d "${POSTGRES_DB:-spaces}"
```

On a fresh host: bring the stack up once so the database exists, then run
the pipeline above.

## 8. Common operations

```sh
# tail logs
docker compose logs -f app

# restart just the app (e.g. after env edits)
docker compose up -d app

# open a psql shell
docker compose exec db psql -U "${POSTGRES_USER:-spaces}" "${POSTGRES_DB:-spaces}"
```

### If migrations fail at startup

The container exit-loops because the entrypoint runs `migrate.ts` before
`index.ts`. To inspect without auto-restart:

```sh
docker compose run --rm --entrypoint sh app
# inside the container:
/app/node_modules/.bin/tsx packages/server/src/db/migrate.ts
```

Drizzle has no automatic rollback. Recovery options, in order of
preference:

1. Fix the migration SQL in `packages/server/drizzle/`, redeploy.
2. If a migration partially applied: connect with `psql`, reverse the
   partial state manually, then re-run.
3. Restore the pre-deploy backup (§7), check out the previous release, and
   start the old image so the old code runs against the old schema. Data
   written between the dump and the restore is lost.
4. Total wedge on a fresh-ish install: `docker compose down`, delete the
   volume (`docker volume rm plainspace_postgres_data`), `docker compose
up -d`. **This deletes all data.**

## 9. Replace the legal pages

The routes under `packages/web/src/routes/` — `Terms.tsx`, `Privacy.tsx`,
`Impressum.tsx`, `Subprocessors.tsx`, and `DsaNotice.tsx` — contain the
**hosted plainspace.org instance's** legal documents, including its
operator's identity. If you host Plainspace for anyone beyond yourself,
**replace their contents with your own operator details and terms** before
going live; serving someone else's legal identity is wrong for you and for
your users. What you need in them depends on your jurisdiction (e.g.
Impressum/provider identification, privacy policy, terms).

## Acceptance checklist

You're done when all of these pass:

- [ ] `curl -fsS https://plainspace.example.com/health` returns
      `{"status":"ok"}` — TLS valid, no warnings.
- [ ] `docker compose ps` shows both `app` and `db` healthy.
- [ ] Opening the domain in a browser loads the app. There's no admin
      bootstrap step — the first visitor creates a Space and becomes its
      creator, then invites others.
- [ ] A test email lands in your inbox (contact form at `/contact` or the
      signup verification flow) and SPF + DKIM pass (`mail-tester.com`).
- [ ] `./scripts/backup.sh` produces a non-empty
      `pg-….dump.gpg` in `./backups/` and its self-test passes.
- [ ] An off-site copy of those archives exists.
- [ ] An external uptime monitor watches `/health`.
- [ ] Legal pages replaced with your own (§9).

## Notes

- The server reads `X-Forwarded-For` only when `TRUST_PROXY=1` (default in
  the compose file) so rate limits use real client IPs.
- The `db` service publishes no host port — only the app reaches it via the
  compose network.
- Container logs are capped at 10 MB × 5 files per service; `docker image
prune -f` after updates avoids accumulating old layers (the previous
  image survives via the `plainspace-app:rollback` tag).
- All URL generation reads `APP_URL`; the app never sniffs `Host` /
  `X-Forwarded-Proto`. Set it to the exact public origin including scheme.
