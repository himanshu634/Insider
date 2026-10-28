# Insider — Scaffolding Plan (monorepo, TypeScript only)

Source: the "Insider — Scaffolding Plan" doc (2026-10-19), changed in three ways:

1. **One monorepo.** Everything lives in `insider`, the backend included. The original plan put the schema and the API/worker code into the existing Bull Connect and agents-service repos.
2. **TypeScript only.** No Python, no Swift. The API is Hono + Drizzle ORM + BullMQ on Node 22. The collector is an Electron menu-bar app.
3. **Own Postgres schema.** All tables, the enum types and the migrations journal live in schema `market_intel`. Nothing touches `public` or any Bull Connect table, even in a shared Supabase database.

## 1. What we are building

| Piece | Role | Stack |
|---|---|---|
| macOS collector | Copies WhatsApp Desktop's local SQLite database (read-only), takes new messages from 10–15 watched groups and uploads them through a local outbox | Electron 38 (tray app), TypeScript, `node:sqlite` |
| API service | Owns the schema and migrations, serves the ingest and read APIs | Hono on Node 22, Drizzle ORM (postgres-js), drizzle-kit, Ajv validation from the OpenAPI spec |
| Job worker | Per-message pipeline (dedupe → classify → extract → normalize → validate → store) and the IST cron jobs | BullMQ + Redis; inline mode when Redis is absent |
| Media | Images and PDFs of rate sheets | GCS bucket in asia-south1, signed URLs |
| Web app | Daily brief, price board, trends, spreads, feed, review queue, settings | SvelteKit 3 (Svelte 5 runes) SPA, Tailwind 4, TanStack Query, ECharts, openapi-fetch |
| Contracts | OpenAPI spec is the source of truth; TS types are generated from it and used by API, web, collector and tools | OpenAPI 3.1, openapi-typescript |

The collector Mac only collects. Pipeline analysis runs on the server; the internal analyst CLI is a read-only client run on team Macs.

## 2. Monorepo layout

```
insider/
  apps/
    collector/                Electron menu-bar app
      src/core/               snapshot, reader, schema guard, outbox, sync engine (pure TS, tested under Node)
      src/core/whatsapp-schema.ts   every WhatsApp table/column name, in one file
      src/main.ts             tray UI, timers, Full Disk Access onboarding, login item
    web/                      SvelteKit SPA (adapter-static) + the Mandi Ledger design system
      src/lib/ui/             tokens + components
      src/routes/             one folder per route; /design is the living style guide
  services/
    api/                      Hono API + BullMQ worker (one package)
      src/db/schema.ts        Drizzle tables, all in pgSchema('market_intel')
      drizzle/                SQL migrations (initial schema, seed dictionaries)
      src/routes/             collector, read, review, admin
      src/pipeline/           tasks, queue (BullMQ or inline), IST schedules
      src/extraction/         rule gate, extraction prompt and schema, row checks
      src/server.ts, src/worker.ts
      test/                   PGlite (in-process Postgres) tests running the real migrations
  packages/
    contracts/                openapi.yaml + generated src/schema.d.ts
    fixtures/                 synthetic ChatStorage SQL (until Phase 0), golden extraction set later
  tools/
    spike/                    Phase 0 probe of a copy of ChatStorage.sqlite
    export-importer/          WhatsApp .txt chat export parser + backfill
    analyst/                  internal analyst CLI (Claude Agent SDK, read-only)
  infra/                      GCS bucket script, systemd units, Nginx, deploy notes
  bin/insider                 Mac command: start one service, or everything in dev mode
  .github/workflows/ci.yml
  pnpm-workspace.yaml, tsconfig.base.json, package.json
```

One package manager (pnpm workspaces), one language, one lockfile.

### Schema ownership

- `services/api` is the only schema owner. `src/db/schema.ts` declares every table and enum in `pgSchema('market_intel')`.
- `drizzle.config.ts` uses `schemaFilter: ['market_intel']` and stores the journal in `market_intel.__drizzle_migrations`.
- CI migrates a real Postgres twice and fails if any table appears in `public`. It also runs `drizzle-kit check` and fails if `drizzle-kit generate` would produce a new migration.

### Request validation

The API compiles request-body validators straight from `packages/contracts/openapi.yaml` (Ajv, JSON Schema 2020-12), so there are no hand-written schemas to drift. A test checks that the API implements exactly the routes in the spec, and responses are validated against the spec's schemas.

## 3. Data model (Postgres schema `market_intel`)

Raw messages and extraction events are append-only. Prices are stored as reported and also normalized to ₹/quintal.

