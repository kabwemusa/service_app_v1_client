<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('provider_id');
            $table->foreign('provider_id')->references('id')->on('users')->onDelete('cascade');

            $table->string('plan', 10)->default('FREE');   // FREE | PRO | ELITE
            $table->string('status', 12)->default('ACTIVE'); // ACTIVE | GRACE | CANCELLED | EXPIRED

            $table->timestamp('current_period_start')->nullable();
            $table->timestamp('current_period_end')->nullable();
            $table->timestamp('renews_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
        });

        DB::statement('CREATE INDEX idx_subscriptions_provider ON subscriptions USING btree (provider_id, status)');
        DB::statement('CREATE INDEX idx_subscriptions_renews ON subscriptions USING btree (renews_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('subscriptions');
    }
};
