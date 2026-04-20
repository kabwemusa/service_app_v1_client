<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Remove .edu.zm restriction — email is now any valid address
            // Add phone as alternative contact / login identifier
            $table->string('phone', 20)->unique()->nullable()->after('email');
            $table->timestamp('phone_verified_at')->nullable()->after('phone');
            $table->timestamp('email_verified_at')->nullable()->after('phone_verified_at');

            // Identity
            $table->string('legal_name')->nullable()->after('email_verified_at');

            // Account lifecycle state (replaces simple is_verified for account-level gating)
            $table->string('account_state', 20)->default('ACTIVE')->after('role');

            // Referral program
            $table->string('referral_code', 8)->unique()->nullable()->after('account_state');
            $table->uuid('referred_by')->nullable()->after('referral_code');
            $table->foreign('referred_by')->references('id')->on('users')->nullOnDelete();

            // Security
            $table->timestamp('password_changed_at')->nullable()->after('referred_by');

            // Buyer-side symmetric accountability (mirrors provider trust_score)
            $table->decimal('risk_score', 3, 2)->default(0.00)->after('completion_rate');
            $table->integer('disputes_raised_30d')->default(0)->after('risk_score');

            // Extend role enum to include MODERATOR
            // PostgreSQL does not support ALTER COLUMN for enums directly — we cast
        });

        // Extend the role enum to add MODERATOR
        DB::statement("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
        DB::statement("ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20)");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('CUSTOMER','PROVIDER','ADMIN','MODERATOR'))");

        // Replace is_verified with email_verified_at semantics (keep column for BC)
        // Populate email_verified_at from is_verified for existing rows
        DB::statement("UPDATE users SET email_verified_at = updated_at WHERE is_verified = true AND email_verified_at IS NULL");

        // Indexes
        DB::statement('CREATE INDEX IF NOT EXISTS idx_users_phone ON users USING btree (phone)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_users_account_state ON users USING btree (account_state)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users USING btree (referred_by)');
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['referred_by']);
            $table->dropColumn([
                'phone', 'phone_verified_at', 'email_verified_at', 'legal_name',
                'account_state', 'referral_code', 'referred_by',
                'password_changed_at', 'risk_score', 'disputes_raised_30d',
            ]);
        });

        DB::statement("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('CUSTOMER','PROVIDER','ADMIN'))");
    }
};
