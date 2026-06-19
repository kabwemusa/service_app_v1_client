<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Review-level flag store for the admin Reviews moderation queue.
 *
 * Parallels listing_review_flags (services). It is the contract the UPSTREAM
 * systems write OPEN rows into — the in-app "report this review" button (source
 * = report), the text-moderation job (source = auto: profanity / PII / spam),
 * and the nightly graph-analysis / review-spike detector (source = pattern:
 * rating-bombing, §10.4). Building those writers is out of scope; the admin
 * module CONSUMES these rows and additionally COMPUTES auto/pattern flags live
 * so the queue is useful before the jobs exist.
 *
 *   - status OPEN → in the queue; DISMISSED → "marked not a violation";
 *     ACTIONED → the review was removed.
 *   - one open flag per (review, reason).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('review_flags', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->uuid('review_id');
            $table->foreign('review_id')->references('id')->on('reviews')->onDelete('cascade');
            // Denormalised reviewee (the provider reviewed) for fast provider-scoped
            // and fraud pattern queries.
            $table->uuid('reviewee_id');
            $table->foreign('reviewee_id')->references('id')->on('users')->onDelete('cascade');

            $table->string('reason', 30);  // REPORTED | PROFANITY | PII | SPAM_LINK | RATING_BOMBING | REVIEW_SPIKE | OTHER
            $table->string('source', 10);  // report | auto | pattern
            $table->jsonb('details')->nullable();

            $table->uuid('reported_by')->nullable(); // reporter (users.id) when source = report

            $table->string('status', 12)->default('OPEN'); // OPEN | DISMISSED | ACTIONED
            $table->uuid('reviewed_by')->nullable();        // admin_users.id (separate guard, no FK)
            $table->timestamp('reviewed_at')->nullable();

            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent();

            $table->unique(['review_id', 'reason']);
        });

        DB::statement('CREATE INDEX idx_review_flags_open ON review_flags USING btree (status, created_at)');
        DB::statement('CREATE INDEX idx_review_flags_reviewee ON review_flags USING btree (reviewee_id, status)');
    }

    public function down(): void
    {
        Schema::dropIfExists('review_flags');
    }
};
