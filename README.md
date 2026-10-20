# Insider

**WhatsApp market intelligence for commodity buying.** Insider reads the trader WhatsApp groups our team already follows. It turns the messages into clean, comparable mandi prices and gives a short evening brief on what moved today and where to buy.

---

## Business overview

### The problem

Prices for castor, groundnut and other commodities reach the team every day through 10–15 WhatsApp groups of traders, brokers and commission agents. That stream is useful, but hard to act on:

- **Too much, mostly noise.** Most messages are greetings, forwards and ads. The rate lists are buried among them.
- **No common format.** Prices arrive per 20 kg, per quintal or per kg. Commodities and mandis are named in Gujarati, Hindi or Gujlish (એરંડા / divela / castor). Many rate sheets are photos.
- **Hard to trust.** The same post gets forwarded across groups, rumours circulate, and one wrong number can drive a bad buying decision.
- **Lives on one phone.** What one person reads does not reach the rest of the team, and there is no history to compare against.

### What Insider does

Insider gives the team one shared, trustworthy view of the market, built from the groups it already follows:

| Output | What the team gets |
|---|---|
| **Daily brief (19:00 IST)** | The day's significant price moves, mandi spreads, arrival spikes, conflicting reports and top community news, in one summary |
| **Price board** | Latest price per commodity × mandi, normalized to ₹/quintal, with the change vs yesterday and vs the 7-day average |
| **Trends and spreads** | Price history by market, market-to-market spreads, arrivals volumes |
| **Chats** | Every watched group as a WhatsApp-style chat, with the prices read from each message shown under it |
| **Review queue** | Low-confidence extractions checked by a person before they count. Every correction makes the system more accurate |

The main question it answers: **"What moved today, and where should we buy?"**

### Why the numbers can be trusted

- Every price shows **how many independent sources and groups** reported it, and links back to the original messages.
- Forwards of the same post are **de-duplicated** and count as one source.
- Sanity checks reject impossible values (min > max, future dates, a price more than ±40% away from the 30-day median). Anything uncertain goes to human review, not the price tables.
- Conflicting reports become an insight of their own instead of being averaged away.

### Principles

- **Read-only.** Insider never sends messages and never talks to WhatsApp's servers. It reads the Mac's local copy of messages already received.
- **Privacy by default.** Phone numbers are hashed on the Mac before upload. Raw messages are visible only to logged-in team members. Data stays internal and is never resold.
- **Team-first.** Analysis runs on the server, so the data survives the laptop and everyone sees the same numbers. The UI is mobile-first because the brief gets read in the field.
- **Bilingual.** Gujarati and English labels from day one.

### First scope

Commodities: **castor and groundnut**, plus the mandis the team tracks. More are added through the dictionaries without code changes.

---

## How it works

```
 WhatsApp Desktop (Mac)          Backend (GCP + Supabase)                 Team
┌──────────────────────┐   ┌────────────────────────────────────┐   ┌───────────────┐
│ Insider Collector    │──▶│ Hono ingest API ─▶ BullMQ pipeline │──▶│ SvelteKit web │
│ (Electron menu-bar)  │   │  dedupe → classify → extract →     │   │ app (phone +  │
│ reads local SQLite   │   │  normalize → validate → store      │   │ desktop)      │
│ copy, outbox upload  │──▶│ GCS (images, PDFs)  Postgres       │   │               │
└──────────────────────┘   └────────────────────────────────────┘   └───────────────┘
```

1. **Collect.** A menu-bar app on a Mac linked to WhatsApp copies the local message database every ~90 seconds. It reads new messages from the watched groups and uploads them through an offline-safe outbox.
2. **Process.** The server de-duplicates forwards, classifies each message (price, arrivals, news, advisory, noise) and extracts structured prices with an LLM (vision for rate-sheet images). It maps names and units to a canonical form and checks the result.
3. **Aggregate.** Jobs build daily prices per commodity × mandi, detect insights and write the evening brief.
4. **Read.** The web app shows the brief, prices, trends, chats and review queue.

---

## Repository layout (monorepo, TypeScript only)

