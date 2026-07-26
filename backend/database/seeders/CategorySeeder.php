<?php

namespace Database\Seeders;

use App\Support\CategoryPricingDefaults;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class CategorySeeder extends Seeder
{
    /**
     * `synonyms` seed the natural-language matcher's Layer 1 (exact/synonym) and,
     * because they're embedded into each category's semantic vector, Layer 2 too.
     * They include Zambian/colloquial terms (geyser, borehole, nshima, slasher,
     * plait, watchman…). This is the seed only — synonyms are admin-editable at
     * runtime via the Categories admin (CategoryController), which re-embeds the
     * category on save. Enriching them here is the cheapest accuracy gain.
     */
    public function run(): void
    {
        $categories = [
            [
                'name'            => 'Cleaning',
                'slug'            => 'cleaning',
                'icon'            => 'sparkles-outline',
                'display_order'   => 1,
                'commission_band' => 'standard',
                'synonyms'        => ['house cleaning', 'home cleaning', 'deep clean', 'domestic cleaning', 'maid service', 'scrubbing', 'mopping', 'spring clean', 'office cleaning', 'housekeeping', 'char'],
            ],
            [
                'name'            => 'Plumbing',
                'slug'            => 'plumbing',
                'icon'            => 'construct-outline',
                'display_order'   => 2,
                'commission_band' => 'standard',
                'synonyms'        => ['pipes', 'leaking tap', 'leaks', 'leaking', 'burst pipe', 'drainage', 'blocked drain', 'water heater', 'geyser', 'geyser leaking', 'solar geyser', 'toilet', 'blocked toilet', 'borehole', 'water tank', 'tank', 'pipe fitting', 'sink', 'plumber'],
            ],
            [
                'name'            => 'Electrical',
                'slug'            => 'electrical',
                'icon'            => 'flash-outline',
                'display_order'   => 3,
                'commission_band' => 'standard',
                'synonyms'        => ['electrician', 'wiring', 'wiring fault', 'sockets', 'power', 'no power', 'generator', 'genset', 'solar', 'solar installation', 'prepaid meter', 'db board', 'electric fault', 'lights', 'geyser installation'],
            ],
            [
                'name'            => 'Hair & Beauty',
                'slug'            => 'hair-beauty',
                'icon'            => 'cut-outline',
                'display_order'   => 4,
                'commission_band' => 'standard',
                'synonyms'        => ['haircut', 'braids', 'plait', 'plaiting', 'plait my hair', 'cornrows', 'nails', 'manicure', 'pedicure', 'makeup', 'salon', 'barber', 'locs', 'dreadlocks', 'weave', 'wig', 'facial', 'lashes', 'hairdressing', 'hairdresser'],
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
                'synonyms'        => ['computer repair', 'laptop fix', 'IT support', 'virus removal', 'network', 'phone repair', 'screen replacement', 'software install', 'wifi setup', 'printer setup', 'data recovery'],
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
                'synonyms'        => ['lawn mowing', 'grass cutting', 'slasher', 'slashing', 'landscaping', 'trimming', 'tree cutting', 'tree felling', 'garden', 'yard work', 'hedge'],
            ],
            [
                'name'            => 'Catering',
                'slug'            => 'catering',
                'icon'            => 'restaurant-outline',
                'display_order'   => 12,
                'commission_band' => 'standard',
                'synonyms'        => ['cooking', 'chef', 'food', 'events catering', 'party food', 'nshima', 'braai', 'wedding food', 'kitchen party', 'finger foods', 'cake'],
            ],
            [
                'name'            => 'Transport',
                'slug'            => 'transport',
                'icon'            => 'car-outline',
                'display_order'   => 13,
                'commission_band' => 'standard',
                'synonyms'        => ['taxi', 'ride', 'driver', 'vehicle hire', 'moving', 'house moving', 'truck hire', 'pickup truck', 'school run', 'car hire'],
            ],
            [
                'name'            => 'Security',
                'slug'            => 'security',
                'icon'            => 'shield-outline',
                'display_order'   => 14,
                'commission_band' => 'standard',
                'synonyms'        => ['guard', 'guards', 'security guard', 'watchman', 'CCTV', 'cameras', 'alarm installation', 'electric fence', 'gate motor'],
            ],
        ];

        $pricing = CategoryPricingDefaults::map();

        foreach ($categories as $cat) {
            $g = $pricing[$cat['slug']] ?? null;

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
                    // Category-driven pricing-model guidance (admin-tunable later).
                    'default_pricing_model'      => $g['default'] ?? null,
                    'recommended_pricing_models' => $g ? json_encode($g['recommended']) : null,
                    'pricing_mismatch_warning'   => $g['warning'] ?? null,
                    'parent_id'        => null,
                    'updated_at'       => now(),
                    'created_at'       => now(),
                ],
            );
        }
    }
}
