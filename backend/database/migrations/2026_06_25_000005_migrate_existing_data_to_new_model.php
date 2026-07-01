<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Data migration: populate the new Phase 1 tables from existing data.
 *
 * 1. Seed provider_services from existing services (provider-owned listings).
 * 2. Seed provider_availability from provider_profiles.availability_matrix.
 * 3. Migrate existing DIRECT bookings: set legacy_payment_mode = 'DIRECT',
 *    payment_mode stays 'DIRECT' for backward compat, channel = 'APP'.
 * 4. Seed trust_signals rows for all existing providers.
 * 5. Seed provider_verifications from existing identity_documents.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── 1. Seed provider_services from existing services ─────────────
        // Each service is currently provider-owned (services.provider_id).
        // Create a provider_services row mirroring the service's price/status.
        DB::statement("
            INSERT INTO provider_services (id, provider_id, service_id, price, pricing_model, status, bookings_completed, avg_rating, review_count, created_at, updated_at)
            SELECT
                gen_random_uuid(),
                s.provider_id,
                s.id,
                s.base_price,
                s.pricing_model,
                s.status,
                COALESCE((
                    SELECT COUNT(*) FROM bookings b
                    WHERE b.service_id = s.id AND b.status = 'COMPLETED'
                ), 0),
                (
                    SELECT AVG(r.rating) FROM reviews r
                    JOIN bookings b ON b.id = r.booking_id
                    WHERE b.service_id = s.id
                ),
                COALESCE((
                    SELECT COUNT(*) FROM reviews r
                    JOIN bookings b ON b.id = r.booking_id
                    WHERE b.service_id = s.id
                ), 0),
                NOW(),
                NOW()
            FROM services s
            WHERE NOT EXISTS (
                SELECT 1 FROM provider_services ps
                WHERE ps.provider_id = s.provider_id AND ps.service_id = s.id
            )
        ");

        $psCount = DB::selectOne("SELECT COUNT(*) AS cnt FROM provider_services")->cnt;
        Log::info("Data migration: seeded {$psCount} provider_services rows");

        // ── 2. Seed provider_availability from availability_matrix JSONB ─
        // The existing format is: {"MON": [{"start":"08:00","end":"17:00"}], ...}
        $profiles = DB::select("
            SELECT user_id, availability_matrix
            FROM provider_profiles
            WHERE availability_matrix IS NOT NULL
              AND availability_matrix != 'null'
              AND availability_matrix != '{}'
        ");

        $dayMap = [
            'SUN' => 0, 'MON' => 1, 'TUE' => 2, 'WED' => 3,
            'THU' => 4, 'FRI' => 5, 'SAT' => 6,
        ];

        $availCount = 0;
        foreach ($profiles as $profile) {
            $matrix = json_decode($profile->availability_matrix, true);
            if (! is_array($matrix)) continue;

            foreach ($matrix as $day => $windows) {
                $dayNum = $dayMap[strtoupper($day)] ?? null;
                if ($dayNum === null || ! is_array($windows)) continue;

                foreach ($windows as $window) {
                    if (empty($window['start']) || empty($window['end'])) continue;

                    DB::statement("
                        INSERT INTO provider_availability (id, provider_id, day_of_week, start_time, end_time, is_recurring, is_blocked, created_at, updated_at)
                        VALUES (gen_random_uuid(), ?, ?, ?, ?, true, false, NOW(), NOW())
                    ", [
                        $profile->user_id,
                        $dayNum,
                        $window['start'],
                        $window['end'],
                    ]);
                    $availCount++;
                }
            }
        }

        Log::info("Data migration: seeded {$availCount} provider_availability slots from availability_matrix");

        // ── 3. Migrate existing DIRECT bookings ─────────────────────────
        // Mark all existing DIRECT bookings with legacy_payment_mode so the
        // state machine uses the legacy transition table for them.
        $directCount = DB::update("
            UPDATE bookings
            SET legacy_payment_mode = 'DIRECT',
                channel = 'APP'
            WHERE payment_mode = 'DIRECT'
              AND legacy_payment_mode IS NULL
        ");

        Log::info("Data migration: marked {$directCount} existing DIRECT bookings as legacy");

        // Set channel = 'APP' for any ESCROW bookings that don't have it
        DB::update("
            UPDATE bookings
            SET channel = 'APP'
            WHERE channel IS NULL OR channel = ''
        ");

        // ── 4. Seed trust_signals for existing providers ────────────────
        DB::statement("
            INSERT INTO trust_signals (provider_id, identity_strength, reliability_pct, on_time_pct, dispute_rate, financial_health, bayesian_rating, rating_count, composite_score, created_at, updated_at)
            SELECT
                pp.user_id,
                CASE WHEN pp.trust_tier >= 3 THEN 80.0
                     WHEN pp.trust_tier >= 2 THEN 60.0
                     WHEN pp.trust_tier >= 1 THEN 40.0
                     ELSE 0.0 END,
                COALESCE(100.0 - (pp.cancellation_rate_30d * 100), 50.0),
                50.0,
                0.0,
                50.0,
                COALESCE(u.r_raw, 0.0),
                COALESCE(u.v_reviews, 0),
                COALESCE(pp.trust_score, 0.0),
                NOW(),
                NOW()
            FROM provider_profiles pp
            JOIN users u ON u.id = pp.user_id
            WHERE NOT EXISTS (
                SELECT 1 FROM trust_signals ts WHERE ts.provider_id = pp.user_id
            )
        ");

        $tsCount = DB::selectOne("SELECT COUNT(*) AS cnt FROM trust_signals")->cnt;
        Log::info("Data migration: seeded {$tsCount} trust_signals rows");

        // ── 5. Seed provider_verifications from identity_documents ──────
        DB::statement("
            INSERT INTO provider_verifications (id, provider_id, verification_type, status, metadata, verified_at, created_at, updated_at)
            SELECT
                gen_random_uuid(),
                id_doc.user_id,
                CASE id_doc.doc_type
                    WHEN 'NRC'              THEN 'nrc'
                    WHEN 'PASSPORT'         THEN 'nrc'
                    WHEN 'DRIVERS_LICENSE'  THEN 'nrc'
                    WHEN 'SELFIE'           THEN 'selfie_match'
                    WHEN 'CERTIFICATE'      THEN 'portfolio'
                    ELSE 'nrc'
                END,
                CASE
                    WHEN id_doc.status IN ('AUTO_APPROVED', 'APPROVED') THEN 'VERIFIED'
                    WHEN id_doc.status IN ('AUTO_REJECTED', 'REJECTED') THEN 'REJECTED'
                    ELSE 'PENDING'
                END,
                json_build_object('source', 'migrated_from_identity_documents', 'doc_id', id_doc.id),
                CASE WHEN id_doc.status IN ('AUTO_APPROVED', 'APPROVED') THEN id_doc.reviewed_at ELSE NULL END,
                NOW(),
                NOW()
            FROM identity_documents id_doc
            WHERE NOT EXISTS (
                SELECT 1 FROM provider_verifications pv
                WHERE pv.provider_id = id_doc.user_id
                  AND pv.verification_type = CASE id_doc.doc_type
                    WHEN 'NRC'              THEN 'nrc'
                    WHEN 'PASSPORT'         THEN 'nrc'
                    WHEN 'DRIVERS_LICENSE'  THEN 'nrc'
                    WHEN 'SELFIE'           THEN 'selfie_match'
                    WHEN 'CERTIFICATE'      THEN 'portfolio'
                    ELSE 'nrc'
                  END
            )
        ");

        $pvCount = DB::selectOne("SELECT COUNT(*) AS cnt FROM provider_verifications")->cnt;
        Log::info("Data migration: seeded {$pvCount} provider_verifications rows");
    }

    public function down(): void
    {
        // Clear legacy markers — restore bookings to original state
        DB::update("
            UPDATE bookings
            SET legacy_payment_mode = NULL
            WHERE legacy_payment_mode = 'DIRECT'
        ");

        // Truncate seeded tables (safe — these are derived data)
        DB::statement('TRUNCATE TABLE provider_verifications CASCADE');
        DB::statement('TRUNCATE TABLE trust_signals CASCADE');
        DB::statement('TRUNCATE TABLE provider_availability CASCADE');
        DB::statement('TRUNCATE TABLE provider_services CASCADE');
    }
};
