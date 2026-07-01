<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ── Categories: add risk_tier + WhatsApp-catalog fields ──────────
        Schema::table('categories', function (Blueprint $table) {
            $table->unsignedTinyInteger('risk_tier')->default(1)
                ->comment('1=remote, 2=public-venue, 3=in-home')
                ->after('commission_rates');
        });

        // ── Provider Services: the provider×service join ─────────────────
        // Decouples "what the platform offers" (services/catalog) from
        // "what THIS provider charges for it" (provider_services).
        Schema::create('provider_services', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('provider_id');
            $table->uuid('service_id');
            $table->decimal('price', 10, 2)->nullable()
                ->comment('Provider-specific price; null = use catalog base_price');
            $table->string('pricing_model', 20)->default('FIXED')
                ->comment('FIXED, HOURLY, QUOTE — can override catalog default');
            $table->json('inclusions')->nullable()
                ->comment('Provider-specific inclusions (overrides catalog)');
            $table->json('add_ons')->nullable()
                ->comment('Provider-specific add-ons [{name, price}]');
            $table->string('status', 20)->default('ACTIVE')
                ->comment('ACTIVE, PAUSED, HIDDEN');

            // Service-specific stats
            $table->unsignedInteger('bookings_completed')->default(0);
            $table->float('avg_rating')->nullable();
            $table->unsignedInteger('review_count')->default(0);

            $table->timestamps();

            $table->foreign('provider_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('service_id')->references('id')->on('services')->cascadeOnDelete();
            $table->unique(['provider_id', 'service_id']);
            $table->index(['service_id', 'status', 'price']);
        });

        // ── Services: add WhatsApp-catalog sync fields + synonyms ────────
        Schema::table('services', function (Blueprint $table) {
            $table->json('synonyms')->nullable()->after('description')
                ->comment('Search synonyms for NLP matching');
            $table->string('wa_catalog_item_id', 64)->nullable()->after('is_pinned')
                ->comment('WhatsApp Commerce catalog item ID');
            $table->string('wa_sync_status', 20)->nullable()->after('wa_catalog_item_id')
                ->comment('PENDING, SYNCED, FAILED, REMOVED');
        });
    }

    public function down(): void
    {
        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn(['synonyms', 'wa_catalog_item_id', 'wa_sync_status']);
        });

        Schema::dropIfExists('provider_services');

        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('risk_tier');
        });
    }
};
