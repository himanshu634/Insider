# @insider/export-importer

Backfills history from WhatsApp **Export chat** `.txt` files through the same
ingest API the collector uses (`POST /v1/ingest/messages`, batches of 500,
device bearer token).

## Usage

```sh
# from the repo root
pnpm --filter @insider/export-importer backfill ~/Downloads/"WhatsApp Chat with Unjha Bhav.txt" \
  --group-jid 120363000000000001@g.us \
  --api-url http://localhost:8000 \
  --token "$INSIDER_DEVICE_TOKEN" \
  --dry-run
```

Use `run import`, not `import`. `pnpm import` is a pnpm built-in command that
builds a lockfile from npm/yarn lockfiles, so the short form never reaches this
script.

| Flag | Default | Notes |
|---|---|---|
| `FILE` | | Relative paths resolve against the directory you ran pnpm from |
| `--group-jid` | (required) | Must end with `@g.us`. Take it from the collector's group catalog or the web app's group settings |
| `--api-url` | `$INSIDER_API_URL` | Not needed with `--dry-run` |
| `--token` | `$INSIDER_DEVICE_TOKEN` | Device token (see `pnpm --filter @insider/api create-device`). Not needed with `--dry-run` |
| `--hmac-key` | `$SENDER_HMAC_KEY` | Must be the API's key, or sender hashes will not line up |
| `--tz` | `Asia/Kolkata` | Timezone of the phone that made the export. Supported: `Asia/Kolkata`, `Asia/Calcutta`, `UTC`, `Etc/UTC` |
| `--date-format` | `dmy` | `mdy` for US-style phones. A wrong guess fails with a hint on the first impossible date |
| `--dry-run` | off | Parse, print a summary and the first messages, send nothing |

Re-running is safe: the API is idempotent on (group, stanza ID), and the IDs
are derived from the message content (see below), so a second run reports
duplicates.

## What it understands

- Android: `19/10/26, 9:41 am - Name: text` (12- or 24-hour, `am`/`AM`/`a.m.`, the narrow no-break space newer builds put before `am`)
- iOS: `[19/10/26, 09:41:12] Name: text`
- 2- or 4-digit years, `/` `.` `-` separators, CRLF, a leading BOM, the invisible bidi marks both apps insert
- Multi-line messages (lines without a header belong to the previous message)
- Media: `<Media omitted>` (type `other`, since Android does not say which kind), `image omitted` / `video omitted` / `document omitted` / ... (iOS), `<attached: 00000012-file.pdf>` (iOS, with media), `IMG-...jpg (file attached)` (Android, with media; type from the extension). Captions on the following lines become `text`
- Skipped: system lines (encryption notice, joins, leaves, subject and description changes; on iOS these are credited to the group name and start with U+200E), `This message was deleted`. A trailing `<This message was edited>` is removed

## How the contract fields are filled

| Field | Value |
|---|---|
| `stanza_id` | `"export-" + sha1(group_jid, sent_at, sender, body)`, the four fields joined with U+0000, `sent_at` being the UTC ISO string below. Stable across re-imports and across a later, longer export of the same chat |
| `group_jid` | `--group-jid` |
| `sender_hash` | HMAC-SHA256 (hex) of the sender **display name**, with `SENDER_HMAC_KEY` |
| `sender_name` | Display name as shown in the export; `null` when the export shows a phone number |
| `sent_at` | Export wall-clock time minus the `--tz` offset, as UTC ISO 8601 |
| `type` | `text`, or the media type worked out above |
| `text` | Message body; for media, the caption or `null` |
| `is_forwarded` | `false` (exports do not mark forwards) |
| `quoted_stanza_id`, `media` | `null` (exports have no reply links; `MediaMeta` needs a file size the export does not record, and this tool does not upload files) |

### Limits to know about

- **Exports have no JIDs.** The collector hashes the sender's JID; this tool can
  only hash the display name, which is whatever the exporting phone's address
  book called that person. The same trader therefore gets a different
  `sender_hash` from an export than from the collector, and a different one again
  from an export made on another phone. When the export shows a phone number
  instead of a name, the hash input is `<digits>@s.whatsapp.net` (country code
  included, as WhatsApp writes it). That is a guess at the collector's JID form;
  if it matches, those senders line up with collector data. The number itself is
  never sent.
- **Same minute, same sender, same text collide.** Android exports have no
  seconds, so two identical messages from one sender within a minute get the
  same `stanza_id`, and the API counts the second as a duplicate. The CLI prints
  how many collided.
- Changing `--tz` changes `sent_at` and therefore every `stanza_id`. Import each
  export with the right `--tz` the first time.
- Localised exports (system text or `<Media omitted>` in Gujarati or Hindi) are
  not specially handled: localised system lines without `Name: ` are still
  skipped, but localised media markers arrive as `text`.

## Development

```sh
pnpm --filter @insider/export-importer test    # vitest, synthetic exports in src/fixtures.ts
pnpm --filter @insider/export-importer check   # tsc --noEmit
```

`tsconfig.json` uses `moduleResolution: Bundler` instead of the base NodeNext
because `packages/contracts/src/index.ts` imports `./schema` without a file
extension, which NodeNext rejects. The import is type-only, so nothing changes at
runtime. Switch back once contracts uses `./schema.js`.
