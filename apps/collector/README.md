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
| `src/core/access-page.ts` | The Full Disk Access window's page (same pattern) and its texts (`accessView`, `accessStatus`) |
| `src/core/disk-access.ts` | `checkDbAccess()`, and `findAccessHolder()`: which app macOS checks for Full Disk Access |
| `src/core/api-client.ts` | fetch client with a bearer device token, exponential backoff and a per-request timeout |
| `src/core/sync-engine.ts` | One tick: config → snapshot → schema guard → read + media re-check → outbox → cleanup → upload messages → upload media |
| `src/core/config.ts` | Environment variables (see below) |
| `src/main.ts` | Tray menu, timers, Connect, Groups and Full Disk Access windows, access re-checks, login item |
| `src/preload.cts` | Connect window preload (CommonJS: sandboxed preloads cannot be ES modules) |
| `src/groups-preload.cts` | Groups window preload: the read-only `list()` call and `allowAccess()` |
| `src/access-preload.cts` | Full Disk Access window preload: `info()`, `check()` and its three buttons |
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
2. It runs `tsc`, then opens `.dev/Insider Collector.app` with `apps/collector` as its argument
   (see [Full Disk Access](#full-disk-access)). The app's output goes to `.dev/collector.log`,
   which the command prints. Ctrl-C stops the app.

`make collector-real` (or `make dev-real`) does the same with the real WhatsApp database.

The API must be running (`bin/insider api`), with a device whose token matches
`INSIDER_DEVICE_TOKEN`. The app has no Dock icon. Look for the ring icon in the menu bar.

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

macOS protects `~/Library/Group Containers/…`. Without Full Disk Access, reads fail with `EPERM`.

The app keeps one access state (`ok`, `denied` or `missing`) and reads 16 bytes of the database
to check it: at start, before each sync, every 15 s in the background (also before Connect), and
every 2 s while the Full Disk Access window is open. So a grant or a revoke shows without a
restart.

- **Full Disk Access window.** Opens at start when access is denied, and again each time access
  goes from allowed to denied (never on every check). The tray item *Allow Full Disk Access…* and
  a button in the Groups window also open it. It shows the icon and name of the app to turn on,
  *Open System Settings*, *Show in Finder*, what to do when access stays locked, and a live status
  line. When access works, it closes after 1.5 s and the app syncs and sends the group catalog.
- **Which app.** macOS checks the app it holds responsible for the process, not the process
  itself. `findAccessHolder()` guesses it from `ps`: an app opened by launchd is its own holder;
  otherwise the nearest ancestor that is an app (`X.app/Contents/MacOS/…`, trimmed to the
  outermost bundle). A child of a `disclaimer` helper (the Claude desktop app uses one) is its own
  holder. With no match (for example when the shell that started it has exited), the window names
  "the app you started the collector from".
- **Texts per case.** Packaged app: turn on Insider Collector, with *Quit & Reopen*. Dev copy
  (below): turn on Insider Collector, Show in Finder to drag it in, and if it stays locked, remove
  and add it again, then restart with Ctrl-C. A plain `electron .` from a terminal or editor: turn
  on that app, with a warning that everything run from it gets the same access, and a pointer to
  `make collector-real`.
- Syncing does not stop without access: uploads, heartbeats and media already found need no
  database. The tray menu shows the access item instead of the sync errors it causes.

macOS grants Full Disk Access **to an app bundle**. A plain `electron .` started from a terminal
counts as part of that terminal, so the grant would go to the terminal (or to whatever started it).
To avoid that, `bin/insider collector` runs the collector from `.dev/Insider Collector.app`: a copy
of Electron.app with its name and bundle ID (`local.insider.collector.dev`) changed and an ad-hoc
signature. It starts it with `open`, so macOS treats it as its own app, listed as
**Insider Collector**. The copy holds only Electron, and the code stays in `apps/collector`.

- The fixture needs no permission.
- For the real database, turn on Insider Collector under Full Disk Access. If it is not listed,
  drag `.dev/Insider Collector.app` into the list (the window's *Show in Finder* shows it).
- The grant is tied to the copy's signature. The copy is rebuilt only when the Electron version
  changes (`.dev/collector-app.stamp`). After that, the old entry can show as on but no longer
  works: remove it (−) and add the new copy.
- `CFBundleExecutable` stays `Electron`, so `app.isPackaged` stays false and `userData` stays
  `~/Library/Application Support/@insider/collector`.

## Packaging (Phase 5)

Packaging is not done yet. Phase 5 will add an electron-builder config (with `LSUIElement`),
Developer ID signing, hardened runtime and notarization, so that Full Disk Access and launch at
login attach to a stable, signed bundle. The packaged build must ship `dist/preload.cjs` next to
`dist/main.js`.
