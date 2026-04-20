<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Seeds ~30 services across all categories, assigning them to seeded providers.
 * PostGIS locations are spread around Lusaka within 5–10 km of the CBD.
 * Prices reflect realistic Zambian student-service rates (ZMW).
 */
class ServiceSeeder extends Seeder
{
    public function run(): void
    {
        // Map category name → id
        $cats = Category::pluck('id', 'name');

        // Map provider email → user id
        $providers = DB::table('users')
            ->where('role', 'PROVIDER')
            ->where('is_verified', true)
            ->pluck('id', 'email');

        if ($providers->isEmpty()) {
            $this->command->warn('No verified providers found. Run ProviderSeeder first.');
            return;
        }

        $p = $providers->values(); // indexed array of UUIDs

        $services = [
            // ── Tutoring ─────────────────────────────────────────────────────
            [
                'provider' => $p[0], 'category' => 'Tutoring',
                'title'    => 'Grade 12 Mathematics & Physics Tutoring',
                'desc'     => 'Experienced tutor offering one-on-one sessions for ECZ Mathematics and Physics. Past exam papers covered. Sessions at your location or online.',
                'price'    => 120.00,
                'lat'      => -15.4155, 'lng' => 28.2835,
            ],
            [
                'provider' => $p[1], 'category' => 'Tutoring',
                'title'    => 'University-Level Accounting & Finance',
                'desc'     => 'CBU 3rd-year Accountancy student offering tutoring for ACCA F1-F3 and university accounting modules.',
                'price'    => 150.00,
                'lat'      => -15.3990, 'lng' => 28.3095,
            ],
            [
                'provider' => $p[6], 'category' => 'Tutoring',
                'title'    => 'English & Literature — All Grades',
                'desc'     => 'Patient and thorough English tutor. Essay writing, comprehension, and grammar for grades 8–12.',
                'price'    => 100.00,
                'lat'      => -15.4108, 'lng' => 28.3240,
            ],
            [
                'provider' => $p[9], 'category' => 'Tutoring',
                'title'    => 'ICT & Computer Studies Tutoring',
                'desc'     => 'Covering Microsoft Office, basic programming, and ECZ Computer Studies syllabus.',
                'price'    => 90.00,
                'lat'      => -15.4295, 'lng' => 28.3495,
            ],

            // ── Laundry ──────────────────────────────────────────────────────
            [
                'provider' => $p[2], 'category' => 'Laundry',
                'title'    => 'Same-Day Laundry & Ironing Service',
                'desc'     => 'Wash, dry and iron. Pickup and delivery within Kabulonga and surrounding areas. Minimum 5 items.',
                'price'    => 60.00,
                'lat'      => -15.4390, 'lng' => 28.3210,
            ],
            [
                'provider' => $p[4], 'category' => 'Laundry',
                'title'    => 'Student Hostel Laundry Pickup',
                'desc'     => 'Regular laundry service for hostel students. Weekly or bi-weekly plans available.',
                'price'    => 45.00,
                'lat'      => -15.3720, 'lng' => 28.3480,
            ],
            [
                'provider' => $p[8], 'category' => 'Laundry',
                'title'    => 'Delicate & Hand-Wash Laundry',
                'desc'     => 'Specialising in hand-washing delicate fabrics, uniforms, and formal wear. Ironing included.',
                'price'    => 75.00,
                'lat'      => -15.4490, 'lng' => 28.3390,
            ],

            // ── Photography ──────────────────────────────────────────────────
            [
                'provider' => $p[2], 'category' => 'Photography',
                'title'    => 'Event & Graduation Photography',
                'desc'     => 'Professional-quality photos for graduations, birthday parties, and corporate events. 100+ edited photos delivered via Google Drive.',
                'price'    => 500.00,
                'lat'      => -15.4410, 'lng' => 28.3185,
            ],
            [
                'provider' => $p[6], 'category' => 'Photography',
                'title'    => 'Passport & ID Photo Session',
                'desc'     => 'Quick 30-minute passport and ID photo sessions. Same-day digital and printed delivery.',
                'price'    => 80.00,
                'lat'      => -15.4095, 'lng' => 28.3265,
            ],
            [
                'provider' => $p[3], 'category' => 'Photography',
                'title'    => 'Product & E-commerce Photography',
                'desc'     => 'Clean white-background product shots for online shops. Minimum 10 items per session.',
                'price'    => 350.00,
                'lat'      => -15.4010, 'lng' => 28.3420,
            ],

            // ── Delivery ─────────────────────────────────────────────────────
            [
                'provider' => $p[5], 'category' => 'Delivery',
                'title'    => 'Same-Day Document & Parcel Delivery',
                'desc'     => 'Fast motorbike delivery for documents, small parcels, and packages within Lusaka. Real-time location updates.',
                'price'    => 40.00,
                'lat'      => -15.4205, 'lng' => 28.3140,
            ],
            [
                'provider' => $p[7], 'category' => 'Delivery',
                'title'    => 'Grocery & Essentials Delivery',
                'desc'     => 'Shop and deliver groceries from Shoprite, Pick n Pay, or Spar. Delivery fee + 10% service charge.',
                'price'    => 35.00,
                'lat'      => -15.3905, 'lng' => 28.2910,
            ],
            [
                'provider' => $p[0], 'category' => 'Delivery',
                'title'    => 'Campus Errand & Pickup Service',
                'desc'     => 'Collect printed assignments, library books, and campus errands. UNZA and Evelyn Hone area.',
                'price'    => 25.00,
                'lat'      => -15.4145, 'lng' => 28.2850,
            ],

            // ── Graphic Design ───────────────────────────────────────────────
            [
                'provider' => $p[3], 'category' => 'Graphic Design',
                'title'    => 'Logo & Brand Identity Design',
                'desc'     => 'Professional logo design with 3 initial concepts, unlimited revisions, and all final file formats.',
                'price'    => 400.00,
                'lat'      => -15.4005, 'lng' => 28.3410,
            ],
            [
                'provider' => $p[5], 'category' => 'Graphic Design',
                'title'    => 'Flyers, Posters & Social Media Graphics',
                'desc'     => 'Eye-catching marketing materials for events, businesses, and personal brands. 24-hour turnaround.',
                'price'    => 120.00,
                'lat'      => -15.4215, 'lng' => 28.3130,
            ],
            [
                'provider' => $p[9], 'category' => 'Graphic Design',
                'title'    => 'Academic & Business Presentation Design',
                'desc'     => 'PowerPoint and Canva presentations that stand out. Includes animations and custom graphics.',
                'price'    => 180.00,
                'lat'      => -15.4285, 'lng' => 28.3510,
            ],

            // ── Hair & Beauty ────────────────────────────────────────────────
            [
                'provider' => $p[4], 'category' => 'Hair & Beauty',
                'title'    => 'Natural Hair Braiding & Styling',
                'desc'     => 'Box braids, cornrows, twists and natural hair care. Home service available in Chelston area.',
                'price'    => 200.00,
                'lat'      => -15.3710, 'lng' => 28.3490,
            ],
            [
                'provider' => $p[9], 'category' => 'Hair & Beauty',
                'title'    => 'Makeup Artistry — Events & Occasions',
                'desc'     => 'Full glam, natural and bridal makeup. Includes lashes. Chilenje and Kabulonga areas.',
                'price'    => 300.00,
                'lat'      => -15.4310, 'lng' => 28.3490,
            ],
            [
                'provider' => $p[6], 'category' => 'Hair & Beauty',
                'title'    => 'Men\'s Haircut & Grooming (Home Visit)',
                'desc'     => 'Professional barber service at your location. Fade, taper, and beard grooming.',
                'price'    => 80.00,
                'lat'      => -15.4115, 'lng' => 28.3240,
            ],

            // ── Cleaning ─────────────────────────────────────────────────────
            [
                'provider' => $p[2], 'category' => 'Cleaning',
                'title'    => 'Student Room & Apartment Deep Clean',
                'desc'     => 'Thorough cleaning of studio apartments and student rooms. Supplies included. 2–4 hour service.',
                'price'    => 180.00,
                'lat'      => -15.4395, 'lng' => 28.3195,
            ],
            [
                'provider' => $p[7], 'category' => 'Cleaning',
                'title'    => 'Weekly House Cleaning Service',
                'desc'     => 'Reliable weekly cleaning for 2–3 bedroom houses. Sweeping, mopping, dusting and bathroom cleaning.',
                'price'    => 150.00,
                'lat'      => -15.3895, 'lng' => 28.2895,
            ],
            [
                'provider' => $p[8], 'category' => 'Cleaning',
                'title'    => 'Post-Event Cleanup',
                'desc'     => 'Quick and thorough cleanup after parties, graduations and events. Team of 2 available.',
                'price'    => 250.00,
                'lat'      => -15.4495, 'lng' => 28.3395,
            ],

            // ── Tech Support ─────────────────────────────────────────────────
            [
                'provider' => $p[1], 'category' => 'Tech Support',
                'title'    => 'Laptop Repair & Software Troubleshooting',
                'desc'     => 'Windows reinstall, virus removal, software setup, and hardware diagnostics. On-site or drop-off.',
                'price'    => 150.00,
                'lat'      => -15.3985, 'lng' => 28.3110,
            ],
            [
                'provider' => $p[0], 'category' => 'Tech Support',
                'title'    => 'Wi-Fi Network Setup & Configuration',
                'desc'     => 'Home and office router setup, Wi-Fi extender installation, and network security configuration.',
                'price'    => 200.00,
                'lat'      => -15.4150, 'lng' => 28.2830,
            ],
            [
                'provider' => $p[3], 'category' => 'Tech Support',
                'title'    => 'Phone Screen Repair (Android)',
                'desc'     => 'Cracked screen replacement for popular Android models. Genuine parts. 1-day turnaround.',
                'price'    => 350.00,
                'lat'      => -15.4020, 'lng' => 28.3380,
            ],
            [
                'provider' => $p[5], 'category' => 'Tech Support',
                'title'    => 'Data Recovery & Backup Service',
                'desc'     => 'Recover deleted files from laptops, phones, and USB drives. No recovery, no charge.',
                'price'    => 180.00,
                'lat'      => -15.4210, 'lng' => 28.3170,
            ],
        ];

        foreach ($services as $svc) {
            $catId = $cats[$svc['category']] ?? null;
            if (! $catId || empty($svc['provider'])) {
                continue;
            }

            $serviceId = (string) Str::uuid();

            DB::table('services')->insertOrIgnore([
                'id'          => $serviceId,
                'provider_id' => $svc['provider'],
                'category_id' => $catId,
                'title'       => $svc['title'],
                'description' => $svc['desc'],
                'base_price'  => $svc['price'],
                'is_active'   => true,
                'created_at'  => now()->subDays(rand(1, 30)),
                'updated_at'  => now(),
            ]);

            // Set PostGIS location
            DB::statement(
                "UPDATE services SET service_location = ST_GeogFromText(?) WHERE id = ?",
                ["POINT({$svc['lng']} {$svc['lat']})", $serviceId],
            );
        }
    }
}
