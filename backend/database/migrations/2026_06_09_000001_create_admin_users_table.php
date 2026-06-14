<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Admin/staff identities — deliberately SEPARATE from `users` (marketplace
     * customers/providers). Admin RBAC is capability-based and derived from the
     * `role` column server-side (see App\Support\AdminCapabilities). Keeping the
     * two populations apart is a security boundary: a marketplace account can
     * never become an admin by a stray role flip.
     */
    public function up(): void
    {
        Schema::create('admin_users', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->string('name');
            $table->string('username', 50)->unique();
            $table->string('email')->unique();
            $table->string('password'); // bcrypt
            // One of the admin roles in App\Support\AdminCapabilities::ROLE_CAPABILITIES
            $table->string('role', 30);
            $table->string('avatar_url')->nullable();

            // MFA (TOTP) — column reserved; enforcement is stubbed for the pilot.
            $table->string('mfa_secret')->nullable();
            $table->boolean('mfa_enabled')->default(false);

            $table->timestamp('last_login_at')->nullable();
            $table->timestamps();

            $table->index('role');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_users');
    }
};
