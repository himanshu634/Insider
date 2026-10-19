# @insider/spike

Phase 0 probe for WhatsApp Desktop's local database. It answers three
questions before the collector is built against it:

1. Can we read `ChatStorage.sqlite` at all, given Full Disk Access?
2. Do the table and column names match what the collector expects (`ZWACHATSESSION`, `ZWAMESSAGE`, `ZWAGROUPMEMBER`, `ZWAMEDIAITEM`)?
3. What do real group messages look like? (CSV for the extraction prototype)

## Run it

```sh
# from the repo root
pnpm --filter @insider/spike probe              # last 7 days
pnpm --filter @insider/spike probe --days 30
pnpm --filter @insider/spike probe --db ./some/ChatStorage.sqlite --out ./probe.csv
pnpm --filter @insider/spike probe --help
```

Needs Node 22 (built-in `node:sqlite`; Node prints an `ExperimentalWarning`
for it, which is harmless).

### Full Disk Access

The default database lives at
`~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`.
macOS blocks reads there until the app running the command (Terminal, iTerm,
VS Code, ...) has **System Settings > Privacy & Security > Full Disk Access**.
Without it the probe stops with a "Permission denied ... Full Disk Access"
message. After granting, quit and reopen that app.

## What it does

1. Copies `ChatStorage.sqlite`, `-wal` and `-shm` into a new temp dir. A
   missing `-wal`/`-shm` is skipped. The live database is never opened.
2. Opens the copy **read-only** with `node:sqlite`.
3. Prints every table name, then row counts and columns (with types) of the
   four tables above. A missing table shows `MISSING`.
4. Lists groups (chat sessions whose JID ends in `@g.us`) with message counts
   and last-message time.
5. Writes group messages from the last N days to CSV (UTF-8 with BOM so
   Excel shows Gujarati correctly) and prints counts per group and per
   `ZMESSAGETYPE`.
6. Deletes the temp copy (`--keep-copy` keeps it).

Queries are built from `PRAGMA table_info`. A column that does not exist is
exported as empty, with a `WARNING: expected columns not found` line. That
output is the Phase 0 schema check: copy it into the collector's
`WhatsAppSchema` notes.

### Assumptions to verify on a real database

These come from public reverse-engineering notes, not from WhatsApp:

- `ZMESSAGEDATE` / `ZLASTMESSAGEDATE` are Core Data timestamps (seconds since
  2001-01-01 UTC). The CSV has both the raw value and `sent_at_utc`; check a
  few against the times shown in the app.
- Group members join via `ZWAMESSAGE.ZGROUPMEMBER -> ZWAGROUPMEMBER.Z_PK`.
- Media joins via `ZWAMESSAGE.ZMEDIAITEM -> ZWAMEDIAITEM.Z_PK`, falling back
  to `ZWAMEDIAITEM.ZMESSAGE -> ZWAMESSAGE.Z_PK`.
- Columns read when present: `ZSTANZAID`, `ZISFROMME`, `ZFROMJID`,
  `ZPUSHNAME`, `ZMESSAGETYPE`, `ZGROUPEVENTTYPE`, `ZTEXT`, `ZMEMBERJID`,
  `ZCONTACTNAME`, `ZMEDIALOCALPATH`, `ZFILESIZE`, `ZTITLE`, `ZPARTNERNAME`.

## Privacy

The CSV contains real private messages and phone-number JIDs.

- The default output goes to `tools/spike/out/` (git-ignored, file mode 600).
- Do not commit it, paste it into tickets, or share it outside the team.
- Delete it once the Phase 0 checks are done.
- Copying while WhatsApp runs can catch a half-written WAL. If counts look
  wrong, quit WhatsApp and run the probe again.
