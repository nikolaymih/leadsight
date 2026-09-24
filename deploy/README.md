# Deploying LeadSight

One Linux host with Docker (Compose v2). Everything runs from `deploy/compose.yml`:

| Service   | Image             | Role                                                         |
|-----------|-------------------|--------------------------------------------------------------|
| `db`      | postgres:17       | Data. Volume `pgdata`.                                       |
| `migrate` | leadsight-api     | One-shot `node dist/migrate.js`; applies committed migrations before the API starts. |
| `api`     | leadsight-api     | Fastify: Better Auth, oRPC, scheduler, email.                |
| `web`     | leadsight-web     | Next.js (standalone output).                                 |
| `caddy`   | caddy:2           | TLS + reverse proxy: `/api/*`, `/rpc/*`, `/healthz` → api; everything else → web. |

The site is **one origin** (`https://$DOMAIN`), so cookies are same-site and there is no
CORS to configure. The web image inlines `NEXT_PUBLIC_API_URL=https://$DOMAIN` at build
time; change the domain → rebuild the web image.

## First deploy

```bash
git clone <repo> leadsight && cd leadsight
cp deploy/.env.example deploy/.env       # fill in DOMAIN, POSTGRES_PASSWORD, BETTER_AUTH_SECRET, provider keys, SMTP
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yml logs -f migrate api
```

DNS for `$DOMAIN` must point at the host and ports 80/443 must be reachable for Caddy to
obtain a certificate. For a LAN-only install edit `deploy/Caddyfile` as described in its
header to disable TLS.

Then open `https://$DOMAIN/signup`, create the first user and organization (the creator is
its owner), and invite the rest under Settings → Organization.

## Updating

```bash
git pull
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
```

Compose rebuilds the images, runs `migrate` against the live database, and only replaces
the API/web containers when the migration succeeded. A failed migration leaves the previous
containers running; fix forward with a new migration (never edit an applied one).

## Operations

- **Logs**: `docker compose … logs -f api` (pino JSON; `LOG_LEVEL=debug` for more).
  Without `SMTP_URL`, every email (reset links, invitations, digests) appears here instead
  of being sent.
- **Health**: `https://$DOMAIN/healthz` → `{"ok":true,"db":"up"}`. The containers also
  carry Docker health checks, which is what `depends_on` waits on.
- **Backups**: `docker compose … exec db pg_dump -U leadsight leadsight | gzip > leadsight-$(date +%F).sql.gz`.
  Restore into an empty database with `psql`, then start the stack.
- **Scheduler**: runs inside the API (`SCHEDULER_CRON`, default every 5 minutes; each source
  has its own poll interval). Run exactly one API container; two would poll twice.
- **Pause everything**: `SCHEDULER_ENABLED=false` in `deploy/.env` and restart `api`.
- **Secrets** live only in `deploy/.env` (git-ignored). Rotating `BETTER_AUTH_SECRET`
  signs everyone out.

## Building images elsewhere (CI)

Both Dockerfiles use the repository root as build context:

```bash
docker build -f apps/api/Dockerfile -t leadsight-api .
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://leads.example.com -t leadsight-web .
```

Point `image:` in `compose.yml` at your registry tags and drop the `build:` blocks to deploy
prebuilt images.
