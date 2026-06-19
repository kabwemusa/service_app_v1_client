<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Admin Reviews moderation module — bookkeeping the existing schema lacks.
 *
 * Reviews (§7.1 / §10.4) are NEVER edited, only removed or restored, so removal
 * is SOFT (removed_at) and reversible. The free-text reason for every action
 * lives in admin_audit_log (the source of truth surfaced in the drawer), so no
 * reason column is duplicated here.
 *
 *   - removed_at / removed_by:  soft removal (policy violation). A removed review
 *                               stops counting toward the provider's rating.
 *   - flags_cleared_at:         set by "mark not-a-violation" — suppresses the
 *                               COMPUTED flags (profanity/PII/links/spike) so a
 *                               moderator-cleared review leaves the queue. A new
 *                               persisted report (review_flags) still re-surfaces.
 *   - response_text / _at / _removed_at:  the provider's public reply. The
 *                               consumer-side reply flow is out of scope; these
 *                               columns are the contract so the admin module can
 *                               moderate a response separately when one exists.
 *
 * The insert trigger sync_user_rating() is replaced so it EXCLUDES removed
 * reviews — otherwise a future review insert would re-average removed ratings
 * back into users.r_raw / v_reviews.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', function (Blueprint $table) {
            $table->timestamp('removed_at')->nullable()->after('comment');
            $table->uuid('removed_by')->nullable()->after('removed_at'); // admin_users.id (separate guard, no FK)
            $table->timestamp('flags_cleared_at')->nullable()->after('removed_by');
            $table->text('response_text')->nullable()->after('flags_cleared_at');
            $table->timestamp('response_at')->nullable()->after('response_text');
            $table->timestamp('response_removed_at')->nullable()->after('response_at');
        });

        DB::statement('CREATE INDEX idx_reviews_reviewee_removed ON reviews USING btree (reviewee_id, removed_at)');

        // Keep the insert-time rating sync correct under soft removal.
        DB::statement("
            CREATE OR REPLACE FUNCTION sync_user_rating()
            RETURNS TRIGGER AS \$\$
            BEGIN
                UPDATE users
                SET
                    v_reviews = (SELECT COUNT(*) FROM reviews WHERE reviewee_id = NEW.reviewee_id AND removed_at IS NULL),
                    r_raw     = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE reviewee_id = NEW.reviewee_id AND removed_at IS NULL), 0.00)
                WHERE id = NEW.reviewee_id;
                RETURN NEW;
            END;
            \$\$ LANGUAGE plpgsql;
        ");
    }

    public function down(): void
    {
        // Restore the original (removal-unaware) trigger function.
        DB::statement("
            CREATE OR REPLACE FUNCTION sync_user_rating()
            RETURNS TRIGGER AS \$\$
            BEGIN
                UPDATE users
                SET
                    v_reviews = (SELECT COUNT(*) FROM reviews WHERE reviewee_id = NEW.reviewee_id),
                    r_raw     = (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE reviewee_id = NEW.reviewee_id)
                WHERE id = NEW.reviewee_id;
                RETURN NEW;
            END;
            \$\$ LANGUAGE plpgsql;
        ");

        DB::statement('DROP INDEX IF EXISTS idx_reviews_reviewee_removed');

        Schema::table('reviews', function (Blueprint $table) {
            $table->dropColumn([
                'removed_at', 'removed_by', 'flags_cleared_at',
                'response_text', 'response_at', 'response_removed_at',
            ]);
        });
    }
};
