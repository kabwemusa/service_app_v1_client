<?php

namespace Database\Seeders;

use App\Models\AdminUser;
use App\Support\AdminCapabilities;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    /**
     * Seed the bootstrap super-admin. Idempotent — safe to re-run.
     * Login (panel): username "mkabwe" or email "mkabwe@ssm.local".
     */
    public function run(): void
    {
        AdminUser::updateOrCreate(
            ['username' => 'mkabwe'],
            [
                'name'        => 'M. Kabwe',
                'email'       => 'mkabwe@ssm.local',
                'password'    => Hash::make('Testing01!'),
                'role'        => 'super_admin',
                'mfa_enabled' => false,
            ],
        );

        $this->command?->info('Seeded super_admin: mkabwe / mkabwe@ssm.local');
    }

    /** Guard against an unknown role drifting out of sync with the panel. */
    public static function assertRolesValid(): void
    {
        foreach (array_keys(AdminCapabilities::ROLE_CAPABILITIES) as $role) {
            \assert(in_array($role, AdminCapabilities::ROLES, true));
        }
    }
}
