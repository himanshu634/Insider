# Insider — Scaffolding Plan (monorepo)

Source: the "Insider — Scaffolding Plan" doc (2026-10-19). This version is changed in one way: **everything lives in the `insider` monorepo**, the backend included. The original plan put the Django schema and the FastAPI/Celery code into the existing Bull Connect and agents-service repos. Django is still the only owner of the database schema.

## 1. What we are building

| Piece | Role | Stack |
|---|---|---|
| macOS collector | Copies WhatsApp Desktop's local SQLite database (read-only), takes new messages from 10–15 watched groups and uploads them through a local outbox | Swift 6, SwiftUI `MenuBarExtra`, GRDB, `SMAppService`, URLSession |
| Backend: schema | Owns every table and migration | Django (`market_intel` app), Supabase Postgres |
| Backend: API + pipeline | Ingest and read APIs; Celery chain: dedupe → classify → extract → normalize → validate → store; scheduled jobs | FastAPI, Pydantic v2, SQLAlchemy/asyncpg, Celery + Redis, LLM structured output (Gemini now, Claude as an option), Pillow |
| Media | Images and PDFs of rate sheets | GCS bucket in asia-south1, signed URLs |
| Web app | Daily brief, price board, trends, spreads, feed, review queue, settings | SvelteKit (Svelte 5 runes), TypeScript, Tailwind, TanStack Query, ECharts or LayerChart, openapi-typescript/openapi-fetch |
| Contracts | OpenAPI spec is the source of truth; TS types and Pydantic models are generated from it | OpenAPI 3.1 |

The Mac only collects. All analysis runs on the server.

## 2. Monorepo layout

```
insider/
  apps/
    collector-macos/          Swift package + Xcode app target (menu-bar app)
      Sources/Collector/
        App/                  MenuBarExtra UI, onboarding, settings
        WhatsApp/             Snapshotter, Reader, SchemaGuard, row mappers
        Sync/                 Checkpoints, Outbox, Uploader, MediaUploader, Heartbeat
        Support/              Keychain, logging, power assertions
      Tests/                  reader tests against the anonymised fixture DB
    web/                      SvelteKit SPA (adapter-static)
      src/lib/{api,components,stores,utils}
      src/routes/             one folder per route
      tests/                  Playwright e2e, Vitest unit
  services/
    backend/                  Django project — the ONLY schema/migration owner
      insider_backend/        settings, urls
      market_intel/           models + migrations (no views)
      manage.py
    agents/                   FastAPI + Celery; reads Django-owned tables, never migrates
      market_intel/
        api/                  routers: ingest, read, review (device-token + user auth)
        pipeline/             Celery tasks: dedupe, classify, extract, normalize, aggregate, insights
        schemas/              per-commodity extraction schemas (CropSchemaRegistry pattern)
      celery_app.py
      main.py
  packages/
    contracts/                openapi.yaml + generated TS types + generated Pydantic models
    fixtures/                 anonymised ChatStorage snapshot, sample chat exports, golden extraction set
  tools/
    spike/                    Phase 0 Python scripts (DB probe, export dumper)
    export-importer/          parser for WhatsApp .txt chat exports (backfill)
  infra/                      GCS bucket + lifecycle, service accounts, Nginx, deploy scripts
  docs/
  .github/workflows/          (or Cloud Build triggers, matching the current setup)
  package.json                pnpm workspace root
  pnpm-workspace.yaml         apps/web, packages/contracts
  pyproject.toml              uv workspace root
                              (members: services/backend, services/agents, tools/*)
  CODEOWNERS
  README.md
```

### Workspace tooling

| Language | Tool | Members |
|---|---|---|
| TypeScript | pnpm workspaces | `apps/web`, `packages/contracts` |
| Python | uv workspace (one lockfile) | `services/backend`, `services/agents`, `tools/spike`, `tools/export-importer` |
| Swift | SwiftPM + Xcode project | `apps/collector-macos` |
| Glue | root `Makefile` or `justfile` | `gen` (contracts → TS + Pydantic), `test`, `lint`, `dev` |

### Schema ownership rule

- `services/backend` (Django) holds every model and migration. `makemigrations` / `migrate` run only from there.
- `services/agents` maps the same tables (SQLAlchemy models or raw asyncpg) and never issues DDL. A CI check fails if any migration tooling appears in `services/agents`.

