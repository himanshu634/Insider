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
| **Message feed** | The raw messages, searchable, with the extracted values overlaid |
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
│ macOS collector      │──▶│ FastAPI ingest ─▶ Celery pipeline  │──▶│ SvelteKit web │
│ (Swift menu-bar app) │   │  dedupe → classify → extract →     │   │ app (phone +  │
│ reads local SQLite   │   │  normalize → validate → store      │   │ desktop)      │
│ copy, outbox upload  │──▶│ GCS (images, PDFs)  Postgres       │   │               │
└──────────────────────┘   └────────────────────────────────────┘   └───────────────┘
```

1. **Collect.** A menu-bar app on a Mac linked to WhatsApp copies the local message database every ~90 seconds. It reads new messages from the watched groups and uploads them through an offline-safe outbox.
2. **Process.** The server de-duplicates forwards, classifies each message (price, arrivals, news, advisory, noise) and extracts structured prices with an LLM (vision for rate-sheet images). It maps names and units to a canonical form and checks the result.
3. **Aggregate.** Jobs build daily prices per commodity × mandi, detect insights and write the evening brief.
4. **Read.** The web app shows the brief, prices, trends, feed and review queue.

---

## Repository layout (monorepo)

```
insider/
  apps/
    collector-macos/   Swift 6 menu-bar app (SwiftUI, GRDB)
    web/               SvelteKit SPA (Svelte 5, TypeScript, Tailwind)
  services/
    backend/           Django — the only owner of the schema and migrations (market_intel)
    agents/            FastAPI APIs + Celery pipeline and scheduled jobs
  packages/
    contracts/         OpenAPI spec (source of truth) + generated TS and Pydantic types
    fixtures/          anonymised WhatsApp DB snapshot, chat exports, golden extraction set
  tools/
    spike/             Phase 0 probe scripts
    export-importer/   backfill from WhatsApp .txt chat exports
  infra/               GCS, service accounts, Nginx, deploy scripts
  docs/                plans and runbooks
```

Workspaces: **pnpm** (web, contracts), **uv** (Python services and tools), **SwiftPM/Xcode** (collector).

### Stack

| Component | Tech | Hosting |
|---|---|---|
| Collector | Swift 6, SwiftUI MenuBarExtra, GRDB, SMAppService | The team's Mac (Developer ID signed, notarized) |
| Schema | Django migrations | Supabase Postgres (prod + testing) |
| APIs | FastAPI, Pydantic v2 | Agents VM behind Nginx |
| Pipeline | Celery + Redis, LLM structured output (Gemini; Claude optional), Pillow | Agents VM workers |
| Media | Google Cloud Storage, signed URLs | asia-south1 |
| Web | SvelteKit, TanStack Query, ECharts/LayerChart | Firebase Hosting |

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