| Table | Key columns |
|---|---|
| `collector_device` | name, token hash, app version, schema fingerprint, last heartbeat, status |
| `wa_group` | JID (unique), name, member count, is_watched, region tag, primary commodities |
| `wa_message` | stanza ID (unique per group), group, device, sender hash, sender name, sent at, type, text, quoted stanza ID, is_forwarded, content hash, cluster, ingested at |
| `wa_media` | message, GCS path, mime, sha256, OCR status |
| `content_cluster` | content hash, canonical message, group count, first seen |
| `message_label` | message, label (price/arrivals/news/advisory/noise), confidence, model version |
| `commodity` | slug, name, varieties, synonyms (Gujarati, Hindi, Gujlish) |
| `market` | slug, name, district, state, aliases, lat/lng |
| `unit` | code (per 20 kg, per quintal, per kg), factor to quintal |
| `price_observation` | message, commodity, variety, market, obs date, raw min/max/modal, unit, per-quintal min/max/modal, arrivals, confidence, status |
| `extraction_event` | observation, action, actor (model or user), before/after, created at |
| `daily_price` | median modal, min, max, source count, group count, quality flag |
| `insight` | date, type, commodity, market, severity, title, detail |
| `daily_brief` | date, body, generated at, delivered at |

Sender phone numbers are stored only as an HMAC of the JID, plus the display name.

## 4. API surface (`packages/contracts/openapi.yaml`)

**Collector (device token):** `POST /v1/ingest/messages` (≤500 per batch, idempotent on group + stanza ID) · `POST /v1/ingest/media/upload-url` · `POST /v1/ingest/media/complete` · `POST /v1/groups/catalog` · `GET /v1/devices/config` · `POST /v1/devices/heartbeat`

**Web (user login):** `GET /v1/brief/{date}` · `GET /v1/prices/latest` · `GET /v1/prices/daily` · `GET /v1/spreads` · `GET /v1/insights` · `GET /v1/messages` · `GET /v1/messages/{id}` · `GET/PATCH /v1/review/observations` · `GET/PATCH /v1/groups` · `GET /v1/devices` · CRUD `/v1/dictionaries/{commodities,markets,units}` · `POST /v1/ask` (Phase 4)

User auth sits behind one middleware (`requireUser`). Phase 1 ships a dev bypass; the real check (Bull Connect token or Supabase Auth) plugs in once that decision is made.

## 5. Scheduled jobs (BullMQ job schedulers, tz Asia/Kolkata)

| Job | When | Does |
|---|---|---|
| Aggregate | every 15 min + 23:30 full rebuild | rebuilds dirty `daily_price` rows |
| Insights | 18:30 | price moves vs 7-day average, spreads, arrival spikes, conflicts, top news |
| Daily brief | 19:00 | writes the brief; web app, optionally email/Telegram |
| Collector watchdog | every 5 min | marks a device silent after 30 min without a heartbeat |
| Retrain dictionaries | Sundays 06:00 | proposes aliases from approved review edits |

## 6. Hosting

| Component | Target |
|---|---|
| Postgres | Supabase (prod + testing projects), schema `market_intel` |
| API + worker | Agents VM behind Nginx: `node dist/server.js` and `node dist/worker.js` under systemd (`infra/`) |
| Redis | On the agents VM (existing) |
| Migrations | `pnpm --filter @insider/api db:migrate` in the deploy step |
| Media | GCS, asia-south1, private bucket |
| Web | Firebase Hosting (static adapter), preview channels per PR |
| Collector | Electron `.app` signed with Developer ID and notarized (Phase 5); Full Disk Access is granted to that bundle |

## 7. Local development (Mac commands)

`bin/insider` starts any one service, or all of them together:

| Command | Starts |
|---|---|
| `bin/insider dev` | Everything: local Postgres, Redis (if installed), migrations, dev device, API (watch), job worker, web dev server, collector against the synthetic fixture. Ctrl-C stops all |
| `bin/insider db` | Project-local Postgres cluster in `.dev/postgres` (port 54329); no system service touched |
| `bin/insider redis` | Project-local Redis (port 6380) |
| `bin/insider migrate` | Apply migrations |
| `bin/insider seed` | Create the dev collector device |
| `bin/insider api` | API on :8000 with watch |
| `bin/insider worker` | BullMQ worker + IST schedules |
| `bin/insider web` | SvelteKit dev server on :5173 |
| `bin/insider collector` | Electron collector (synthetic fixture DB, local API) |
| `bin/insider setup` / `test` / `gen` | Install deps + `.env`; run every test suite; regenerate contract types |

Without Redis installed, `dev` sets `QUEUE_INLINE=true`: jobs run inside the API and there is no worker or schedule.

## 8. Build phases

| Phase | Duration | Exit check |
|---|---|---|
| 0. Spike | 2 days | DB readable with Full Disk Access; schema matches; prototype extractor gets ≥80% of price fields right on 200 messages |
| 1. Scaffold | Week 1 | API, web, collector and tools all build and test in one CI; reader tests pass on the fixture DB |
| 2. Ingestion | Week 2 | A message in a watched group shows in `/feed` within 3 min; an hour offline loses nothing |
| 3. Extraction | Weeks 3–4 | ≥90% precision on price fields (golden set of 300); review queue <15% of price messages |
| 4. Insights | Week 5 | Brief generated 5 evenings in a row; spot check agrees |
| 5. Hardening | Week 6 | One unattended week with no data gaps |

