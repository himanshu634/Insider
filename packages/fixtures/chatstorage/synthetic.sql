-- =============================================================================================
-- SYNTHETIC WhatsApp ChatStorage fixture. NOT REAL DATA.
--
-- Every name, phone number, JID, stanza ID and message below is made up for tests and local
-- development. Phase 0 replaces this file with an anonymised snapshot of a real ChatStorage.sqlite.
--
-- Table and column names follow apps/collector/src/core/whatsapp-schema.ts, which is itself a
-- best guess from public tools; it is UNCONFIRMED until Phase 0 checks it against a real database.
--
-- Build it with:  sqlite3 "$INSIDER_WA_DB" < packages/fixtures/chatstorage/synthetic.sql
-- Plain SQL only (no sqlite3 dot-commands): the collector tests load it with node:sqlite db.exec().
--
-- Dates are Core Data timestamps: seconds since 2001-01-01T00:00:00Z (Apple epoch).
-- 814073400 = 2026-10-19T03:30:00Z = 09:00 IST.
--
-- ZFLAGS bit 0x100 (256) marks a forwarded message (guessed, see whatsapp-schema.ts).
-- ZMESSAGETYPE: 0 text, 1 image, 6 system, 15 sticker (guessed, see whatsapp-schema.ts).
-- =============================================================================================

DROP TABLE IF EXISTS ZWAMEDIAITEM;
DROP TABLE IF EXISTS ZWAMESSAGE;
DROP TABLE IF EXISTS ZWAGROUPMEMBER;
DROP TABLE IF EXISTS ZWACHATSESSION;

CREATE TABLE ZWACHATSESSION (
  Z_PK INTEGER PRIMARY KEY,
  Z_ENT INTEGER,
  Z_OPT INTEGER,
  ZSESSIONTYPE INTEGER,
  ZARCHIVED INTEGER,
  ZLASTMESSAGEDATE TIMESTAMP,
  ZCONTACTJID VARCHAR,
  ZPARTNERNAME VARCHAR
);

CREATE TABLE ZWAGROUPMEMBER (
  Z_PK INTEGER PRIMARY KEY,
  Z_ENT INTEGER,
  Z_OPT INTEGER,
  ZISACTIVE INTEGER,
  ZCHATSESSION INTEGER,
  ZMEMBERJID VARCHAR,
  ZCONTACTNAME VARCHAR
);

CREATE TABLE ZWAMESSAGE (
  Z_PK INTEGER PRIMARY KEY,
  Z_ENT INTEGER,
  Z_OPT INTEGER,
  ZISFROMME INTEGER,
  ZMESSAGETYPE INTEGER,
  ZFLAGS INTEGER,
  ZCHATSESSION INTEGER,
  ZGROUPMEMBER INTEGER,
  ZMEDIAITEM INTEGER,
  ZPARENTMESSAGE INTEGER,
  ZMESSAGEDATE TIMESTAMP,
  ZSTANZAID VARCHAR,
  ZTEXT VARCHAR
);

CREATE TABLE ZWAMEDIAITEM (
  Z_PK INTEGER PRIMARY KEY,
  Z_ENT INTEGER,
  Z_OPT INTEGER,
  ZMESSAGE INTEGER,
  ZFILESIZE INTEGER,
  ZMEDIALOCALPATH VARCHAR,
  ZTITLE VARCHAR
);

CREATE INDEX ZWAMESSAGE_ZCHATSESSION_INDEX ON ZWAMESSAGE (ZCHATSESSION);
CREATE INDEX ZWAGROUPMEMBER_ZCHATSESSION_INDEX ON ZWAGROUPMEMBER (ZCHATSESSION);

-- Chats: three groups (ZSESSIONTYPE 1) and one 1:1 chat (ZSESSIONTYPE 0) that the collector must ignore.
INSERT INTO ZWACHATSESSION (Z_PK, Z_ENT, Z_OPT, ZSESSIONTYPE, ZARCHIVED, ZLASTMESSAGEDATE, ZCONTACTJID, ZPARTNERNAME) VALUES
  (1, 3, 1, 1, 0, 814075600, '120363000000000001@g.us', 'Gondal Castor Rates'),
  (2, 3, 1, 1, 0, 814075800, '120363000000000002@g.us', 'Rajkot Groundnut Bazaar'),
  (3, 3, 1, 1, 0, 814075400, '120363000000000003@g.us', 'ગુજરાત મંડી ભાવ'),
  (4, 3, 1, 0, 0, 814075000, '910000000999@s.whatsapp.net', 'Synthetic Direct Contact');

-- Members (fake numbers in the 9100000xxxxx range). 910000000102 and 910000000103 sit in two groups.
INSERT INTO ZWAGROUPMEMBER (Z_PK, Z_ENT, Z_OPT, ZISACTIVE, ZCHATSESSION, ZMEMBERJID, ZCONTACTNAME) VALUES
  (1, 5, 1, 1, 1, '910000000101@s.whatsapp.net', 'Ramesh Bhai Gondal'),
  (2, 5, 1, 1, 1, '910000000102@s.whatsapp.net', 'Kishan Traders'),
  (3, 5, 1, 1, 1, '910000000103@s.whatsapp.net', 'Mahesh Dalal'),
  (4, 5, 1, 1, 2, '910000000201@s.whatsapp.net', 'Rajkot Sing Broker'),
  (5, 5, 1, 1, 2, '910000000202@s.whatsapp.net', 'Bhavesh Oil Mill'),
  (6, 5, 1, 1, 2, '910000000102@s.whatsapp.net', 'Kishan Traders'),
  (7, 5, 1, 1, 3, '910000000301@s.whatsapp.net', 'ભાવેશ પટેલ'),
  (8, 5, 1, 1, 3, '910000000103@s.whatsapp.net', 'Mahesh Dalal');

