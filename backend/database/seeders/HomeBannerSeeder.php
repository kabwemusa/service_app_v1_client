<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class HomeBannerSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        // Truncate existing banners so re-seeding is idempotent
        DB::table('home_banners')->delete();

        $banners = [
            [
                'type'       => 'PROMO',
                'title'      => 'Book trusted help today',
                'subtitle'   => 'Verified providers in your area — ready to help.',
                'bg_token'   => 'primary',
                'cta_label'  => 'Browse services',
                'cta_action' => 'Search',
                'priority'   => 100,
            ],
            [
                'type'       => 'ANNOUNCEMENT',
                'title'      => 'New: Hair & Beauty providers',
                'subtitle'   => 'Book salon-quality services at home.',
                'bg_token'   => 'success',
                'cta_label'  => 'See providers',
                'cta_action' => 'Search',
                'priority'   => 80,
            ],
            [
                'type'       => 'PROMO',
                'title'      => 'Every booking is protected',
                'subtitle'   => 'On-time guarantee, money-back promise & more.',
                'bg_token'   => 'info',
                'cta_label'  => null,
                'cta_action' => null,
                'priority'   => 60,
            ],
        ];

        foreach ($banners as $banner) {
            DB::table('home_banners')->insert([
                'id'         => \Illuminate\Support\Str::uuid(),
                'type'       => $banner['type'],
                'title'      => $banner['title'],
                'subtitle'   => $banner['subtitle'] ?? null,
                'image_url'  => null,
                'bg_token'   => $banner['bg_token'],
                'cta_label'  => $banner['cta_label'],
                'cta_action' => $banner['cta_action'],
                'priority'   => $banner['priority'],
                'start_at'   => $now->copy()->subYear(),
                'end_at'     => $now->copy()->addYears(5),
                'is_active'  => true,
                'audience'   => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }
}
