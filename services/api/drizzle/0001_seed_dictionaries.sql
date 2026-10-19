-- Seed units, the first commodities and a STARTER market list.
-- The real list of mandis the team tracks is still an open decision: edit it from
-- /settings/dictionaries. Insert-only; never overwrites rows that already exist.

INSERT INTO "market_intel"."unit" ("code", "label", "factor_to_quintal", "aliases") VALUES
  ('per_quintal', '₹/quintal', 1,   '["quintal", "qtl", "ક્વિન્ટલ", "क्विंटल", "100 kg"]'),
  ('per_20kg',    '₹/20 kg',   5,   '["20 kg", "20kg", "man", "maund", "મણ", "मण"]'),
  ('per_kg',      '₹/kg',      100, '["kg", "kilo", "કિલો", "किलो"]')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "market_intel"."commodity" ("slug", "name", "varieties", "synonyms") VALUES
  ('castor',    'Castor',    '["castor seed"]',             '["એરંડા", "એરંડો", "દિવેલા", "divela", "erandi", "arandi", "एरंडी", "अरंडी"]'),
  ('groundnut', 'Groundnut', '["bold", "java", "g20", "g2"]', '["મગફળી", "મગફળ", "singdana", "sing", "magfali", "मूंगफली", "मूँगफली"]')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "market_intel"."market" ("slug", "name", "district", "state", "aliases") VALUES
  ('rajkot',   'Rajkot',   'Rajkot',      'Gujarat', '["રાજકોટ", "राजकोट"]'),
  ('gondal',   'Gondal',   'Rajkot',      'Gujarat', '["ગોંડલ", "गोंडल"]'),
  ('junagadh', 'Junagadh', 'Junagadh',    'Gujarat', '["જૂનાગઢ", "जूनागढ़"]'),
  ('jamnagar', 'Jamnagar', 'Jamnagar',    'Gujarat', '["જામનગર", "जामनगर"]'),
  ('deesa',    'Deesa',    'Banaskantha', 'Gujarat', '["ડીસા", "डीसा"]'),
  ('patan',    'Patan',    'Patan',       'Gujarat', '["પાટણ", "पाटण"]')
ON CONFLICT ("slug") DO NOTHING;
