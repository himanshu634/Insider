# Insider Collector (macOS)

Menu-bar Electron app, written in TypeScript. It copies WhatsApp Desktop's local `ChatStorage.sqlite`
(with its `-wal` and `-shm` files) into a private work directory and reads the copy read-only. It
takes new messages from the watched groups and queues them in its own SQLite outbox, then uploads
them to the API (`packages/contracts/openapi.yaml`, collector endpoints). Images and PDFs of those
messages follow through signed upload URLs. The Mac only collects. All analysis runs on the server.

## Layout

| Path | What |
|---|---|
| `src/core/` | Plain Node with no Electron imports. Unit-tested. |
| `src/core/whatsapp-schema.ts` | **Every** WhatsApp table and column name. Unconfirmed until Phase 0. |
| `src/core/snapshot.ts` | Copies db + `-wal` + `-shm` together into a temp dir. Retries if the files change during the copy. Handles cleanup. |
| `src/core/reader.ts` | `groups()`, `newMessages(groupJids, checkpoints)` → `IngestMessage` DTOs (+ the local media item and path), `mediaLocalPaths(itemPks)` |
| `src/core/schema-guard.ts` | sha256 fingerprint of the columns used, plus a list of missing columns |
| `src/core/sender-hash.ts` | HMAC-SHA256 of the sender JID. Same as `services/api/src/security.ts`. |
| `src/core/outbox.ts` | Own SQLite file. Queued messages, their pending media and per-group checkpoints are written in one transaction. |
| `src/core/media-queue.ts` | Media tables in the outbox file: `pending_media` → `media_outbox` → done, or `media_failed` |
| `src/core/media-uploader.ts` | Waits for WhatsApp to download a file, then sha256 → upload URL → PUT → complete |
| `src/core/connection.ts` | Checks and tests what the Connect window collects; `settings.json` read/write |
| `src/core/connect-page.ts` | The Connect window's page (a data: URL with a hash-pinned CSP) |
| `src/core/groups-page.ts` | The Groups window's page (same pattern) and `groupRows()` for its list |
| `src/core/api-client.ts` | fetch client with a bearer device token, exponential backoff and a per-request timeout |
| `src/core/sync-engine.ts` | One tick: config → snapshot → schema guard → read + media re-check → outbox → cleanup → upload messages → upload media |
| `src/core/config.ts` | Environment variables (see below) |
| `src/main.ts` | Tray menu, timers, Connect and Groups windows, Full Disk Access prompt, login item |
| `src/preload.cts` | Connect window preload (CommonJS: sandboxed preloads cannot be ES modules) |
| `src/groups-preload.cts` | Groups window preload: one read-only `list()` call |
| `src/token-store.ts` | Device token, encrypted with `safeStorage` under `userData` |

The app stores `outbox.sqlite`, `device-token.bin`, `settings.json` (API URL) and short-lived
`snapshots/` in Electron's `userData` directory (`~/Library/Application Support/@insider/collector`
in dev).

## Connecting

On first run (no stored token and no `INSIDER_DEVICE_TOKEN`) the app opens **Connect Insider
Collector**; it is also in the tray menu as *Connect…* / *Change connection…*. Enter the API URL
(https, or http for localhost) and the device token from `pnpm --filter @insider/api create-device
<name>`. The app calls `GET /v1/devices/config` once with that token; only when that works does it
store the token with `safeStorage` and the URL in `settings.json`, then restart syncing.

The server sends the sender HMAC key in that same device config (`sender_hmac_key`), so the
packaged app needs no `SENDER_HMAC_KEY`. The key is kept in memory only.

## Groups

*Groups…* in the tray menu opens a read-only list of the WhatsApp groups this Mac can see, with
member counts, a search box and *Refresh*. Each refresh reads a fresh snapshot, so the list works
before the Mac is connected (it only needs Full Disk Access). Once the device config has loaded,
groups the web app watches carry a *Watched* badge. A group WhatsApp stores no name for shows as
*No name in WhatsApp* with its JID. Choosing which groups to watch stays in the web app
(Settings → Groups).

## Media

For each new **image** or **document** message, the outbox records a `pending_media` row in the
same transaction that moves the group's checkpoint, so a checkpoint never passes a file we have not
recorded. While WhatsApp has not downloaded the file (`ZMEDIALOCALPATH` is NULL, or the file is not
on disk yet), every tick re-reads the path from the snapshot. When the file is there and is an image
or a PDF, it moves to `media_outbox`; other documents are dropped. After 7 days without a file the
row moves to `media_failed` with the reason.

Uploads start only after the message itself has left the message outbox (the API refuses media for
unknown messages): sha256 of the file → `POST /v1/ingest/media/upload-url` → `PUT` to the signed URL
(no `Authorization` header; `Content-Type` is the signed MIME) → `POST /v1/ingest/media/complete`.
The PUT is skipped when the server answers `already_uploaded`, and for the dev URL
`http://localhost:<port>/dev-media/…` that the API returns without GCP credentials. Progress is kept
per step, so offline or server errors retry only what is left on a later tick; a 5xx backs off
that one file so it never blocks the others, and media errors do not hold back *Last sync*. At most 20 files go
per tick. Rejected messages, files over 50 MB, deleted files and requests the server calls invalid
end in `media_failed`.

Where `ZMEDIALOCALPATH` is relative to is a Phase 0 assumption (`MEDIA_ROOTS_FROM_DB_DIR` in
`whatsapp-schema.ts`: `Message/`, then the database folder). Paths that leave those folders are
never read.

## Configuration

| Variable | Default |
|---|---|
| `INSIDER_API_URL` | `http://localhost:8000`. A URL saved in the Connect window wins. |
| `INSIDER_DEVICE_TOKEN` | none. Dev fallback; a token saved in the Connect window (`safeStorage` file) wins. |
| `INSIDER_WA_DB` | `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`. A relative path is resolved against the directory pnpm was started from. |
| `SENDER_HMAC_KEY` | none. Dev fallback; the key the server sends in the device config wins. Without either, the app reads no messages. |
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
login attach to a stable, signed bundle. The packaged build must ship `dist/preload.cjs` next to
`dist/main.js`.