```
insider/
  apps/
    collector/         Electron menu-bar app (node:sqlite)
    web/               SvelteKit SPA + the "Mandi Ledger" design system (/design style guide)
  services/
    api/               Hono API + BullMQ worker; Drizzle owns the schema (Postgres schema market_intel)
  packages/
    contracts/         OpenAPI spec (source of truth) + generated TypeScript types
    fixtures/          synthetic WhatsApp DB (until Phase 0), golden extraction set later
  tools/
    spike/             Phase 0 probe of a copy of the WhatsApp DB
    export-importer/   backfill from WhatsApp .txt chat exports
  infra/               GCS bucket script, systemd units, Nginx config
  bin/insider          Mac command: start one service, or everything in dev mode
  docs/                plans and runbooks
```

One language (TypeScript), one package manager (pnpm workspaces), one lockfile.

### Stack

| Component | Tech | Hosting |
|---|---|---|
| Collector | Electron 38, TypeScript, `node:sqlite` | The team's Mac (signed + notarized `.app` in Phase 5) |
| Schema | Drizzle ORM + drizzle-kit migrations, Postgres schema `market_intel` | Supabase Postgres (prod + testing) |
| API | Hono on Node 22, request validation compiled from the OpenAPI spec | Agents VM behind Nginx |
| Pipeline | BullMQ + Redis (inline mode without Redis), LLM structured output (Gemini; Claude optional) | Agents VM worker |
| Media | Google Cloud Storage, signed URLs | asia-south1 |
| Web | SvelteKit 3 (Svelte 5), Tailwind 4, TanStack Query, ECharts | Firebase Hosting |

---

## Run it locally (macOS)

Prerequisites: Node 22 + pnpm and Homebrew PostgreSQL (`brew install postgresql@18`). Redis is optional (`brew install redis`); without it jobs run inline in the API.

```bash
bin/insider setup
```

```bash
bin/insider dev
```

`bin/insider dev` starts everything in dev mode: a project-local Postgres, Redis (if installed), migrations, the API (:8000, watch mode), the job worker, the web app (:5173) and the collector against a synthetic WhatsApp fixture. Ctrl-C stops all of it.

Start one service on its own with `bin/insider <db|redis|migrate|seed|api|worker|web|collector>`. Run `bin/insider help` for the full list, and `bin/insider test` for every test suite.

The same commands are Make targets: `make setup`, `make dev`, `make web`, `make collector` and so on. `make help` lists them. Two targets exist only in Make:

- `make dev-web` starts everything except the collector.
- `make dev-real` (or `make collector-real` for the collector alone) reads the Mac's real WhatsApp Desktop database instead of the synthetic fixture. The terminal needs Full Disk Access. Set `WA_REAL_DB=<path>` to use another copy.

---

## Roadmap

| Phase | When | Outcome |
|---|---|---|
| 0. Spike | 2 days | Prove the WhatsApp DB is readable; extraction prototype ≥80% accurate |
| 1. Scaffold | Week 1 | Monorepo, contracts, schema, API stubs, web shell, collector skeleton, CI |
| 2. Ingestion | Week 2 | Live messages in the web feed within 3 minutes; no loss when offline |
| 3. Extraction | Weeks 3–4 | Structured prices at ≥90% precision; review queue |
| 4. Insights | Week 5 | Price board, trends, daily brief every evening |
| 5. Hardening | Week 6 | Alerts, signed collector, runbook, natural-language Q&A; a week unattended with no gaps |

Full plan: [docs/scaffolding-plan.md](docs/scaffolding-plan.md).

## Open decisions

1. Web login: reuse Bull Connect auth (recommended) or a separate Supabase Auth project?
2. Linked WhatsApp number: dedicated SIM (recommended) or an existing team number?
3. Dedicated always-on Mac from day one, or start on the MacBook?
4. Brief delivery beyond the web app: email, Telegram or WhatsApp?
5. First list of commodities and mandis to seed.

## Key risks

- **WhatsApp encrypts or changes its local database.** The collector checks the schema fingerprint and alerts on any change. The reader module can be swapped for a fallback collector.
- **Mac asleep or away.** The outbox catches up on wake. Move to an always-on Mac once proven.
- **Poor-quality rate-sheet images and rumours.** Vision extraction, human review, source counts and conflict detection.
