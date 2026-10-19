# infra

Deploy files for the Insider API (Hono + Drizzle + BullMQ on Node 22) on the
agents VM, plus the GCS media bucket. The web app's Firebase Hosting config
lives with the web app, not here.

| Path | What |
|---|---|
| `gcs/create-media-bucket.sh` | Creates the private media bucket (asia-south1, uniform access, public access prevention, lifecycle) and the signer service account. Run by a human |
| `gcs/lifecycle.json` | Bucket lifecycle: abort incomplete multipart uploads after 7 days, STANDARD to NEARLINE at 30 days, NEARLINE to COLDLINE at 180 days. Nothing is deleted |
| `systemd/insider-api.service` | `node dist/server.js` from `/opt/insider/services/api` |
| `systemd/insider-worker.service` | `node dist/worker.js` (pipeline jobs and schedules) from the same directory |
| `nginx/insider-api.conf` | Reverse proxy on :80 to `127.0.0.1:8000`, 32 MB body limit for ingest batches |

Both units read `/etc/insider/api.env`, run as user `insider`, and restart
always.

## One-time setup (a human runs these)

Nothing here has been run. Each step needs credentials or root access on a
real machine.

### 1. GCS media bucket

From a workstation with `gcloud` logged in as a project Owner:

```sh
PROJECT=<gcp-project-id> infra/gcs/create-media-bucket.sh
# optional: BUCKET=... LOCATION=... SA_NAME=...
```

The script is safe to re-run. At the end it prints the two ways to give the API
credentials: attach the service account to the VM (preferred, no key file), or
create a key file and set `GOOGLE_APPLICATION_CREDENTIALS`.

### 2. VM packages and user

```sh
# Node 22 at /usr/bin/node (NodeSource or distro package). If you use nvm/fnm,
# change ExecStart in both units to that absolute path.
node --version                    # v22.x
corepack enable                   # gives pnpm from packageManager in package.json
sudo apt-get install -y nginx redis-server
sudo useradd --system --create-home --home-dir /opt/insider --shell /usr/sbin/nologin insider
```

Redis must be reachable at `REDIS_URL`. Postgres is Supabase (schema
`market_intel`); no local database.

### 3. Code and environment

```sh
sudo -u insider git clone <repo-url> /opt/insider     # or rsync a release
sudo mkdir -p /etc/insider
sudo install -m 640 -o root -g insider /dev/null /etc/insider/api.env
sudoedit /etc/insider/api.env
```

`/etc/insider/api.env` (names from `services/api/src/config.ts` and `.env.example`):

```sh
NODE_ENV=production
PORT=8000
DATABASE_URL=postgres://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
REDIS_URL=redis://127.0.0.1:6379
QUEUE_INLINE=false
SENDER_HMAC_KEY=<long random string, same value the collectors use>
AUTH_DEV_BYPASS=false
GCS_MEDIA_BUCKET=<bucket from step 1>
GCP_PROJECT=<gcp-project-id>
CORS_ORIGINS=https://<web app origin>
# only when the VM is not on GCP (see step 1):
# GOOGLE_APPLICATION_CREDENTIALS=/etc/insider/gcs-key.json
```

Never set `AUTH_DEV_BYPASS=true` in production.

### 4. systemd and nginx

```sh
sudo cp /opt/insider/infra/systemd/insider-api.service /opt/insider/infra/systemd/insider-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable insider-api insider-worker      # started by the first deploy

sudo cp /opt/insider/infra/nginx/insider-api.conf /etc/nginx/sites-available/
sudo ln -s ../sites-available/insider-api.conf /etc/nginx/sites-enabled/
sudoedit /etc/nginx/sites-available/insider-api.conf  # set server_name
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <api host name>                # TLS
```

The API binds to `127.0.0.1:8000` by default (`HOST` in the env file), so
traffic only reaches it through Nginx. Keep port 8000 closed in the VM / GCP
firewall as a second layer.

## Deploy (every release)

```sh
cd /opt/insider
sudo -u insider git pull --ff-only                    # or unpack the release
sudo -u insider pnpm install --frozen-lockfile
sudo -u insider pnpm --filter @insider/api build
sudo -u insider sh -c 'set -a; . /etc/insider/api.env; set +a; pnpm --filter @insider/api db:migrate'
sudo systemctl restart insider-api insider-worker
curl -fsS http://127.0.0.1:8000/healthz && echo OK
```

Notes:

- `pnpm install` must include dev dependencies (do not set `NODE_ENV=production`
  in the shell that runs it): `db:migrate` runs through `tsx`, and `build` needs
  `typescript`.
- Migrations need `DATABASE_URL`, so the env file is loaded for that one
  command. `/etc/insider/api.env` is group-readable by `insider` for this.
- Run migrations before restarting the units, so new code never runs against an
  old schema.

## Operations

```sh
systemctl status insider-api insider-worker
journalctl -u insider-api -f
journalctl -u insider-worker -f
```

The worker gets 120 s on stop (`TimeoutStopSec`) to finish running jobs before
SIGKILL.
