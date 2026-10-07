# Deploying VAULT

VAULT is a Next.js server app backed by PostgreSQL. Wherever it runs, it needs:

- **Node.js** 20.19+, 22.12+ or 24+ (Prisma 7's floor; 24 is what CI and the Docker image use)
- **PostgreSQL** 14+ (CI tests against 18)
- the environment variables below
- something that calls the two **scheduled job** endpoints (Vercel does this itself; elsewhere use the included GitHub Actions workflow, the compose `cron` service, or a crontab)

The quickest way through any of the paths below:

```bash
npm run setup                     # pick a target; writes the env file with fresh secrets
npm run check-env                 # validates .env (and tests the DB connection)
npm run check-env -- --env-file .env.production
```

`npm run setup -- --target <name> [--yes]` skips the menu. Targets: `local`, `docker`, `vercel`, `netlify`, `render`, `railway`, `fly`, `vps`, `github`. The script never commits, pushes or deploys by itself; whenever it would call a platform CLI (`vercel`, `netlify`, `railway`, `fly`, `gh`) it asks first.

## Environment variables

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/db?schema=public`. On serverless hosts use a **pooled** URL (Neon, Supabase pooler, Prisma Postgres); managed databases usually need `&sslmode=require`. |
| `DIRECT_URL` | no | Direct (non-pooled) connection string used only for migrations. Set it if `prisma migrate deploy` fails through the pooler; on Neon it's the connection string without `-pooler` in the host. |
| `JWT_SECRET` | yes | 32+ random characters; signs session cookies. The app refuses to start without it. `openssl rand -base64 48` |
| `CRON_SECRET` | for jobs | Bearer token for `/api/cron/*`. Without it scheduled payments, FX refresh, price updates and reminders don't run. `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | recommended | Public `https://` URL; used in reminder emails. |
| `TRUST_PROXY` | recommended | Where to read the client IP for rate limits: `vercel`, `netlify`, `cloudflare`, a hop count (`1` behind one reverse proxy, as on Render, Railway, Fly.io or a VPS with Caddy), or `none`. Auto-detected on Vercel and Netlify. See [Rate limiting](#rate-limiting). |
| `ALLOW_SIGNUP` | no | `false` closes self-service sign-up (add users with `npm run create-user`). Default `true`. |
| `DEV_USERNAME` / `DEV_PASSWORD` | no | Built-in developer/admin login. Leave either empty to disable it. |
| `DATABASE_POOL_MAX` | no | Connections per app instance (default 5). Keep it small on serverless. |

Session cookies are `Secure` in production, so a production build must be served over **HTTPS** (plain `http://localhost` also works, since browsers treat it as secure).

## Database migrations

Migrations live in `prisma/migrations` and are applied with `prisma migrate deploy` (idempotent; it only runs what's pending). Each target runs them automatically:

| Target | When migrations run |
|---|---|
| Vercel | `vercel-build` script: `prisma migrate deploy && next build` |
| Netlify | `netlify.toml` build command: `npm run build:deploy` |
| Render | start command (`render.yaml`) |
| Railway | pre-deploy command (`railway.json`) |
| Docker / Fly.io | container start (`Dockerfile` `CMD`) |
| VPS | `ExecStartPre` in `deploy/vps/vault.service` |
| Manual | `npm run db:deploy` |

On Vercel and Netlify, **preview deployments use the same build command**. If previews share the production `DATABASE_URL`, they will migrate it too. Give the Preview environment its own database (a Neon branch works well) or scope `DATABASE_URL` to Production only.

## Scheduled jobs

| Endpoint | Schedule (UTC) | Does |
|---|---|---|
| `GET /api/cron/market-update` | 03:30, 05:30, 07:30, 10:00 | stock prices and mutual fund NAVs |
| `GET /api/cron/daily` | 18:45 | due scheduled payments/income, FX rates, net-worth snapshots, reminder digests |

Both require `Authorization: Bearer $CRON_SECRET`.

- **Vercel**: `vercel.json` schedules them; nothing else to do.
- **Docker compose**: the `cron` service calls them.
- **VPS**: install `deploy/vps/vault-cron` into `/etc/cron.d/`.
- **Everywhere else** (Netlify, Render, Railway, Fly.io): enable `.github/workflows/scheduled-jobs.yml` by adding the repository secrets `VAULT_URL` and `CRON_SECRET` (`npm run setup -- --target github` can set them with the `gh` CLI). GitHub may delay scheduled runs by a few minutes at busy times; a missed daily run is caught up the next day, because `runDueSchedules` processes everything that has become due.

You can trigger a job by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/daily`, or *Actions → Scheduled jobs → Run workflow*.

## Health check

`GET /api/health` returns `200 {"status":"ok"}` when the app can reach the database, `503` otherwise. The Docker image, Render, Railway and Fly configs use it.

---

## Local development

```bash
npm install
npm run setup -- --target local     # writes .env, starts the embedded Postgres, migrates
npm run dev                         # http://localhost:3000
```

`npm run dev` starts a zero-config embedded Postgres (`scripts/dev-db.mjs`, data in `.vault-data/`). To use your own Postgres instead, answer "no" to the embedded-database question and give a `DATABASE_URL`.

## Docker (any server, or locally)

```bash
npm run setup -- --target docker    # writes .env.docker (DB password, JWT/CRON secrets)
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker logs -f app
```

This runs Postgres 18 (data in the `vault-db` volume), the app on port `APP_PORT` (default 3000), and a small `cron` container for the scheduled jobs. The app applies migrations each time it starts.

For a public server, put a TLS reverse proxy in front (the Caddy config in `deploy/vps/Caddyfile` works; point it at the published port) and set `TRUST_PROXY=1` in `.env.docker`.

To run only the image against an existing database:

```bash
docker build -t vault .
docker run -d -p 3000:3000 --env-file .env.production vault
```

## Vercel

1. Create a Postgres database with a pooled connection string (Neon, Supabase, Prisma Postgres, or one from the Vercel Marketplace).
2. `npm run setup -- --target vercel`: writes `.env.production` for reference and, if the `vercel` CLI is installed, can push the variables and deploy.
3. Without the CLI: import the GitHub repo at <https://vercel.com/new> and add each variable from `.env.production` under *Settings → Environment Variables* (Production).
4. Deploy, then open `https://<app>/api/health`.

The `vercel-build` script migrates before building, and `vercel.json` schedules the jobs. `TRUST_PROXY` is detected automatically.

## Netlify

1. Create a pooled Postgres database (Neon has a Netlify integration).
2. `npm run setup -- --target netlify`, then import the repo in Netlify and add the variables from `.env.production` (or let the script push them with the `netlify` CLI).
   At minimum the build needs `DATABASE_URL` and `JWT_SECRET`; without them it stops with a list of what's missing. Add `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` (your `https://<site>.netlify.app` address) and `DIRECT_URL` (if migrations fail through the pooler) as well.
3. `netlify.toml` sets the build command (`npm run build:deploy`) and Node 24; Netlify's Next.js runtime is picked up automatically.
4. Enable the scheduled-jobs workflow (see above).

## Render

1. Push the repo to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` creates a Postgres database and the web service, generates `JWT_SECRET` and `CRON_SECRET`, and wires `DATABASE_URL`.
3. Fill `NEXT_PUBLIC_APP_URL` (and the optional developer login) when prompted.
4. Copy `CRON_SECRET` from the service's *Environment* tab into the scheduled-jobs workflow secrets.

The Blueprint uses free plans, which sleep when idle and whose database expires after 30 days. Switch both to paid plans before storing real data.

## Railway

1. `npm run setup -- --target railway` (with the `railway` CLI it can create the project, database and variables), or by hand:
2. Railway → **New Project → Deploy from GitHub repo**, then **+ New → Database → PostgreSQL**.
3. On the app service, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` and add the other keys from `.env.production`.
4. *Settings → Networking → Generate Domain*, then enable the scheduled-jobs workflow.

`railway.json` runs migrations as the pre-deploy step and uses `/api/health` as the health check.

## Fly.io

```bash
npm run setup -- --target fly       # sets the app name/region in fly.toml, writes .env.production
fly apps create <app>
fly secrets set --app <app> $(grep -v '^#' .env.production | grep -v '^TRUST_PROXY' | xargs)
fly deploy
```

Use Fly Managed Postgres (`fly mpg create`) or any external Postgres for `DATABASE_URL`. Fly builds the `Dockerfile`; the container migrates on start. Enable the scheduled-jobs workflow afterwards.

## Your own Linux server (VPS)

`npm run setup -- --target vps` prints the full command sequence with your domain and secrets filled in. In outline:

1. Install Node 24, Postgres and Caddy; create a `vault` database and user.
2. Clone the repo to `/opt/vault`, copy `.env.production` there, run `npm ci && npm run build`.
3. Install `deploy/vps/vault.service` (systemd; migrates on start, listens on 127.0.0.1:3000).
4. Install `deploy/vps/Caddyfile` with your domain. Caddy fetches the HTTPS certificate.
5. Install `deploy/vps/vault-cron` into `/etc/cron.d/vault` with your `CRON_SECRET`.

To update: `git pull && npm ci && npm run build && sudo systemctl restart vault`.

## GitHub

GitHub hosts the code, CI and the job scheduler. It can't host the app itself: GitHub Pages serves static files only, and VAULT needs a Node server and a database.

```bash
npm run setup -- --target github    # git init, checks nothing private would be committed
git add -A && git status
git commit -m "Initial commit"
gh repo create <name> --private --source . --push
```

`.github/workflows/ci.yml` runs migrations against a throwaway Postgres, then typecheck, lint, tests and a production build on every push and pull request.

---

## Rate limiting

Auth endpoints (login, sign-up, recovery, password reset) are rate limited per account and per client IP. The IP comes only from a source named by `TRUST_PROXY`, because a header like `X-Forwarded-For` can be set to anything by the caller unless your own proxy overwrites it:

- `vercel` / `netlify` / `cloudflare`: the platform's own client-IP header.
- `N` (a number): the N-th address from the right of `X-Forwarded-For`, i.e. the one your outermost proxy appended. Addresses a client prepends are ignored.
- `none`: no IP is trusted and every caller shares one bucket. That's strict but can't be bypassed; per-account limits still apply.

The limiter is in memory, so limits are per instance and reset on restart. On multi-instance deployments this is a soft limit; a shared store (Upstash Redis, Vercel KV) is the upgrade path (`src/lib/rate-limit.ts`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `JWT_SECRET is missing or too short` at start | Set a 32+ character `JWT_SECRET`. |
| Sign-in works locally but not on the server | The site must be served over HTTPS (session cookies are `Secure` in production). |
| `P1001: Can't reach database server` | Check `DATABASE_URL`, network access/allow-list, and `sslmode=require` for managed databases. `npm run check-env -- --env-file .env.production` tests the connection. |
| Too many connections (serverless) | Use the provider's pooled URL and keep `DATABASE_POOL_MAX` at 5 or lower. |
| Everyone gets "Too many sign-in attempts" | `TRUST_PROXY` is unset or wrong for your host, so all callers share a bucket. Set it (see above). |
| Scheduled payments never post | `CRON_SECRET` is unset, or nothing calls `/api/cron/daily`. Trigger it by hand to check. |
