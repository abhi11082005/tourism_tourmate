-- =====================================================================
-- 0003_seed.sql — demo data (Jaipur). Idempotent: safe to re-run.
--   psql "$DATABASE_URL" -f db/migrations/0003_seed.sql
-- =====================================================================

BEGIN;

-- Demo password for both accounts: "TourMate#2026".
-- Hashed here with pgcrypto's bcrypt (gen_salt('bf',12)) so no fake hash ships
-- in source; node's bcrypt.compare verifies these $2a$ hashes fine.
INSERT INTO users (id, email, password_hash, full_name, role) VALUES
  ('00000000-0000-4000-8000-0000000ad001', 'admin@tourmate.dev',
   crypt('TourMate#2026', gen_salt('bf', 12)), 'Ops Admin', 'ADMIN'),
  ('00000000-0000-4000-8000-0000000ee001', 'meera.guide@tourmate.dev',
   crypt('TourMate#2026', gen_salt('bf', 12)), 'Meera Sharma', 'GUIDE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO attractions
  (id, name, category, description, location, image_url, city,
   scenic_score, noise_score, crowd_score, mood_tags, avg_visit_min)
VALUES
  ('11111111-1111-4111-8111-000000000001', 'Amber Fort', 'MUST_VISIT',
   'Hilltop Rajput fort with mirrored halls and a cobbled elephant ascent.',
   ST_SetSRID(ST_MakePoint(75.8513, 26.9855), 4326),
   'https://res.cloudinary.com/demo/image/upload/amber-fort.jpg', 'Jaipur',
   0.95, 0.55, 0.85, ARRAY['scenic','historic','crowded'], 120),
  ('11111111-1111-4111-8111-000000000002', 'Hawa Mahal', 'MUST_VISIT',
   'Five-storey palace of winds with 953 latticed windows.',
   ST_SetSRID(ST_MakePoint(75.8267, 26.9239), 4326),
   'https://res.cloudinary.com/demo/image/upload/hawa-mahal.jpg', 'Jaipur',
   0.85, 0.80, 0.90, ARRAY['scenic','historic','crowded'], 45),
  ('11111111-1111-4111-8111-000000000003', 'Rawat Mishthan Bhandar', 'MUST_EAT',
   'Institution for pyaaz kachori and Rajasthani sweets.',
   ST_SetSRID(ST_MakePoint(75.8010, 26.9207), 4326),
   'https://res.cloudinary.com/demo/image/upload/rawat.jpg', 'Jaipur',
   0.35, 0.85, 0.80, ARRAY['food','lively','crowded'], 30),
  ('11111111-1111-4111-8111-000000000004', 'Nahargarh Sunset Point', 'MUST_VISIT',
   'Quiet ridge looking over the whole city at golden hour.',
   ST_SetSRID(ST_MakePoint(75.8153, 26.9375), 4326),
   'https://res.cloudinary.com/demo/image/upload/nahargarh.jpg', 'Jaipur',
   0.98, 0.15, 0.30, ARRAY['calm','quiet','scenic'], 60),
  ('11111111-1111-4111-8111-000000000005', 'Chokhi Dhani Rides', 'FAMOUS_RIDE',
   'Camel carts, zip line and village-fair rides after dark.',
   ST_SetSRID(ST_MakePoint(75.7833, 26.7500), 4326),
   'https://res.cloudinary.com/demo/image/upload/chokhi-dhani.jpg', 'Jaipur',
   0.60, 0.90, 0.85, ARRAY['lively','family','crowded'], 180),
  ('11111111-1111-4111-8111-000000000006', 'Jal Mahal Boat Ride', 'FAMOUS_RIDE',
   'Short boat crossing to the water palace on Man Sagar lake.',
   ST_SetSRID(ST_MakePoint(75.8465, 26.9535), 4326),
   'https://res.cloudinary.com/demo/image/upload/jal-mahal.jpg', 'Jaipur',
   0.90, 0.35, 0.55, ARRAY['calm','scenic','water'], 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tours (
  id, title, slug, overview, tour_type, base_price, total_seats,
  duration_days, duration_nights, start_point,
  itinerary, inclusions, exclusions, options, gallery, refund_policy, is_published
) VALUES (
  '22222222-2222-4222-8222-000000000001',
  'Pink City Heritage Trail',
  'pink-city-heritage-trail',
  'Three days across Jaipur''s forts, bazaars and rooftop kitchens with a local guide.',
  'HERITAGE', 8499.00, 24, 3, 2,
  ST_SetSRID(ST_MakePoint(75.7873, 26.9124), 4326),
  '[{"day":1,"title":"Old City & Hawa Mahal","summary":"Bazaar walk, palace of winds, evening chaat.",
     "stops":["Hawa Mahal","Rawat Mishthan Bhandar"]},
    {"day":2,"title":"Amber & Nahargarh","summary":"Fort morning, sunset over the ridge.",
     "stops":["Amber Fort","Nahargarh Sunset Point"]},
    {"day":3,"title":"Lake & village fair","summary":"Boat crossing, then rides after dark.",
     "stops":["Jal Mahal Boat Ride","Chokhi Dhani Rides"]}]'::jsonb,
  '["Licensed local guide","All monument entry fees","Daily breakfast","Airport pickup & drop"]'::jsonb,
  '["Airfare","Personal shopping","Travel insurance","Camera fees at monuments"]'::jsonb,
  -- The pricing configurator reads this and ONLY this. The server recomputes
  -- every total from these numbers; the client price is display-only.
  '{"ac":{"label":"AC coach","type":"boolean","pricePerSeat":900},
    "hotelTier":{"label":"Hotel","type":"enum","default":"standard","choices":[
      {"value":"standard","label":"Standard (3*)","pricePerSeat":0},
      {"value":"deluxe","label":"Deluxe AC (4*)","pricePerSeat":2400},
      {"value":"heritage","label":"Heritage haveli","pricePerSeat":4600}]},
    "mealPlan":{"label":"Meals","type":"enum","default":"none","choices":[
      {"value":"none","label":"Breakfast only","pricePerSeat":0},
      {"value":"veg","label":"Veg thali lunch + dinner","pricePerSeat":1200},
      {"value":"deluxe","label":"Deluxe multi-cuisine","pricePerSeat":2100}]},
    "photographer":{"label":"Photo walk","type":"boolean","pricePerSeat":650}}'::jsonb,
  '[{"url":"https://res.cloudinary.com/demo/image/upload/jaipur-1.jpg","alt":"City Palace courtyard"},
    {"url":"https://res.cloudinary.com/demo/image/upload/jaipur-2.jpg","alt":"Amber Fort ramparts"}]'::jsonb,
  '[{"daysBefore":7,"refundPercent":100},{"daysBefore":3,"refundPercent":50},
    {"daysBefore":0,"refundPercent":0}]'::jsonb,
  TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO tour_attractions (tour_id, attraction_id, visit_order)