## 3. Data model (Django `market_intel`)

Raw messages and extraction events are append-only. Prices are stored as reported and also normalized to ₹/quintal.

| Table | Key columns |
|---|---|
| `collector_device` | name, token hash, app version, schema fingerprint, last heartbeat, status |
| `wa_group` | JID (unique), name, member count, is_watched, region tag, primary commodities |
| `wa_message` | stanza ID (unique per group), group, device, sender hash, sender name, sent at, type, text, quoted stanza ID, is_forwarded, content hash, ingested at |
| `wa_media` | message, GCS path, mime, sha256, OCR status |
| `content_cluster` | content hash, canonical message, group count, first seen |
| `message_label` | message, label (price/arrivals/news/advisory/noise), confidence, model version |
| `commodity` | name, varieties, synonyms (Gujarati, Hindi, Gujlish) |
| `market` | name, district, state, aliases, lat/long |
| `unit` | code (per 20 kg, per quintal, per kg), factor to quintal |
| `price_observation` | message, commodity, variety, market, obs date, raw min/max/modal, unit, per-quintal min/max/modal, arrivals, confidence, status (auto/needs review/approved/rejected) |
| `extraction_event` | observation, action, actor (model or user), before/after, created at |
| `daily_price` | median modal, min, max, source count, group count, quality flag |
| `insight` | date, type (price move/spread/arrival spike/conflict/news), commodity, market, severity, title, detail |
| `daily_brief` | date, body, generated at, delivered at |

Sender phone numbers are stored only as an HMAC of the JID, plus the display name.

## 4. API surface (`packages/contracts/openapi.yaml`)

**Collector (device token):** `POST /v1/ingest/messages` (≤500 per batch, idempotent on group + stanza ID) · `POST /v1/ingest/media/upload-url` · `POST /v1/ingest/media/complete` · `POST /v1/groups/catalog` · `GET /v1/devices/config` · `POST /v1/devices/heartbeat`

**Web (user login):** `GET /v1/brief/{date}` · `GET /v1/prices/latest` · `GET /v1/prices/daily` · `GET /v1/spreads` · `GET /v1/insights` · `GET /v1/messages` · `GET /v1/messages/{id}` · `GET/PATCH /v1/review/observations` · `GET/PATCH /v1/groups` · `GET /v1/devices` · CRUD `/v1/dictionaries/{commodities,markets,units}` · `POST /v1/ask` (Phase 4)

## 5. Scheduled jobs (IST)

| Job | When | Does |
|---|---|---|
| Aggregate | every 15 min + 23:30 full rebuild | rebuilds dirty `daily_price` rows |
| Insights | 18:30 | price moves vs 7-day average, spreads, arrival spikes, conflicts, top news |
| Daily brief | 19:00 | writes the brief; web app, optionally email/Telegram |
| Collector watchdog | every 5 min | alerts on no heartbeat for 30 min or schema mismatch |
| Retrain dictionaries | weekly | proposes aliases from approved review edits |

## 6. Hosting (unchanged; deploys now run from this repo)

| Component | Target |
|---|---|
| Postgres | Supabase (prod + testing projects) |
| FastAPI + Celery workers | Agents VM behind Nginx, deployed from `services/agents` |
| Django migrations | run from `services/backend` against Supabase in the deploy pipeline (and admin, if wanted) |
| Media | GCS, asia-south1, private bucket |
| Web | Firebase Hosting (static adapter), preview channels per PR |
| Collector | Developer ID signed + notarized `.app` (not App Store); Sparkle later |

## 7. Build phases

| Phase | Duration | Exit check |
|---|---|---|
| 0. Spike | 2 days | DB readable with Full Disk Access; schema matches; prototype extractor gets ≥80% of price fields right on 200 messages |
| 1. Scaffold | Week 1 | All four build units (Swift, Django, FastAPI/Celery, web) build in one CI; reader tests pass on the fixture DB |
| 2. Ingestion | Week 2 | A message in a watched group shows in `/feed` within 3 min; an hour offline loses nothing |
| 3. Extraction | Weeks 3–4 | ≥90% precision on price fields (golden set of 300); review queue <15% of price messages |
| 4. Insights | Week 5 | Brief generated 5 evenings in a row; spot check agrees |
| 5. Hardening | Week 6 | One unattended week with no data gaps |

