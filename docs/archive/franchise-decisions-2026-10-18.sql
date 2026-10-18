-- Nils's three franchise calls from the 2026-10-17 sweep, applied 2026-10-18 (TASKS.md item 0 (g)).
-- Run: npx wrangler d1 execute fandex --remote --file ../docs/archive/franchise-decisions-2026-10-18.sql (from worker/).
-- Undo: docs/archive/franchise-decisions-2026-10-18-undo.sql.
--
-- 1. The Joker films join Batman. Their own series ("Joker", TMDB's Joker Collection) they already carry.
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source) VALUES
  ('3d1164ac-672e-42b8-84ee-3930761fcd64', 'batman', 'Batman', 'add', 'manual'),
  ('bafde455-bc9f-4def-b87c-dbc04e12fa35', 'batman', 'Batman', 'add', 'manual')
ON CONFLICT (media_item_id, ip_key) DO NOTHING;
-- 2. The Marvel Cinematic Universe films and shows also join "Marvel" (they keep their own collections).
INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, source) VALUES
  ('67fd7747-8f01-4b72-8313-f1c8e76923ca', 'marvel', 'Marvel', 'add', 'manual'), -- Iron Man
  ('d321089a-5563-4c0e-a501-5bdf233a4b8f', 'marvel', 'Marvel', 'add', 'manual'), -- Iron Man 2
  ('17a05090-3e98-4835-b0c0-f4f9e9683641', 'marvel', 'Marvel', 'add', 'manual'), -- Iron Man 3
  ('f903aeda-98d1-45a7-aeb2-bf64bcf31b77', 'marvel', 'Marvel', 'add', 'manual'), -- The Avengers
  ('33792301-1254-4388-8ef0-af28ad2d9498', 'marvel', 'Marvel', 'add', 'manual'), -- Avengers: Age of Ultron
  ('06158d6f-3035-4024-b00e-beb3e6506520', 'marvel', 'Marvel', 'add', 'manual'), -- Avengers: Infinity War
  ('d5f8e13e-f81e-4a0b-9667-f66c82676d0e', 'marvel', 'Marvel', 'add', 'manual'), -- Avengers: Endgame
  ('3dae44ee-59ec-4d45-a430-e5bf79b85039', 'marvel', 'Marvel', 'add', 'manual'), -- Avengers: Doomsday
  ('d2f4b0b3-6b62-4456-93e0-62bbb7557ba1', 'marvel', 'Marvel', 'add', 'manual'), -- Avengers: Secret Wars
  ('f9fd9be7-9003-44a8-b94d-fa8414ad0956', 'marvel', 'Marvel', 'add', 'manual'), -- Thor
  ('ad2695d0-6809-4d0e-bc9d-107c00cdc80e', 'marvel', 'Marvel', 'add', 'manual'), -- Thor: The Dark World
  ('484d9a8c-2c44-46cf-8970-0ad7f11382c3', 'marvel', 'Marvel', 'add', 'manual'), -- Thor: Ragnarok
  ('c5eca85d-a122-4b00-992c-f880d8f8c538', 'marvel', 'Marvel', 'add', 'manual'), -- Thor: Love and Thunder
  ('6378afb9-0815-4327-b017-b86240e3a4af', 'marvel', 'Marvel', 'add', 'manual'), -- Captain America: The First Avenger
  ('d7962957-fb8b-4443-a323-d6c29ca45360', 'marvel', 'Marvel', 'add', 'manual'), -- Captain America: The Winter Soldier
  ('ccafa9e7-c8c1-4c7e-bbdc-7784bf57d078', 'marvel', 'Marvel', 'add', 'manual'), -- Captain America: Civil War
  ('76fcb94f-9b30-4048-b2b1-0af661af09c2', 'marvel', 'Marvel', 'add', 'manual'), -- Captain America: Brave New World
  ('b2863fba-5fc4-4ac2-9aa3-c2a96182d4e7', 'marvel', 'Marvel', 'add', 'manual'), -- Guardians of the Galaxy
  ('8967127c-396c-43d5-9dd8-4c4fd8ba74db', 'marvel', 'Marvel', 'add', 'manual'), -- Guardians of the Galaxy Vol. 2
  ('08c08f4f-b4dd-4200-9bce-3dbc21fa988e', 'marvel', 'Marvel', 'add', 'manual'), -- Guardians of the Galaxy Vol. 3
  ('053ba552-76ca-48a7-bec0-8e51f5429387', 'marvel', 'Marvel', 'add', 'manual'), -- Doctor Strange
  ('dbe188d8-044c-4e21-90cb-767fc868bfee', 'marvel', 'Marvel', 'add', 'manual'), -- Doctor Strange in the Multiverse of Madness
  ('d2080c50-8b76-4a15-9e2e-0615b9475e53', 'marvel', 'Marvel', 'add', 'manual'), -- Ant-Man
  ('db1fc069-82cd-4fd0-b2aa-52e2bda4dc2a', 'marvel', 'Marvel', 'add', 'manual'), -- Ant-Man and the Wasp
  ('b05bfc3e-deeb-4474-92c0-01a535a891ff', 'marvel', 'Marvel', 'add', 'manual'), -- Ant-Man and the Wasp: Quantumania
  ('2d3cc8e3-56ce-4e9c-ab23-cda497f8b1e0', 'marvel', 'Marvel', 'add', 'manual'), -- Spider-Man: Homecoming
  ('ab1ebde6-6ba0-458d-b967-248f68a1355a', 'marvel', 'Marvel', 'add', 'manual'), -- Spider-Man: Far From Home
  ('9442bd1a-7828-44a7-be43-cd0e1caa6fec', 'marvel', 'Marvel', 'add', 'manual'), -- Deadpool & Wolverine
  ('7b060a27-afb0-4b3a-9cda-531105879670', 'marvel', 'Marvel', 'add', 'manual')  -- Moon Knight (show)
ON CONFLICT (media_item_id, ip_key) DO NOTHING;
