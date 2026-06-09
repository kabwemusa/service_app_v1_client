<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('home_banners', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->enum('type', ['PROMO', 'EVENT', 'ADVERT', 'ANNOUNCEMENT'])->default('PROMO');
            $table->string('title', 40);
            $table->string('subtitle', 70)->nullable();
            $table->string('image_url')->nullable();
            $table->string('bg_token', 30)->nullable();   // maps to palette token: 'primary', 'success', 'info', 'neutral'
            $table->string('cta_label', 40)->nullable();
            $table->string('cta_action')->nullable();      // in-app route string, e.g. "Search?q=cleaning"
            $table->unsignedSmallInteger('priority')->default(0);
            $table->timestampTz('start_at');
            $table->timestampTz('end_at');
            $table->boolean('is_active')->default(true);
            $table->json('audience')->nullable();          // null = all users; ["CUSTOMER"] / ["PROVIDER"]
            $table->timestamps();

            $table->index(['is_active', 'start_at', 'end_at', 'priority']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('home_banners');
    }
};