## 8. Phase 0 checklist (spike)

- [ ] Link WhatsApp for Mac to the groups' number (dedicated SIM preferred)
- [ ] `tools/spike/probe.py`: list tables, groups and the last 7 days of messages to CSV (read a *copy* of `ChatStorage.sqlite` + `-wal` + `-shm`)
- [ ] Export chat history of every watched group (.txt) for backfill
- [ ] Run the extraction prototype on 200 messages; record field accuracy
- [ ] Produce the anonymised `ChatStorage` fixture for `packages/fixtures/`

## 9. Phase 1 checklist (scaffold, monorepo version)

**Repo and tooling**
- [ ] `git init` the `insider` repo; add the layout above, README, CODEOWNERS, `.editorconfig`, `.gitignore`
- [ ] Root `package.json` + `pnpm-workspace.yaml`; root `pyproject.toml` as a uv workspace; `Makefile`/`justfile` with `gen`, `dev`, `test`, `lint`
- [ ] Pre-commit: ruff + mypy (Python), prettier + eslint + svelte-check (web), swift-format (collector)

**Contracts**
- [ ] `packages/contracts/openapi.yaml` covering every endpoint in §4
- [ ] `make gen`: openapi-typescript → `packages/contracts/ts`, datamodel-code-generator → `packages/contracts/python`; CI fails if generated files are stale

**Backend schema (`services/backend`)**
- [ ] Django project `insider_backend` + app `market_intel` with every table in §3
- [ ] Run migrations on the testing Supabase project
- [ ] Data migration that seeds `commodity`, `unit` and the first market aliases (castor, groundnut, chosen mandis)

**API + pipeline (`services/agents`)**
- [ ] FastAPI app with ingest/read/review routers; device-token and user auth; read endpoints return fixtures for now
- [ ] Celery app + Redis config; stub tasks for the six pipeline steps and the scheduled jobs (beat schedule in IST)
- [ ] Read-only table mappings against the Django schema; CI guard against DDL here

**Infra**
- [ ] GCS media bucket with lifecycle rules; signed-URL service account

**Web (`apps/web`)**
- [ ] `npx sv create apps/web` (Svelte 5, TypeScript, Tailwind, Vitest, Playwright); add adapter-static with SPA fallback, TanStack Query, chart library, generated client from `packages/contracts`
- [ ] App shell: nav, login, empty states for every route (`/`, `/prices`, `/prices/[commodity]`, `/markets/[market]`, `/insights`, `/feed`, `/review`, `/settings/{groups,devices,dictionaries}`, `/login`)
- [ ] Gujarati + English i18n dictionary; IST date and ₹ (lakh/crore) formatters

**Collector (`apps/collector-macos`)**
- [ ] Xcode project: SwiftUI MenuBarExtra app, GRDB, Keychain helper, onboarding with Full Disk Access check, `SMAppService` launch at login
- [ ] Reader + SchemaGuard against the fixture DB, with unit tests

**CI (one pipeline, path-filtered jobs)**
- [ ] `apps/collector-macos/**` → Swift build + tests on a macOS runner
- [ ] `services/**`, `tools/**` → uv sync, ruff, mypy, pytest (incl. Django migration check)
- [ ] `apps/web/**`, `packages/contracts/**` → pnpm build, svelte-check, Vitest, Playwright; deploy to a Firebase preview channel
- [ ] Contract drift check: generated types match `openapi.yaml`

## 10. Decisions

**Taken**
- One monorepo (`insider`) for collector, web, contracts, Django schema, FastAPI + Celery, tools and infra. Django stays the only schema owner.

**Open (from the source plan)**
1. Web login: reuse Bull Connect auth (recommended) or a separate Supabase Auth project?
2. Linked number: new dedicated SIM (recommended) or an existing team number?
3. Dedicated always-on Mac from day one, or start on the MacBook?
4. Brief delivery beyond the web app: email, Telegram, or WhatsApp?
5. First commodity and mandi list to seed (castor, groundnut — which markets?)
6. *(New, from the monorepo move)* If reusing Bull Connect auth: how does `services/agents` check Bull Connect sessions/JWTs from a separate repo? (Shared JWT secret/JWKS vs. an auth call.)
