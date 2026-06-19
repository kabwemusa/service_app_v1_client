<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.1 §5.3 image pipeline — RESULT storage contract.
 *
 * The pipeline ENGINE (NSFW classifier, pHash reverse-image search, EXIF strip)
 * is out of scope for the admin moderation module — it runs in the upload/
 * background job path. This migration only adds the columns that engine WRITES
 * its verdict into, so the admin Services module can CONSUME them read-only and
 * advise the moderator. In the pilot these stay PENDING/null, which the module
 * renders as "not yet scanned" — never a false flag.
 *
 *   - pipeline_status:         PENDING | CLEAN | FLAGGED  (overall verdict)
 *   - nsfw_score:              classifier confidence [0,1]; high ⇒ NSFW flag
 *   - phash:                   perceptual hash for dedupe (informational)
 *   - duplicate_of_service_id: set when pHash matches ANOTHER provider's photo
 *   - exif_stripped:           false ⇒ EXIF survived / suspicious (§5.3 strip)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('service_photos', function (Blueprint $table) {
            $table->string('pipeline_status', 10)->default('PENDING')->after('display_order');
            $table->decimal('nsfw_score', 4, 3)->nullable()->after('pipeline_status');
            $table->string('phash', 64)->nullable()->after('nsfw_score');
            $table->uuid('duplicate_of_service_id')->nullable()->after('phash');
            $table->boolean('exif_stripped')->default(true)->after('duplicate_of_service_id');
        });

        DB::statement("ALTER TABLE service_photos ADD CONSTRAINT service_photos_pipeline_status_check
            CHECK (pipeline_status IN ('PENDING','CLEAN','FLAGGED'))");

        DB::statement('CREATE INDEX idx_service_photos_pipeline ON service_photos USING btree (pipeline_status)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_service_photos_pipeline');
        DB::statement('ALTER TABLE service_photos DROP CONSTRAINT IF EXISTS service_photos_pipeline_status_check');

        Schema::table('service_photos', function (Blueprint $table) {
            $table->dropColumn([
                'pipeline_status', 'nsfw_score', 'phash',
                'duplicate_of_service_id', 'exif_stripped',
            ]);
        });
    }
};
