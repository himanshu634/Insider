# Insider Collector (macOS)

Menu-bar Electron app, written in TypeScript. It copies WhatsApp Desktop's local `ChatStorage.sqlite`
(with its `-wal` and `-shm` files) into a private work directory and reads the copy read-only. It
takes new messages from the watched groups and queues them in its own SQLite outbox, then uploads
them to the API (`packages/contracts/openapi.yaml`, collector endpoints). The Mac only collects.
All analysis runs on the server.

## Layout

| Path | What |
|---|---|
| `src/core/` | Plain Node with no Electron imports. Unit-tested. |
| `src/core/whatsapp-schema.ts` | **Every** WhatsApp table and column name. Unconfirmed until Phase 0. |
| `src/core/snapshot.ts` | Copies db + `-wal` + `-shm` together into a temp dir. Retries if the files change during the copy. Handles cleanup. |
| `src/core/reader.ts` | `groups()` and `newMessages(groupJids, checkpoints)` → `IngestMessage` DTOs |
| `src/core/schema-guard.ts` | sha256 fingerprint of the columns used, plus a list of missing columns |
| `src/core/sender-hash.ts` | HMAC-SHA256 of the sender JID. Same as `services/api/src/security.ts`. |
| `src/core/outbox.ts` | Own SQLite file. Queued messages and per-group checkpoints are written in one transaction. |
| `src/core/api-client.ts` | fetch client with a bearer device token, exponential backoff and a per-request timeout |
| `src/core/sync-engine.ts` | One tick: config → snapshot → schema guard → read → outbox → upload → cleanup |
| `src/core/config.ts` | Environment variables (see below) |
| `src/main.ts` | Tray menu, timers, Full Disk Access prompt, login item |
| `src/token-store.ts` | Device token, encrypted with `safeStorage` under `userData` |

The app stores `outbox.sqlite`, `device-token.bin` and short-lived `snapshots/` in Electron's
`userData` directory (`~/Library/Application Support/@insider/collector` in dev).

## Configuration

| Variable | Default |
|---|---|
| `INSIDER_API_URL` | `http://localhost:8000` |
| `INSIDER_DEVICE_TOKEN` | none. Dev fallback; the packaged app keeps the token in a `safeStorage` file. |
| `INSIDER_WA_DB` | `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`. A relative path is resolved against the directory pnpm was started from. |
| `SENDER_HMAC_KEY` | none. The app reads no messages until this is set. It must match the API. |
| `INSIDER_SYNC_INTERVAL_SECONDS` | `90` (minimum 15). Overridden by the server's `sync_interval_seconds`. |
| `INSIDER_WEB_URL` | `http://localhost:5173` |

## Dev

```sh
bin/insider collector
```

This runs the collector against the **synthetic fixture**, never against your real WhatsApp
data. It does two things:

1. If the fixture database does not exist, it builds it with
   `sqlite3 "$INSIDER_WA_DB" < packages/fixtures/chatstorage/synthetic.sql`
   (default `INSIDER_WA_DB=.dev/fixtures/ChatStorage.sqlite`).
2. It runs `pnpm --filter @insider/collector dev`, which runs `tsc` and then `electron .`.

The API must be running (`bin/insider api`), with a device whose token matches
`INSIDER_DEVICE_TOKEN`. The app has no Dock icon. Look for the ring icon in the menu bar.

> `bin/insider collector` still has to be switched from the old Swift command (`swift run`) to the
> two steps above. Until then, run them by hand from the repo root.

## Checks

```sh
pnpm --filter @insider/collector check   # tsc for the app and for the tests
pnpm --filter @insider/collector test    # vitest; builds fixture DBs in temp dirs, no network
pnpm --filter @insider/collector build   # tsc → dist/
```

The tests load `packages/fixtures/chatstorage/synthetic.sql` into temp databases with
`node:sqlite`, so they need no native modules and no `sqlite3` binary. A fake API client stands in
for the network.

## Full Disk Access

macOS protects `~/Library/Group Containers/…`. Without Full Disk Access, reads fail with `EPERM`,
and the app shows a dialog with a button that opens
*System Settings → Privacy & Security → Full Disk Access*.

macOS grants Full Disk Access **to an app bundle**. For the real app, that is the packaged
`Insider Collector.app`. In dev the process is Electron's own binary (or your terminal), so the
fixture path needs no permission. Do not grant Full Disk Access to Electron or your terminal to
test against real data. Use the packaged app.

## Packaging (Phase 5)

Packaging is not done yet. Phase 5 will add an electron-builder config (with `LSUIElement`),
Developer ID signing, hardened runtime and notarization, so that Full Disk Access and launch at
login attach to a stable, signed bundle. Phase 5 will also add onboarding for the device token and
HMAC key.
