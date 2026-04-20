-- Phase 3 test data — run via:
--   docker exec -i ssm_postgres psql -U ssm_user -d ssm_db < database/seeders/seed_phase3.sql

BEGIN;

-- ── Categories ────────────────────────────────────────────────────────────────
INSERT INTO categories (name, icon_url, is_active) VALUES
  ('Tutoring',       NULL, true),
  ('Laundry',        NULL, true),
  ('Photography',    NULL, true),
  ('Delivery',       NULL, true),
  ('Graphic Design', NULL, true),
  ('Hair & Beauty',  NULL, true),
  ('Cleaning',       NULL, true),
  ('Tech Support',   NULL, true)
ON CONFLICT (name) DO NOTHING;

-- ── Providers ─────────────────────────────────────────────────────────────────
-- All passwords = Password123!  (bcrypt generated via pgcrypto)
WITH inserted_users AS (
  INSERT INTO users (id, email, password_hash, role, is_verified, v_reviews, r_raw, completion_rate, last_active_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), 'chanda.mwale@students.unza.zm',   crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true, 23, 4.80, 0.96, NOW() - INTERVAL '2 hours',  NOW(), NOW()),
    (gen_random_uuid(), 'mutale.banda@cbu.ac.zm',          crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true, 15, 4.60, 0.90, NOW() - INTERVAL '5 hours',  NOW(), NOW()),
    (gen_random_uuid(), 'naomi.phiri@mu.ac.zm',            crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true, 41, 4.90, 0.98, NOW() - INTERVAL '1 hour',   NOW(), NOW()),
    (gen_random_uuid(), 'bwalya.tembo@students.unza.zm',   crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true,  8, 4.20, 0.85, NOW() - INTERVAL '20 hours', NOW(), NOW()),
    (gen_random_uuid(), 'chisomo.nkonde@lamu.edu.zm',      crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true, 12, 4.50, 0.92, NOW() - INTERVAL '3 hours',  NOW(), NOW()),
    (gen_random_uuid(), 'kelvin.mulenga@cbu.ac.zm',        crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true,  4, 3.80, 0.75, NOW() - INTERVAL '48 hours', NOW(), NOW()),
    (gen_random_uuid(), 'thandiwe.lungu@mu.ac.zm',         crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true, 29, 4.70, 0.94, NOW() - INTERVAL '6 hours',  NOW(), NOW()),
    (gen_random_uuid(), 'aaron.zulu@students.unza.zm',     crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true,  0, 0.00, 1.00, NOW() - INTERVAL '1 hour',   NOW(), NOW()),
    (gen_random_uuid(), 'mwaka.siame@lamu.edu.zm',         crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true,  6, 4.30, 0.88, NOW() - INTERVAL '12 hours', NOW(), NOW()),
    (gen_random_uuid(), 'grace.mwansa@students.unza.zm',   crypt('Password123!', gen_salt('bf',10)), 'PROVIDER', true, 18, 4.40, 0.91, NOW() - INTERVAL '4 hours',  NOW(), NOW())
  ON CONFLICT (email) DO NOTHING
  RETURNING id, email
)
-- ── Provider profiles ─────────────────────────────────────────────────────────
INSERT INTO provider_profiles (user_id, nrc_number, student_id_url, kyc_status, momo_provider, momo_number, base_location_lat, base_location_lng, max_radius_km, availability_matrix, profile_completeness, created_at, updated_at)
SELECT
  u.id,
  p.nrc,
  'kyc/sample_id.jpg',
  'VERIFIED',
  p.momo_provider,
  p.momo_number,
  p.lat,
  p.lng,
  p.max_radius,
  p.avail::jsonb,
  100,
  NOW(),
  NOW()
