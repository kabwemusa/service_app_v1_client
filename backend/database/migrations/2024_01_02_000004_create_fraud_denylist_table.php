<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fraud_denylist', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->string('hash_type', 30);
            // NRC_HASH | PASSPORT_HASH | PHONE_HASH | EMAIL_HASH | DEVICE_HASH | MOMO_NUMBER_HASH

            $table->string('hash_value', 64);

            $table->string('reason', 30);
            // CONFIRMED_FRAUD | SERIAL_DISPUTE | IDENTITY_FRAUD | OFF_PLATFORM_ATTEMPT | CHARGEBACK_ABUSE | ADMIN_MANUAL

            $table->uuid('added_by');
            $table->foreign('added_by')->references('id')->on('users');

            $table->timestamp('added_at')->useCurrent();
            $table->timestamp('expires_at')->nullable();  // null = permanent

            $table->unique(['hash_type', 'hash_value']);
        });

        DB::statement('CREATE INDEX idx_denylist_hash ON fraud_denylist USING btree (hash_value)');
    }

    public function down(): void
    {
        Schema::dropIfExists('fraud_denylist');
    }
};
