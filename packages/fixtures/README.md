# Fixtures

## `chatstorage/synthetic.sql`: SYNTHETIC, not real data

This file is a made-up stand-in for WhatsApp Desktop's `ChatStorage.sqlite`. It contains the four
tables the collector reads: `ZWACHATSESSION`, `ZWAMESSAGE`, `ZWAGROUPMEMBER` and `ZWAMEDIAITEM`.
The data in them:

- 3 groups: "Gondal Castor Rates", "Rajkot Groundnut Bazaar" and "ગુજરાત મંડી ભાવ"
- 1 one-to-one chat, which the collector must ignore
- 8 group members
- 20 messages from 2026-10-19 (Apple-epoch dates): Gujarati and Gujlish price lists, greetings, a
  forwarded duplicate in two groups, a quoted reply, an own message, a system event, a sticker,
  and one image with a `ZWAMEDIAITEM` row

All names, numbers (`9100000xxxxx`), JIDs and stanza IDs (`SYNTH-…`) are fake.

The table and column names follow `apps/collector/src/core/whatsapp-schema.ts`. They are best
guesses and are **unconfirmed until Phase 0**. Phase 0 will replace this file with an anonymised
snapshot of a real database and correct the schema file if the names differ.

To build it:

```sh
sqlite3 .dev/fixtures/ChatStorage.sqlite < packages/fixtures/chatstorage/synthetic.sql
```

The file is plain SQL with no sqlite3 dot-commands, so the collector tests can also load it with
`node:sqlite`. Each run starts with `DROP TABLE IF EXISTS`, so you can run it again safely.

## `golden/` (Phase 3)

The golden extraction set will go here: about 300 messages labelled with the expected price
observations. It is used to measure extraction precision.
