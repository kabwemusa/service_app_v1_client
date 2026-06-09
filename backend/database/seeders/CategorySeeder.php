<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class CategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            [
                'name'            => 'Cleaning',
                'slug'            => 'cleaning',
                'icon'            => 'sparkles-outline',
                'display_order'   => 1,
                'commission_band' => 'standard',
                'synonyms'        => ['house cleaning', 'home cleaning', 'deep clean', 'domestic cleaning', 'maid service'],
            ],
            [
                'name'            => 'Plumbing',
                'slug'            => 'plumbing',
                'icon'            => 'construct-outline',
                'display_order'   => 2,
                'commission_band' => 'standard',
                'synonyms'        => ['pipes', 'leaking tap', 'burst pipe', 'drainage', 'water heater'],
            ],
            [
                'name'            => 'Electrical',
                'slug'            => 'electrical',
                'icon'            => 'flash-outline',
                'display_order'   => 3,
                'commission_band' => 'standard',
                'synonyms'        => ['electrician', 'wiring', 'geyser', 'sockets', 'power'],
            ],
            [
                'name'            => 'Hair & Beauty',
                'slug'            => 'hair-beauty',
                'icon'            => 'cut-outline',
                'display_order'   => 4,
                'commission_band' => 'standard',
                'synonyms'        => ['haircut', 'braids', 'nails', 'makeup', 'salon', 'barber', 'locs', 'weave'],
            ],
            [
                'name'            => 'Tutoring',
                'slug'            => 'tutoring',
                'icon'            => 'book-outline',
                'display_order'   => 5,
                'commission_band' => 'standard',
                'synonyms'        => ['teacher', 'homework help', 'lessons', 'maths tutor', 'english tutor'],
            ],
            [
                'name'            => 'Photography',
                'slug'            => 'photography',
                'icon'            => 'camera-outline',
                'display_order'   => 6,
                'commission_band' => 'standard',
                'synonyms'        => ['photographer', 'photos', 'portraits', 'wedding photos', 'event photography'],
            ],
            [
                'name'            => 'Delivery',
                'slug'            => 'delivery',
                'icon'            => 'bicycle-outline',
                'display_order'   => 7,
                'commission_band' => 'standard',
                'synonyms'        => ['courier', 'drop off', 'pickup', 'transport goods'],
            ],
            [
                'name'            => 'Graphic Design',
                'slug'            => 'graphic-design',
                'icon'            => 'brush-outline',
                'display_order'   => 8,
                'commission_band' => 'standard',
                'synonyms'        => ['logo', 'flyer', 'poster', 'branding', 'designer', 'artwork'],
            ],
            [
                'name'            => 'Tech Support',
                'slug'            => 'tech-support',
                'icon'            => 'hardware-chip-outline',
                'display_order'   => 9,
                'commission_band' => 'standard',
                'synonyms'        => ['computer repair', 'laptop fix', 'IT support', 'virus removal', 'network'],
            ],
            [
                'name'            => 'Laundry',
                'slug'            => 'laundry',
                'icon'            => 'water-outline',
                'display_order'   => 10,
                'commission_band' => 'standard',
                'synonyms'        => ['washing', 'ironing', 'dry cleaning'],
            ],
            [
                'name'            => 'Gardening',
                'slug'            => 'gardening',
                'icon'            => 'leaf-outline',
                'display_order'   => 11,
                'commission_band' => 'standard',
                'synonyms'        => ['lawn mowing', 'landscaping', 'trimming', 'garden'],
            ],
            [
                'name'            => 'Catering',
                'slug'            => 'catering',
                'icon'            => 'restaurant-outline',
                'display_order'   => 12,
                'commission_band' => 'standard',
                'synonyms'        => ['cooking', 'chef', 'food', 'events catering', 'party food'],
            ],
            [
                'name'            => 'Transport',
                'slug'            => 'transport',
                'icon'            => 'car-outline',
                'display_order'   => 13,
                'commission_band' => 'standard',
                'synonyms'        => ['taxi', 'ride', 'driver', 'vehicle hire'],
            ],
            [
                'name'            => 'Security',
                'slug'            => 'security',
                'icon'            => 'shield-outline',
                'display_order'   => 14,
                'commission_band' => 'standard',
                'synonyms'        => ['guard', 'security guard', 'CCTV', 'alarm installation'],
            ],
        ];

        foreach ($categories as $cat) {
            DB::table('categories')->updateOrInsert(
                ['slug' => $cat['slug']],
                [
                    'name'             => $cat['name'],
                    'slug'             => $cat['slug'],
                    'icon'             => $cat['icon'],
                    'icon_url'         => null,
                    'is_active'        => true,
                    'display_order'    => $cat['display_order'],
                    'commission_band'  => $cat['commission_band'],
                    'commission_rates' => json_encode(['1' => 0.18, '2' => 0.15, '3' => 0.13, '4' => 0.11]),
                    'synonyms'         => json_encode($cat['synonyms']),
                    'parent_id'        => null,
                    'updated_at'       => now(),
                    'created_at'       => now(),
                ],
            );
        }
    }
}