FROM inserted_users u
JOIN (VALUES
  ('chanda.mwale@students.unza.zm',  '123456/10/1', 'MTN',    '0971000001', -15.4160,  28.2820, 7,  '{"MON":[{"start":"08:00","end":"17:00"}],"TUE":[{"start":"08:00","end":"17:00"}],"WED":[{"start":"08:00","end":"12:00"}],"THU":[{"start":"08:00","end":"17:00"}],"FRI":[{"start":"08:00","end":"15:00"}],"SAT":[{"start":"09:00","end":"13:00"}],"SUN":[]}'),
  ('mutale.banda@cbu.ac.zm',         '234567/10/2', 'AIRTEL', '0961000002', -15.3980,  28.3100, 5,  '{"MON":[{"start":"09:00","end":"18:00"}],"TUE":[],"WED":[{"start":"09:00","end":"18:00"}],"THU":[{"start":"09:00","end":"18:00"}],"FRI":[{"start":"09:00","end":"16:00"}],"SAT":[{"start":"10:00","end":"14:00"}],"SUN":[]}'),
  ('naomi.phiri@mu.ac.zm',           '345678/10/3', 'MTN',    '0977000003', -15.4400,  28.3200, 10, '{"MON":[{"start":"07:00","end":"19:00"}],"TUE":[{"start":"07:00","end":"19:00"}],"WED":[{"start":"07:00","end":"19:00"}],"THU":[{"start":"07:00","end":"19:00"}],"FRI":[{"start":"07:00","end":"17:00"}],"SAT":[{"start":"08:00","end":"15:00"}],"SUN":[{"start":"10:00","end":"14:00"}]}'),
  ('bwalya.tembo@students.unza.zm',  '456789/10/4', 'ZAMTEL', '0951000004', -15.4000,  28.3400, 5,  '{"MON":[],"TUE":[{"start":"14:00","end":"20:00"}],"WED":[{"start":"14:00","end":"20:00"}],"THU":[{"start":"14:00","end":"20:00"}],"FRI":[{"start":"14:00","end":"20:00"}],"SAT":[{"start":"09:00","end":"17:00"}],"SUN":[{"start":"09:00","end":"15:00"}]}'),
  ('chisomo.nkonde@lamu.edu.zm',     '567890/10/5', 'MTN',    '0976000005', -15.3700,  28.3500, 8,  '{"MON":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}],"TUE":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}],"WED":[{"start":"08:00","end":"12:00"}],"THU":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}],"FRI":[{"start":"08:00","end":"12:00"}],"SAT":[],"SUN":[]}'),
  ('kelvin.mulenga@cbu.ac.zm',       '678901/10/6', 'AIRTEL', '0962000006', -15.4200,  28.3150, 4,  '{"MON":[{"start":"15:00","end":"20:00"}],"TUE":[{"start":"15:00","end":"20:00"}],"WED":[],"THU":[{"start":"15:00","end":"20:00"}],"FRI":[{"start":"15:00","end":"20:00"}],"SAT":[{"start":"10:00","end":"18:00"}],"SUN":[{"start":"10:00","end":"16:00"}]}'),
  ('thandiwe.lungu@mu.ac.zm',        '789012/10/7', 'MTN',    '0973000007', -15.4100,  28.3250, 6,  '{"MON":[{"start":"08:00","end":"18:00"}],"TUE":[{"start":"08:00","end":"18:00"}],"WED":[{"start":"08:00","end":"18:00"}],"THU":[{"start":"08:00","end":"18:00"}],"FRI":[{"start":"08:00","end":"16:00"}],"SAT":[{"start":"09:00","end":"14:00"}],"SUN":[]}'),
  ('aaron.zulu@students.unza.zm',    '890123/10/8', 'MTN',    '0975000008', -15.3900,  28.2900, 5,  '{"MON":[{"start":"09:00","end":"17:00"}],"TUE":[{"start":"09:00","end":"17:00"}],"WED":[{"start":"09:00","end":"17:00"}],"THU":[{"start":"09:00","end":"17:00"}],"FRI":[{"start":"09:00","end":"17:00"}],"SAT":[],"SUN":[]}'),
  ('mwaka.siame@lamu.edu.zm',        '901234/10/9', 'AIRTEL', '0963000009', -15.4500,  28.3400, 7,  '{"MON":[{"start":"10:00","end":"19:00"}],"TUE":[{"start":"10:00","end":"19:00"}],"WED":[],"THU":[{"start":"10:00","end":"19:00"}],"FRI":[{"start":"10:00","end":"19:00"}],"SAT":[{"start":"10:00","end":"16:00"}],"SUN":[{"start":"11:00","end":"15:00"}]}'),
  ('grace.mwansa@students.unza.zm',  '012345/10/0', 'MTN',    '0978000010', -15.4300,  28.3500, 6,  '{"MON":[{"start":"07:30","end":"16:30"}],"TUE":[{"start":"07:30","end":"16:30"}],"WED":[{"start":"07:30","end":"16:30"}],"THU":[{"start":"07:30","end":"16:30"}],"FRI":[{"start":"07:30","end":"14:00"}],"SAT":[{"start":"09:00","end":"13:00"}],"SUN":[]}')
) AS p(email, nrc, momo_provider, momo_number, lat, lng, max_radius, avail)
  ON u.email = p.email