## 9. Phase 0 checklist (spike)

- [ ] Link WhatsApp for Mac to the groups' number (dedicated SIM preferred)
- [ ] `pnpm --filter @insider/spike probe`: list tables, groups and the last 7 days of messages to CSV (reads a *copy* of `ChatStorage.sqlite` + `-wal` + `-shm`)
- [ ] Export chat history of every watched group (.txt) for backfill
- [ ] Run the extraction prototype on 200 messages; record field accuracy
- [ ] Replace the synthetic fixture with an anonymised real snapshot; fix `whatsapp-schema.ts` if names differ

## 10. Phase 1 checklist (scaffold)

- [x] Monorepo: pnpm workspace, shared `tsconfig.base.json`, `.env.example`, CODEOWNERS (owner placeholder)
- [x] `packages/contracts/openapi.yaml` for every endpoint; generated TS types; CI drift check
- [x] API: Drizzle schema in `market_intel`, initial + seed migrations, every route, device-token auth, dev user-auth stub, idempotent ingest, BullMQ/inline jobs, IST schedules, PGlite tests
- [x] Web: SPA shell, every route with empty states, Mandi Ledger design system + `/design` style guide, Gujarati/English labels, IST/₹ formatters
- [x] Collector: core (snapshot, reader, schema guard, outbox, sync engine) with fixture tests; Electron tray shell
- [x] Tools: Phase 0 probe; export importer with tests
- [x] Infra: GCS bucket script, systemd units, Nginx config (written, run by a human)
- [x] `bin/insider` with `dev` and one subcommand per service
- [x] CI: one workflow, path-filtered jobs for contracts, API (with real Postgres), web, collector (macOS runner), tools

## 10b. Phase 3 checklist (extraction)

- [x] Per-message chain for text messages: rule gate → one structured-output call → row checks in code (evidence, numbers, dictionaries, units, dates, min > max, 30-day median bounds) → `price_observation` + `extraction_event`; every call logged in `llm_call` (not live-verified)
- [x] `extract-pending` CLI for messages ingested without `ANTHROPIC_API_KEY`
- [ ] Escalation pass 2 (thread, sender and fuzzy-match context) for rows with no mandi or an ambiguous commodity
- [ ] Vision extraction for rate-sheet images and PDFs (`ocr-media`)
- [ ] Relative rows ("10 rupiya upar"), news events and stance
- [ ] Alias proposals for unknown spellings (for example `arenda` for castor, which the seed lacks, so those rows go to review)
- [x] Aggregation into `daily_price`: dirty marks, `aggregate-dirty`, nightly full rebuild, `conflicting` (within one variety) and `single_source` flags, `conflict` insights (`median_modal` still mixes varieties)
- [ ] Source weights: half weight for `single_source` (AG-03), group reliability (GL-04, GL-05), relative rows as `derived` prices (AG-04)
- [ ] Golden set of 300 real messages and the precision eval

## 10a. Phase 4 checklist (insights + agents)

- [x] /v1/ask scaffold (Tool Runner, read-only tools, 8-call cap, number check) (not live-verified)
- [x] Internal analyst CLI in tools/analyst (Claude Agent SDK 0.3.303, read-only insider tools, no built-in tools or user settings) (not live-verified)
- [x] Scrub phone numbers and @mentions from message text before it reaches any LLM (SF-03 follow-up): `scrubContacts` in `services/api/src/agent/scrub.ts`, applied by `search_messages` to what the model sees and to the number-check evidence
- [x] Extraction pipeline: pass message text through `scrubContacts` before the extraction LLM sees it (`packetText` in `services/api/src/extraction/prompt.ts`)

## 11. Decisions

**Taken**
- One monorepo (`insider`).
- TypeScript only: Hono + Drizzle + BullMQ API, SvelteKit web, Electron collector.
- All database objects in Postgres schema `market_intel`.
- Node 22 LTS everywhere (confirm on the agents VM).

**Open**
1. Web login: reuse Bull Connect auth (recommended) or a separate Supabase Auth project? If Bull Connect, the API verifies its tokens (shared JWT secret or JWKS).
2. Linked number: new dedicated SIM (recommended) or an existing team number?
3. Dedicated always-on Mac from day one, or start on the MacBook?
4. Brief delivery beyond the web app: email, Telegram, or WhatsApp?
5. First commodity and mandi list to seed. The seed has castor, groundnut and six placeholder Gujarat mandis (Rajkot, Gondal, Junagadh, Jamnagar, Deesa, Patan).
