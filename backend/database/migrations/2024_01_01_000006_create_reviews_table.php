<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reviews', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('booking_id')->unique(); // one review per booking
            $table->foreign('booking_id')->references('id')->on('bookings');
            $table->uuid('reviewer_id');
            $table->foreign('reviewer_id')->references('id')->on('users');
            $table->uuid('reviewee_id');
            $table->foreign('reviewee_id')->references('id')->on('users');
            $table->decimal('rating', 2, 1);
            $table->text('comment')->nullable();
            $table->timestamps();
        });

        // DB-level constraint: rating must be 1.0–5.0
        DB::statement('ALTER TABLE reviews ADD CONSTRAINT chk_rating CHECK (rating >= 1.0 AND rating <= 5.0)');
        // DB-level constraint: no self-reviews
        DB::statement('ALTER TABLE reviews ADD CONSTRAINT chk_no_self_review CHECK (reviewer_id != reviewee_id)');
        DB::statement('CREATE INDEX idx_reviews_reviewee ON reviews USING btree (reviewee_id)');

        // Trigger: after insert, update users.r_raw and users.v_reviews for the reviewee
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

        DB::statement("
            CREATE TRIGGER trg_sync_user_rating
            AFTER INSERT ON reviews
            FOR EACH ROW EXECUTE FUNCTION sync_user_rating();
        ");
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS trg_sync_user_rating ON reviews');
        DB::statement('DROP FUNCTION IF EXISTS sync_user_rating');
        Schema::dropIfExists('reviews');
    }
};