ON CONFLICT (user_id) DO NOTHING;

-- ── Services (with PostGIS locations) ─────────────────────────────────────────
WITH svc_data AS (
  SELECT
    gen_random_uuid()                       AS id,
    u.id                                    AS provider_id,
    c.id                                    AS category_id,
    s.title,
    s.description,
    s.price::numeric(10,2)                  AS base_price,
    ST_GeogFromText('POINT(' || s.lng::text || ' ' || s.lat::text || ')') AS service_location,
    NOW() - (random() * INTERVAL '30 days') AS created_at
  FROM (VALUES
    -- Tutoring
    ('chanda.mwale@students.unza.zm',  'Tutoring',       'Grade 12 Mathematics & Physics Tutoring',    'Experienced tutor offering one-on-one sessions for ECZ Mathematics and Physics. Past exam papers covered.',  120, -15.4155, 28.2835),
    ('mutale.banda@cbu.ac.zm',         'Tutoring',       'University-Level Accounting & Finance',       'CBU 3rd-year Accountancy student offering tutoring for ACCA F1-F3 and university accounting modules.',       150, -15.3990, 28.3095),
    ('thandiwe.lungu@mu.ac.zm',        'Tutoring',       'English & Literature — All Grades',           'Patient and thorough English tutor. Essay writing, comprehension, and grammar for grades 8–12.',            100, -15.4108, 28.3240),
    ('grace.mwansa@students.unza.zm',  'Tutoring',       'ICT & Computer Studies Tutoring',             'Covering Microsoft Office, basic programming, and ECZ Computer Studies syllabus.',                          90,  -15.4295, 28.3495),
    -- Laundry
    ('naomi.phiri@mu.ac.zm',           'Laundry',        'Same-Day Laundry & Ironing Service',         'Wash, dry and iron. Pickup and delivery within Kabulonga and surrounding areas. Minimum 5 items.',          60,  -15.4390, 28.3210),
    ('chisomo.nkonde@lamu.edu.zm',     'Laundry',        'Student Hostel Laundry Pickup',               'Regular laundry service for hostel students. Weekly or bi-weekly plans available.',                         45,  -15.3720, 28.3480),
    ('mwaka.siame@lamu.edu.zm',        'Laundry',        'Delicate & Hand-Wash Laundry',                'Specialising in hand-washing delicate fabrics, uniforms, and formal wear. Ironing included.',               75,  -15.4490, 28.3390),
    -- Photography
    ('naomi.phiri@mu.ac.zm',           'Photography',    'Event & Graduation Photography',              'Professional-quality photos for graduations, birthday parties, and corporate events. 100+ edited photos.',  500, -15.4410, 28.3185),
    ('thandiwe.lungu@mu.ac.zm',        'Photography',    'Passport & ID Photo Session',                 'Quick 30-minute passport and ID photo sessions. Same-day digital and printed delivery.',                    80,  -15.4095, 28.3265),
    ('bwalya.tembo@students.unza.zm',  'Photography',    'Product & E-commerce Photography',            'Clean white-background product shots for online shops. Minimum 10 items per session.',                     350, -15.4010, 28.3420),
    -- Delivery
    ('kelvin.mulenga@cbu.ac.zm',       'Delivery',       'Same-Day Document & Parcel Delivery',         'Fast motorbike delivery for documents and small parcels within Lusaka. Real-time updates.',                 40,  -15.4205, 28.3140),
    ('aaron.zulu@students.unza.zm',    'Delivery',       'Grocery & Essentials Delivery',               'Shop and deliver groceries from Shoprite, Pick n Pay, or Spar. Delivery fee + 10% service charge.',        35,  -15.3905, 28.2910),
    ('chanda.mwale@students.unza.zm',  'Delivery',       'Campus Errand & Pickup Service',              'Collect printed assignments, library books, and campus errands. UNZA and Evelyn Hone area.',               25,  -15.4145, 28.2850),
    -- Graphic Design
    ('bwalya.tembo@students.unza.zm',  'Graphic Design', 'Logo & Brand Identity Design',                'Professional logo design with 3 initial concepts, unlimited revisions, and all final file formats.',        400, -15.4005, 28.3410),
    ('kelvin.mulenga@cbu.ac.zm',       'Graphic Design', 'Flyers, Posters & Social Media Graphics',    'Eye-catching marketing materials for events and businesses. 24-hour turnaround.',                          120, -15.4215, 28.3130),
    ('grace.mwansa@students.unza.zm',  'Graphic Design', 'Academic & Business Presentation Design',    'PowerPoint and Canva presentations that stand out. Includes animations and custom graphics.',               180, -15.4285, 28.3510),
    -- Hair & Beauty
    ('chisomo.nkonde@lamu.edu.zm',     'Hair & Beauty',  'Natural Hair Braiding & Styling',             'Box braids, cornrows, twists and natural hair care. Home service available in Chelston area.',             200, -15.3710, 28.3490),
    ('grace.mwansa@students.unza.zm',  'Hair & Beauty',  'Makeup Artistry — Events & Occasions',       'Full glam, natural and bridal makeup. Includes lashes. Chilenje and Kabulonga areas.',                     300, -15.4310, 28.3490),
    ('thandiwe.lungu@mu.ac.zm',        'Hair & Beauty',  'Men''s Haircut & Grooming (Home Visit)',      'Professional barber service at your location. Fade, taper, and beard grooming.',                           80,  -15.4115, 28.3240),
    -- Cleaning
    ('naomi.phiri@mu.ac.zm',           'Cleaning',       'Student Room & Apartment Deep Clean',         'Thorough cleaning of studio apartments and student rooms. Supplies included. 2–4 hour service.',           180, -15.4395, 28.3195),
    ('aaron.zulu@students.unza.zm',    'Cleaning',       'Weekly House Cleaning Service',               'Reliable weekly cleaning for 2–3 bedroom houses. Sweeping, mopping, dusting and bathroom cleaning.',       150, -15.3895, 28.2895),
    ('mwaka.siame@lamu.edu.zm',        'Cleaning',       'Post-Event Cleanup',                          'Quick and thorough cleanup after parties, graduations and events. Team of 2 available.',                   250, -15.4495, 28.3395),
    -- Tech Support
    ('mutale.banda@cbu.ac.zm',         'Tech Support',   'Laptop Repair & Software Troubleshooting',   'Windows reinstall, virus removal, software setup, and hardware diagnostics. On-site or drop-off.',         150, -15.3985, 28.3110),
    ('chanda.mwale@students.unza.zm',  'Tech Support',   'Wi-Fi Network Setup & Configuration',         'Home and office router setup, Wi-Fi extender installation, and network security configuration.',           200, -15.4150, 28.2830),
    ('bwalya.tembo@students.unza.zm',  'Tech Support',   'Phone Screen Repair (Android)',               'Cracked screen replacement for popular Android models. Genuine parts. 1-day turnaround.',                 350, -15.4020, 28.3380),
    ('kelvin.mulenga@cbu.ac.zm',       'Tech Support',   'Data Recovery & Backup Service',              'Recover deleted files from laptops, phones, and USB drives. No recovery, no charge.',                     180, -15.4210, 28.3170)
  ) AS s(email, category_name, title, description, price, lat, lng)
  JOIN users u ON u.email = s.email
  JOIN categories c ON c.name = s.category_name
)
INSERT INTO services (id, provider_id, category_id, title, description, base_price, is_active, service_location, created_at, updated_at)
SELECT id, provider_id, category_id, title, description, base_price, true, service_location, created_at, NOW()
FROM svc_data
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify
SELECT
  (SELECT COUNT(*) FROM users    WHERE role = 'PROVIDER') AS providers,
  (SELECT COUNT(*) FROM provider_profiles WHERE kyc_status = 'VERIFIED') AS verified_profiles,
  (SELECT COUNT(*) FROM categories) AS categories,
  (SELECT COUNT(*) FROM services WHERE is_active = true) AS services;
