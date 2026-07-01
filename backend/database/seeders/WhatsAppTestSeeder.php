<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\ProviderAvailability;
use App\Models\ProviderProfile;
use App\Models\ProviderService;
use App\Models\ProviderVerification;
use App\Models\Service;
use App\Models\TrustSignal;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class WhatsAppTestSeeder extends Seeder
{
    public function run(): void
    {
        // ── Categories across all 3 risk tiers ────────────────────────────

        $catRemote = Category::updateOrCreate(
            ['slug' => 'digital-services'],
            ['name' => 'Digital Services', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1],
        );

        $catPublic = Category::updateOrCreate(
            ['slug' => 'beauty-grooming'],
            ['name' => 'Beauty & Grooming', 'is_active' => true, 'risk_tier' => 2, 'display_order' => 2],
        );

        $catInHome = Category::updateOrCreate(
            ['slug' => 'home-services'],
            ['name' => 'Home Services', 'is_active' => true, 'risk_tier' => 3, 'display_order' => 3],
        );

        // ── Providers (created before services — services need provider_id FK) ──

        $providerA = $this->createProvider('+260971000001', 'Alice Mwansa', 3, -15.3875, 28.3228);
        $providerB = $this->createProvider('+260972000002', 'Brian Chanda', 2, -15.4010, 28.3520);
        $providerC = $this->createProvider('+260973000003', 'Charity Banda', 1, -15.4100, 28.2700);
        $providerD = $this->createProvider('+260974000004', 'David Tembo', 1, -15.4300, 28.3100);
        $providerE = $this->createProvider('+260950004949', 'Emma Phiri', 3, -12.9586, 28.6366);
        $providerF = $this->createProvider('+260976000006', 'Frank Mulenga', 1, -15.3950, 28.3100);

        // ── Services (catalog templates — owned by providerA as the listing creator) ──

        $svcGraphic = Service::updateOrCreate(
            ['title' => 'Graphic Design', 'category_id' => $catRemote->id],
            ['status' => 'ACTIVE', 'base_price' => 100, 'pricing_model' => 'FIXED', 'description' => 'Logo, banner, and social media design.', 'provider_id' => $providerA->id],
        );

        $svcWeb = Service::updateOrCreate(
            ['title' => 'Website Development', 'category_id' => $catRemote->id],
            ['status' => 'ACTIVE', 'base_price' => 500, 'pricing_model' => 'FIXED', 'description' => 'Responsive website build.', 'provider_id' => $providerA->id],
        );

        $svcHaircut = Service::updateOrCreate(
            ['title' => 'Haircut & Styling', 'category_id' => $catPublic->id],
            ['status' => 'ACTIVE', 'base_price' => 50, 'pricing_model' => 'FIXED', 'description' => 'Professional haircut at a salon or studio.', 'provider_id' => $providerA->id],
        );

        $svcMakeup = Service::updateOrCreate(
            ['title' => 'Makeup Artist', 'category_id' => $catPublic->id],
            ['status' => 'ACTIVE', 'base_price' => 200, 'pricing_model' => 'FIXED', 'description' => 'Professional makeup for events.', 'provider_id' => $providerA->id],
        );

        $svcPlumbing = Service::updateOrCreate(
            ['title' => 'Plumbing', 'category_id' => $catInHome->id],
            ['status' => 'ACTIVE', 'base_price' => 150, 'pricing_model' => 'HOURLY', 'description' => 'Pipe repair, tap fixing, drain clearing.', 'provider_id' => $providerA->id],
        );

        $svcCleaning = Service::updateOrCreate(
            ['title' => 'Home Cleaning', 'category_id' => $catInHome->id],
            ['status' => 'ACTIVE', 'base_price' => 80, 'pricing_model' => 'FIXED', 'description' => 'Thorough home cleaning service.', 'provider_id' => $providerA->id],
        );

        // ── Verifications + trust signals + availability + service offerings ──

        // Provider A: Tier 3, fully verified, experienced
        $this->addVerifications($providerA->id, ['nrc', 'momo_name_match', 'portfolio', 'police_clearance']);
        $this->addTrustSignal($providerA->id, 85, 90, 95, 4.6, 45);
        $this->addAvailability($providerA->id);
        $this->addProviderServices($providerA->id, [$svcPlumbing, $svcCleaning, $svcHaircut], [180, 100, 60]);

        // Provider B: Tier 2, partially verified, moderate history
        $this->addVerifications($providerB->id, ['nrc', 'momo_name_match', 'portfolio']);
        $this->addTrustSignal($providerB->id, 70, 80, 85, 4.2, 20);
        $this->addAvailability($providerB->id);
        $this->addProviderServices($providerB->id, [$svcPlumbing, $svcGraphic, $svcWeb], [160, 120, 600]);

        // Provider C: Tier 1, basic verified, some history
        $this->addVerifications($providerC->id, ['nrc', 'momo_name_match']);
        $this->addTrustSignal($providerC->id, 50, 70, 80, 3.8, 8);
        $this->addAvailability($providerC->id);
        $this->addProviderServices($providerC->id, [$svcHaircut, $svcMakeup, $svcGraphic], [45, 180, 80]);

        // Provider D: NEW — fairness-floor provider (zero history)
        $this->addVerifications($providerD->id, ['nrc', 'momo_name_match']);
        $this->addTrustSignal($providerD->id, 50, 70, 80, 0, 0);
        $this->addAvailability($providerD->id);
        $this->addProviderServices($providerD->id, [$svcPlumbing, $svcCleaning], [130, 70]);

        // Provider E: Tier 3, remote specialist (Ndola — inter-city)
        $this->addVerifications($providerE->id, ['nrc', 'momo_name_match', 'portfolio', 'police_clearance']);
        $this->addTrustSignal($providerE->id, 90, 95, 98, 4.8, 60);
        $this->addAvailability($providerE->id);
        $this->addProviderServices($providerE->id, [$svcWeb, $svcGraphic], [450, 90]);

        // Provider F: Tier 1, basic — INELIGIBLE for in-home (missing police_clearance)
        $this->addVerifications($providerF->id, ['nrc', 'momo_name_match']);
        $this->addTrustSignal($providerF->id, 50, 60, 70, 3.0, 5);
        $this->addAvailability($providerF->id);
        $this->addProviderServices($providerF->id, [$svcPlumbing], [140]);

        // ── Customer account ──────────────────────────────────────────────

        User::updateOrCreate(
            ['phone' => '+260977000007'],
            [
                'email'          => 'testcustomer@sebenza.zm',
                'legal_name'     => 'Test Customer',
                'role'           => 'CUSTOMER',
                'account_state'  => 'ACTIVE',
                'password_hash'  => Hash::make('Testing01!'),
                'phone_verified_at' => now(),
            ],
        );
    }

    private function createProvider(string $phone, string $name, int $tier, float $lat, float $lng): User
    {
        $user = User::updateOrCreate(
            ['phone' => $phone],
            [
                'email'          => strtolower(str_replace(' ', '.', $name)) . '@test.sebenza.zm',
                'legal_name'     => $name,
                'role'           => 'PROVIDER',
                'account_state'  => 'ACTIVE',
                'password_hash'  => Hash::make('Testing01!'),
                'phone_verified_at' => now(),
            ],
        );

        ProviderProfile::updateOrCreate(
            ['user_id' => $user->id],
            [
                'trust_tier'          => $tier,
                'display_name'        => $name,
                'accepting_bookings'  => true,
                'base_location_lat'   => $lat,
                'base_location_lng'   => $lng,
                'base_location_label' => 'Test Location',
                'max_radius_km'       => 50,
                'service_radius_km'   => 30,
                'momo_provider'       => 'MTN',
                'momo_number'         => $phone,
            ],
        );

        return $user;
    }

    private function addVerifications(string $providerId, array $types): void
    {
        foreach ($types as $type) {
            ProviderVerification::updateOrCreate(
                ['provider_id' => $providerId, 'verification_type' => $type],
                ['status' => 'VERIFIED', 'verified_at' => now()],
            );
        }
    }

    private function addTrustSignal(
        string $providerId,
        float $identity,
        float $reliability,
        float $financial,
        float $avgRating,
        int $ratingCount,
    ): void {
        $bayesian = $ratingCount > 0 ? ($avgRating / 5) * 100 : 70;

        TrustSignal::updateOrCreate(
            ['provider_id' => $providerId],
            [
                'identity_strength' => $identity,
                'reliability_pct'   => $reliability,
                'financial_health'  => $financial,
                'bayesian_rating'   => $bayesian,
                'rating_count'      => $ratingCount,
                'composite_score'   => ($identity * 0.25 + $reliability * 0.25 + $financial * 0.25 + $bayesian * 0.25),
                'last_computed_at'  => now(),
            ],
        );
    }

    private function addAvailability(string $providerId): void
    {
        for ($day = 1; $day <= 5; $day++) {
            ProviderAvailability::updateOrCreate(
                ['provider_id' => $providerId, 'day_of_week' => $day, 'is_recurring' => true, 'start_time' => '08:00'],
                ['end_time' => '17:00'],
            );
        }

        ProviderAvailability::updateOrCreate(
            ['provider_id' => $providerId, 'day_of_week' => 6, 'is_recurring' => true, 'start_time' => '09:00'],
            ['end_time' => '14:00'],
        );
    }

    private function addProviderServices(string $providerId, array $services, array $prices): void
    {
        foreach ($services as $i => $service) {
            ProviderService::updateOrCreate(
                ['provider_id' => $providerId, 'service_id' => $service->id],
                [
                    'price'              => $prices[$i] ?? $service->base_price,
                    'pricing_model'      => $service->pricing_model,
                    'status'             => 'ACTIVE',
                    'bookings_completed' => 0,
                ],
            );
        }
    }
}