SELECT '22222222-2222-4222-8222-000000000001', a.id,
       ROW_NUMBER() OVER (ORDER BY a.name)
FROM attractions a
ON CONFLICT DO NOTHING;

-- Open the next 30 departure dates; weekends cost more and get a guide.
INSERT INTO tour_slots (tour_id, slot_date, total_seats, price_modifier, guide_id)
SELECT '22222222-2222-4222-8222-000000000001',
       d::date,
       CASE WHEN EXTRACT(ISODOW FROM d) IN (6, 7) THEN 30 ELSE 24 END,
       CASE WHEN EXTRACT(ISODOW FROM d) IN (6, 7) THEN 750 ELSE 0 END,
       CASE WHEN EXTRACT(ISODOW FROM d) IN (6, 7)
            THEN '00000000-0000-4000-8000-0000000ee001'::uuid END
FROM generate_series(CURRENT_DATE + 2, CURRENT_DATE + 31, INTERVAL '1 day') d
ON CONFLICT (tour_id, slot_date) DO NOTHING;

-- RAG passages. embedding stays NULL until `npm run rag:index` fills it in.
INSERT INTO tour_chunks (tour_id, kind, ref, content)
SELECT t.id, 'overview', NULL, t.title || E'\n' || t.overview FROM tours t
UNION ALL
SELECT t.id, 'itinerary_day', 'day:' || (d->>'day'),
       'Day ' || (d->>'day') || ' — ' || (d->>'title') || ': ' || COALESCE(d->>'summary','')
FROM tours t, jsonb_array_elements(t.itinerary) d
UNION ALL
SELECT t.id, 'options', NULL,
       'Upgrade options and per-seat prices: ' || t.options::text
FROM tours t
ON CONFLICT DO NOTHING;

COMMIT;