-- Messages, in Z_PK (insertion) order. Times run from 09:00 IST onwards.
INSERT INTO ZWAMESSAGE (Z_PK, Z_ENT, Z_OPT, ZISFROMME, ZMESSAGETYPE, ZFLAGS, ZCHATSESSION, ZGROUPMEMBER, ZMEDIAITEM, ZPARENTMESSAGE, ZMESSAGEDATE, ZSTANZAID, ZTEXT) VALUES
  (1,  9, 1, 0, 0,  0,   1, 1,    NULL, NULL, 814073400, 'SYNTH-G1-0001', 'જય શ્રી કૃષ્ણ 🙏 સુપ્રભાત'),
  (2,  9, 1, 0, 0,  0,   2, 4,    NULL, NULL, 814073460, 'SYNTH-G2-0001', 'Good morning sabh ne'),
  (3,  9, 1, 0, 0,  0,   1, 2,    NULL, NULL, 814073700, 'SYNTH-G1-0002', 'એરંડા 1250-1290 ગોંડલ'),
  (4,  9, 1, 0, 0,  0,   4, NULL, NULL, NULL, 814073720, 'SYNTH-DM-0001', 'Kal maal moklu chhu'),
  (5,  9, 1, 0, 0,  0,   2, 5,    NULL, NULL, 814073820, 'SYNTH-G2-0002', 'singdana bold 1100-1180 per 20kg Rajkot'),
  (6,  9, 1, 0, 0,  0,   3, 7,    NULL, NULL, 814073880, 'SYNTH-G3-0001', 'આજના ભાવ:
એરંડા 1260-1295 ડીસા
મગફળી જાડી 1120-1210 જૂનાગઢ'),
  (7,  9, 1, 0, 0,  0,   1, 3,    NULL, NULL, 814074000, 'SYNTH-G1-0003', 'Arenda aavak 45000 guni Gondal, bhav 1255-1292'),
  (8,  9, 1, 0, 1,  0,   2, 6,    1,    NULL, 814074060, 'SYNTH-G2-0003', 'aaj na bhav'),
  (9,  9, 1, 0, 0,  256, 1, 2,    NULL, NULL, 814074300, 'SYNTH-G1-0004', 'Castor Gujarat average 1270, market steady'),
  (10, 9, 1, 0, 0,  256, 3, 8,    NULL, NULL, 814074305, 'SYNTH-G3-0002', 'Castor Gujarat average 1270, market steady'),
  (11, 9, 1, 1, 0,  0,   2, NULL, NULL, NULL, 814074400, 'SYNTH-G2-0004', 'Thank you, update aapta rejo'),
  (12, 9, 1, 0, 0,  0,   1, 1,    NULL, 3,    814074600, 'SYNTH-G1-0005', 'Kale karta 10 rupiya upar'),
  (13, 9, 1, 0, 6,  0,   3, NULL, NULL, NULL, 814074700, 'SYNTH-G3-0003', NULL),
  (14, 9, 1, 0, 0,  0,   2, 4,    NULL, NULL, 814074900, 'SYNTH-G2-0005', 'Sing G20 1050-1140, 66 no. 1150-1230 Rajkot yard'),
  (15, 9, 1, 1, 0,  0,   4, NULL, NULL, NULL, 814075000, 'SYNTH-DM-0002', 'Ok'),
  (16, 9, 1, 0, 0,  0,   1, 3,    NULL, NULL, 814075200, 'SYNTH-G1-0006', 'Gondal arenda close 1260-1288'),
  (17, 9, 1, 0, 0,  0,   3, 7,    NULL, NULL, 814075400, 'SYNTH-G3-0004', 'શુભ દિવસ, ભાવ સ્થિર'),
  (18, 9, 1, 0, 0,  0,   2, 5,    NULL, NULL, 814075500, 'SYNTH-G2-0006', 'Telia dabba 2450 Rajkot'),
  (19, 9, 1, 0, 15, 0,   1, 2,    NULL, NULL, 814075600, 'SYNTH-G1-0007', NULL),
  (20, 9, 1, 0, 0,  0,   2, 6,    NULL, NULL, 814075800, 'SYNTH-G2-0007', 'singdana java 1180-1260 per 20 kg');

-- One image (message 8).
INSERT INTO ZWAMEDIAITEM (Z_PK, Z_ENT, Z_OPT, ZMESSAGE, ZFILESIZE, ZMEDIALOCALPATH, ZTITLE) VALUES
  (1, 7, 1, 8, 84213, 'Media/120363000000000002@g.us/0/a/SYNTH-0001.jpg', NULL);
