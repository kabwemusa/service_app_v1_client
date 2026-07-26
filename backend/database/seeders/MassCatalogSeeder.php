<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Large-scale ranking test fixture: ~2000 providers spread across real Zambian
 * provinces/cities/wards, every trust tier, realistic services across (nearly)
 * every active category, and all four pricing models. Every provider logs in
 * with password Testing01!.
 *
 * NOT part of the default DatabaseSeeder chain (it's slow and only needed for
 * ranking/geo-widening testing) — run it explicitly:
 *   php artisan db:seed --class=MassCatalogSeeder
 *
 * After seeding, sync search + the NL matcher's embedding index:
 *   php artisan typesense:sync
 *   php artisan matching:embed
 */
class MassCatalogSeeder extends Seeder
{
    private const PASSWORD = 'Testing01!';
    private const PROVIDER_COUNT = 2000;
    private const CHUNK_SIZE = 250;

    public function run(): void
    {
        $categories = DB::table('categories')->where('is_active', true)->pluck('id', 'slug')->all();
        if (empty($categories)) {
            $this->command?->warn('No categories found — run CategorySeeder first.');
            return;
        }

        $this->command?->info('Seeding ' . self::PROVIDER_COUNT . ' providers across Zambia…');
        $providers = $this->seedProviders();

        $this->command?->info('Providers seeded. Seeding services…');
        $counts = $this->seedServices($providers, $categories);

        $this->command?->info('Done.');
        $this->command?->table(
            ['Metric', 'Count'],
            [
                ['Providers', count($providers)],
                ['Services', $counts['services']],
                ['Services with location (IN_PERSON)', $counts['located']],
            ],
        );
        $this->command?->warn('Now run: php artisan typesense:sync && php artisan matching:embed');
    }

    // ── Providers ────────────────────────────────────────────────────────────

    /** @return array<int, array{id:string,tier:int,lat:float,lng:float,ward:?string,city:?string,province:?string}> */
    private function seedProviders(): array
    {
        $locations   = $this->locations();
        $totalWeight = array_sum(array_column($locations, 'weight'));
        $firstNames  = $this->firstNames();
        $lastNames   = $this->lastNames();
        $passwordHash = Hash::make(self::PASSWORD);

        $userRows    = [];
        $profileRows = [];
        $providers   = [];

        for ($i = 0; $i < self::PROVIDER_COUNT; $i++) {
            $loc = $this->weightedPick($locations, $totalWeight);
            $lat = $loc['lat'] + (mt_rand(-150, 150) / 10000); // ~±1.6km jitter within the ward
            $lng = $loc['lng'] + (mt_rand(-150, 150) / 10000);

            $tier = $this->pickTier();
            [$trustMin, $trustMax] = $this->trustRangeForTier($tier);
            $trustScore = round(mt_rand((int) ($trustMin * 100), (int) ($trustMax * 100)) / 100, 2);

            $coldStart = mt_rand(1, 100) <= 15;
            $vReviews  = $coldStart ? 0 : $this->reviewCountForTier($tier);
            $rRaw      = $coldStart ? 0.00 : $this->ratingForTier($tier);
            $rDecayed  = $coldStart ? null : max(0.0, min(5.0, round($rRaw + (mt_rand(-20, 20) / 100), 2)));
            $completionRate = mt_rand(1, 100) <= 10 ? null : round(mt_rand(60, 100) / 100, 2);

            $accountRoll = mt_rand(1, 1000);
            $accountState = match (true) {
                $accountRoll <= 985 => 'ACTIVE',
                $accountRoll <= 992 => 'SUSPENDED',
                $accountRoll <= 997 => 'RESTRICTED',
                default             => 'BANNED',
            };

            $profileCompleteness = mt_rand(1, 100) <= 92 ? mt_rand(40, 100) : mt_rand(5, 39);

            $kycStatus = match (true) {
                $tier >= 2 => 'VERIFIED',
                $tier === 1 => mt_rand(0, 1) ? 'VERIFIED' : 'SUBMITTED',
                default     => mt_rand(0, 1) ? 'PENDING' : 'SUBMITTED',
            };
            $onboardingState = $tier >= 1 ? 'LIVE' : (mt_rand(0, 1) ? 'SET_UP' : 'DRAFT');

            $first = $firstNames[array_rand($firstNames)];
            $last  = $lastNames[array_rand($lastNames)];
            $name  = "{$first} {$last}";

            $userId = (string) Str::uuid();
            // Index-derived → guaranteed unique, no collision with hand-seeded fixtures.
            $phone  = '+2609' . str_pad((string) (800000 + $i), 8, '0', STR_PAD_LEFT);
            $email  = "provider{$i}@sebenza-test.zm";
            $nrc    = str_pad((string) (100000 + $i), 6, '0', STR_PAD_LEFT)
                . '/' . str_pad((string) mt_rand(1, 20), 2, '0', STR_PAD_LEFT) . '/' . mt_rand(1, 9);

            $userRows[] = [
                'id'                => $userId,
                'email'             => $email,
                'password_hash'     => $passwordHash,
                'role'              => 'PROVIDER',
                'is_verified'       => true,
                'v_reviews'         => $vReviews,
                'r_raw'             => $rRaw,
                'r_decayed'         => $rDecayed,
                'completion_rate'   => $completionRate,
                'last_active_at'    => now()->subDays($this->skewedRecentDays())->subMinutes(mt_rand(0, 1440)),
                'phone'             => $phone,
                'phone_verified_at' => now()->subDays(mt_rand(1, 200)),
                'legal_name'        => $name,
                'account_state'     => $accountState,
                'created_at'        => now()->subDays(mt_rand(5, 400)),
                'updated_at'        => now(),
            ];

            $profileRows[] = [
                'user_id'                => $userId,
                'nrc_number'             => $nrc,
                'kyc_status'             => $kycStatus,
                'momo_provider'          => ['MTN', 'AIRTEL', 'ZAMTEL'][array_rand(['MTN', 'AIRTEL', 'ZAMTEL'])],
                'momo_number'            => $phone,
                'base_location_lat'      => $lat,
                'base_location_lng'      => $lng,
                'max_radius_km'          => mt_rand(3, 15),
                'availability_matrix'    => json_encode($this->randomAvailability()),
                'profile_completeness'   => $profileCompleteness,
                'display_name'           => $name,
                'trust_tier'             => $tier,
                'trust_score'            => $trustScore,
                'year_started'           => mt_rand(1, 100) <= 70 ? mt_rand(2016, 2025) : null,
                'languages'              => json_encode($this->randomLanguages()),
                'service_radius_km'      => mt_rand(3, 15),
                'response_time_p50_mins' => mt_rand(10, 180),
                'response_rate_7d'       => round(mt_rand(50, 100) / 100, 2),
                'cancellation_rate_30d'  => round(mt_rand(0, 20) / 100, 2),
                'repeat_client_rate'     => round(mt_rand(0, 60) / 100, 2),
                'accepting_bookings'     => mt_rand(1, 100) <= 95,
                'onboarding_state'       => $onboardingState,
                'base_location_label'    => $loc['ward'] . ', ' . $loc['city'],
                'region_ward'            => $loc['ward'],
                'region_city'            => $loc['city'],
                'region_province'        => $loc['province'],
                'created_at'             => now(),
                'updated_at'             => now(),
            ];

            $providers[] = [
                'id' => $userId, 'tier' => $tier, 'lat' => $lat, 'lng' => $lng,
                'ward' => $loc['ward'], 'city' => $loc['city'], 'province' => $loc['province'],
            ];

            if (count($userRows) >= self::CHUNK_SIZE) {
                DB::table('users')->insert($userRows);
                DB::table('provider_profiles')->insert($profileRows);
                $userRows = [];
                $profileRows = [];
            }
        }

        if ($userRows !== []) {
            DB::table('users')->insert($userRows);
            DB::table('provider_profiles')->insert($profileRows);
        }

        return $providers;
    }

    // ── Services ─────────────────────────────────────────────────────────────

    /**
     * @param array<int, array{id:string,tier:int,lat:float,lng:float,ward:?string,city:?string,province:?string}> $providers
     * @param array<string,int> $categories slug => id
     * @return array{services:int, located:int}
     */
    private function seedServices(array $providers, array $categories): array
    {
        $templates      = $this->categoryTemplates();
        $demandWeights  = $this->categoryDemandWeights();
        $slugs          = array_keys($demandWeights);
        $weights        = array_values($demandWeights);
        $totalWeight    = array_sum($weights);

        $pricingModels  = ['OUTCOME_FIXED', 'HOURLY_CAPPED', 'PROVIDER_SCOPE', 'QUOTE_DEPOSIT'];
        $pricingWeights = [40, 25, 20, 15];
        $pricingTotal   = array_sum($pricingWeights);

        $chunk           = [];
        $locationUpdates = [];
        $serviceCount    = 0;
        $locatedCount    = 0;

        foreach ($providers as $prov) {
            $numServices = $this->numServicesForTier($prov['tier']);

            for ($n = 0; $n < $numServices; $n++) {
                $slug  = $slugs[$this->weightedIndex($weights, $totalWeight)];
                $catId = $categories[$slug] ?? null;
                if ($catId === null || empty($templates[$slug])) {
                    continue;
                }

                $tpl       = $templates[$slug][array_rand($templates[$slug])];
                $priceHint = round(mt_rand((int) ($tpl['min'] * 100), (int) ($tpl['max'] * 100)) / 100, 2);
                $model     = $pricingModels[$this->weightedIndex($pricingWeights, $pricingTotal)];
                $fields    = $this->pricingFields($model, $priceHint);

                $remote       = $tpl['remote'] && mt_rand(1, 100) <= 35;
                $deliveryType = $remote ? 'REMOTE' : 'IN_PERSON';

                $statusRoll = mt_rand(1, 100);
                $status = match (true) {
                    $statusRoll <= 90 => 'ACTIVE',
                    $statusRoll <= 94 => 'PAUSED',
                    $statusRoll <= 97 => 'DRAFT',
                    default           => 'HIDDEN',
                };

                $serviceId = (string) Str::uuid();

                $chunk[] = [
                    'id'                     => $serviceId,
                    'provider_id'            => $prov['id'],
                    'category_id'            => $catId,
                    'title'                  => $tpl['title'],
                    'description'            => $tpl['desc'],
                    'base_price'             => $fields['base_price'],
                    'created_at'             => now()->subDays(mt_rand(1, 180)),
                    'updated_at'             => now(),
                    'duration_estimate_mins' => mt_rand(30, 240),
                    'pricing_model'          => $model,
                    'status'                 => $status,
                    'is_pinned'              => false,
                    'region_ward'            => $remote ? null : $prov['ward'],
                    'region_city'            => $remote ? null : $prov['city'],
                    'region_province'        => $remote ? null : $prov['province'],
                    'hourly_rate'            => $fields['hourly_rate'],
                    'minimum_hours'          => $fields['minimum_hours'],
                    'cap_hours'              => $fields['cap_hours'],
                    'cap_amount'             => $fields['cap_amount'],
                    'deposit_percent'        => $fields['deposit_percent'],
                    'scope_prompts'          => $fields['scope_prompts'],
                    'needs_pricing_review'   => false,
                    'delivery_type'          => $deliveryType,
                ];
                $serviceCount++;

                if (! $remote) {
                    $locationUpdates[] = [
                        'id'  => $serviceId,
                        'lat' => $prov['lat'] + (mt_rand(-30, 30) / 10000),
                        'lng' => $prov['lng'] + (mt_rand(-30, 30) / 10000),
                    ];
                    $locatedCount++;
                }

                if (count($chunk) >= 300) {
                    DB::table('services')->insert($chunk);
                    $this->bulkSetServiceLocations($locationUpdates);
                    $chunk = [];
                    $locationUpdates = [];
                }
            }
        }

        if ($chunk !== []) {
            DB::table('services')->insert($chunk);
            $this->bulkSetServiceLocations($locationUpdates);
        }

        return ['services' => $serviceCount, 'located' => $locatedCount];
    }

    /** Batched PostGIS location update — one UPDATE per 200 rows via a VALUES join. */
    private function bulkSetServiceLocations(array $rows): void
    {
        if ($rows === []) {
            return;
        }

        foreach (array_chunk($rows, 200) as $batch) {
            $values   = [];
            $bindings = [];
            foreach ($batch as $r) {
                $values[]   = '(?::uuid, ST_GeogFromText(?))';
                $bindings[] = $r['id'];
                $bindings[] = "POINT({$r['lng']} {$r['lat']})";
            }

            $sql = 'UPDATE services AS s
                    SET service_location = v.geog
                    FROM (VALUES ' . implode(',', $values) . ') AS v(id, geog)
                    WHERE s.id = v.id';

            DB::statement($sql, $bindings);
        }
    }

    /** Field combinations matching ServiceService::pricingFields per model. */
    private function pricingFields(string $model, float $priceHint): array
    {
        return match ($model) {
            'OUTCOME_FIXED' => [
                'base_price' => $priceHint, 'hourly_rate' => null, 'minimum_hours' => null,
                'cap_hours' => null, 'cap_amount' => null, 'deposit_percent' => null, 'scope_prompts' => null,
            ],
            'HOURLY_CAPPED' => (function () use ($priceHint) {
                $rate     = max(30.0, round($priceHint / mt_rand(3, 6), 0));
                $minHours = [1, 1.5, 2][array_rand([1, 1.5, 2])];
                $capHours = mt_rand(3, 8);
                $capAmount = round($rate * $capHours, 2);
                return [
                    'base_price' => $capAmount, 'hourly_rate' => $rate, 'minimum_hours' => $minHours,
                    'cap_hours' => $capHours, 'cap_amount' => $capAmount, 'deposit_percent' => null, 'scope_prompts' => null,
                ];
            })(),
            'PROVIDER_SCOPE' => [
                'base_price' => null, 'hourly_rate' => null, 'minimum_hours' => null, 'cap_hours' => null,
                'cap_amount' => null, 'deposit_percent' => null,
                'scope_prompts' => json_encode(['What exactly needs doing?', 'How big is the job?', 'Any special conditions the provider should know about?']),
            ],
            'QUOTE_DEPOSIT' => [
                'base_price' => null, 'hourly_rate' => null, 'minimum_hours' => null, 'cap_hours' => null,
                'cap_amount' => null, 'deposit_percent' => [20, 25, 30, 40][array_rand([20, 25, 30, 40])],
                'scope_prompts' => json_encode(['What exactly needs doing?', 'How big is the job?', 'Any special conditions the provider should know about?']),
            ],
            default => [],
        };
    }

    private function numServicesForTier(int $tier): int
    {
        if ($tier === 0) {
            return mt_rand(1, 100) <= 70 ? 0 : 1;
        }
        $r = mt_rand(1, 100);
        return match (true) {
            $r <= 50 => 1,
            $r <= 85 => 2,
            default  => 3,
        };
    }

    // ── Weighted random helpers ──────────────────────────────────────────────

    private function weightedPick(array $items, int $totalWeight): array
    {
        return $items[$this->weightedIndex(array_column($items, 'weight'), $totalWeight)];
    }

    private function weightedIndex(array $weights, int $total): int
    {
        $r   = mt_rand(1, $total);
        $cum = 0;
        foreach (array_values($weights) as $i => $w) {
            $cum += $w;
            if ($r <= $cum) {
                return $i;
            }
        }
        return array_key_last($weights);
    }

    private function pickTier(): int
    {
        $r = mt_rand(1, 100);
        return match (true) {
            $r <= 5  => 0,  // UNVERIFIED
            $r <= 40 => 1,  // BASIC       (+35)
            $r <= 70 => 2,  // IDENTIFIED  (+30)
            $r <= 90 => 3,  // VERIFIED    (+20)
            default  => 4,  // PROFESSIONAL(+10)
        };
    }

    private function trustRangeForTier(int $tier): array
    {
        return match ($tier) {
            0 => [0.05, 0.50],
            1 => [0.40, 0.60],
            2 => [0.55, 0.75],
            3 => [0.68, 0.88],
            4 => [0.80, 0.99],
        };
    }

    private function reviewCountForTier(int $tier): int
    {
        return match ($tier) {
            0 => mt_rand(0, 3),
            1 => mt_rand(1, 40),
            2 => mt_rand(5, 90),
            3 => mt_rand(20, 180),
            4 => mt_rand(50, 300),
        };
    }

    private function ratingForTier(int $tier): float
    {
        [$lo, $hi] = match ($tier) {
            0 => [250, 420],
            1 => [300, 460],
            2 => [350, 480],
            3 => [400, 495],
            4 => [430, 500],
        };
        return round(mt_rand($lo, $hi) / 100, 2);
    }

    private function skewedRecentDays(): int
    {
        $r = mt_rand(1, 100);
        return match (true) {
            $r <= 60 => mt_rand(0, 3),
            $r <= 85 => mt_rand(4, 14),
            default  => mt_rand(15, 60),
        };
    }

    private function randomAvailability(): array
    {
        $matrix = [];
        foreach (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as $d) {
            if (mt_rand(1, 100) <= 15) {
                $matrix[$d] = [];
                continue;
            }
            $startHour = mt_rand(7, 10);
            $endHour   = mt_rand(15, 19);
            $matrix[$d] = [['start' => sprintf('%02d:00', $startHour), 'end' => sprintf('%02d:00', $endHour)]];
        }
        return $matrix;
    }

    private function randomLanguages(): array
    {
        $pool = ['en', 'ny', 'bem', 'ton', 'loz'];
        shuffle($pool);
        $langs = array_slice($pool, 0, mt_rand(1, 3));
        if (! in_array('en', $langs, true)) {
            $langs[] = 'en';
        }
        return array_values(array_unique($langs));
    }

    // ── Zambian geography (province → city → ward), weighted by rough population ──

    private function locations(): array
    {
        return [
            // Lusaka Province — capital, highest weight
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Kabwata',     'lat' => -15.4300, 'lng' => 28.2937, 'weight' => 14],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Chelstone',   'lat' => -15.3925, 'lng' => 28.3752, 'weight' => 12],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Kabulonga',   'lat' => -15.4304, 'lng' => 28.3228, 'weight' => 10],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Woodlands',   'lat' => -15.4232, 'lng' => 28.3390, 'weight' => 9],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Chilenje',    'lat' => -15.4437, 'lng' => 28.3103, 'weight' => 8],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Matero',      'lat' => -15.3833, 'lng' => 28.2667, 'weight' => 10],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Garden',      'lat' => -15.3717, 'lng' => 28.3131, 'weight' => 7],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Olympia',     'lat' => -15.3853, 'lng' => 28.3517, 'weight' => 7],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Roma',        'lat' => -15.3833, 'lng' => 28.3167, 'weight' => 6],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Avondale',    'lat' => -15.3961, 'lng' => 28.3097, 'weight' => 6],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Longacres',   'lat' => -15.4058, 'lng' => 28.3011, 'weight' => 5],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Ibex Hill',   'lat' => -15.4489, 'lng' => 28.3540, 'weight' => 5],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Rhodespark',  'lat' => -15.4058, 'lng' => 28.3103, 'weight' => 5],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Emmasdale',   'lat' => -15.3700, 'lng' => 28.3300, 'weight' => 5],
            ['province' => 'Lusaka Province', 'city' => 'Lusaka', 'ward' => 'Chalala',     'lat' => -15.4700, 'lng' => 28.3400, 'weight' => 4],
            ['province' => 'Lusaka Province', 'city' => 'Kafue',  'ward' => 'Kafue Central','lat' => -15.7690, 'lng' => 28.1810, 'weight' => 3],
            ['province' => 'Lusaka Province', 'city' => 'Chongwe','ward' => 'Chongwe Central','lat'=> -15.3358, 'lng' => 28.6803, 'weight' => 2],

            // Copperbelt Province
            ['province' => 'Copperbelt Province', 'city' => 'Ndola',      'ward' => 'Kansenshi',  'lat' => -12.9339, 'lng' => 28.6267, 'weight' => 9],
            ['province' => 'Copperbelt Province', 'city' => 'Ndola',      'ward' => 'Northrise',  'lat' => -12.9450, 'lng' => 28.6600, 'weight' => 6],
            ['province' => 'Copperbelt Province', 'city' => 'Ndola',      'ward' => 'Chifubu',    'lat' => -12.9700, 'lng' => 28.6200, 'weight' => 5],
            ['province' => 'Copperbelt Province', 'city' => 'Kitwe',      'ward' => 'Riverside',  'lat' => -12.8200, 'lng' => 28.1900, 'weight' => 9],
            ['province' => 'Copperbelt Province', 'city' => 'Kitwe',      'ward' => 'Parklands',  'lat' => -12.7950, 'lng' => 28.2300, 'weight' => 7],
            ['province' => 'Copperbelt Province', 'city' => 'Kitwe',      'ward' => 'Nkana',      'lat' => -12.8100, 'lng' => 28.2050, 'weight' => 6],
            ['province' => 'Copperbelt Province', 'city' => 'Chingola',   'ward' => 'Chingola Central', 'lat' => -12.5289, 'lng' => 27.8539, 'weight' => 5],
            ['province' => 'Copperbelt Province', 'city' => 'Mufulira',   'ward' => 'Mufulira Central', 'lat' => -12.5497, 'lng' => 28.2410, 'weight' => 4],
            ['province' => 'Copperbelt Province', 'city' => 'Luanshya',   'ward' => 'Luanshya Central', 'lat' => -13.1357, 'lng' => 28.4166, 'weight' => 3],
            ['province' => 'Copperbelt Province', 'city' => 'Kalulushi',  'ward' => 'Kalulushi Central', 'lat' => -12.8358, 'lng' => 28.0973, 'weight' => 2],

            // Southern Province
            ['province' => 'Southern Province', 'city' => 'Livingstone', 'ward' => 'Dambwa',  'lat' => -17.8300, 'lng' => 25.8300, 'weight' => 4],
            ['province' => 'Southern Province', 'city' => 'Livingstone', 'ward' => 'Maramba', 'lat' => -17.8500, 'lng' => 25.8700, 'weight' => 3],
            ['province' => 'Southern Province', 'city' => 'Choma',       'ward' => 'Choma Central', 'lat' => -16.8117, 'lng' => 26.9756, 'weight' => 3],
            ['province' => 'Southern Province', 'city' => 'Mazabuka',    'ward' => 'Mazabuka Central', 'lat' => -15.8562, 'lng' => 27.7614, 'weight' => 2],
            ['province' => 'Southern Province', 'city' => 'Monze',      'ward' => 'Monze Central', 'lat' => -16.2833, 'lng' => 27.4833, 'weight' => 2],

            // Central Province
            ['province' => 'Central Province', 'city' => 'Kabwe', 'ward' => 'Kabwe Central', 'lat' => -14.4400, 'lng' => 28.4500, 'weight' => 5],
            ['province' => 'Central Province', 'city' => 'Kabwe', 'ward' => 'Makululu',       'lat' => -14.4300, 'lng' => 28.4600, 'weight' => 3],
            ['province' => 'Central Province', 'city' => 'Kapiri Mposhi', 'ward' => 'Kapiri Central', 'lat' => -13.9667, 'lng' => 28.6667, 'weight' => 2],
            ['province' => 'Central Province', 'city' => 'Mkushi', 'ward' => 'Mkushi Central', 'lat' => -13.6167, 'lng' => 29.4000, 'weight' => 1],

            // Eastern Province
            ['province' => 'Eastern Province', 'city' => 'Chipata', 'ward' => 'Chipata Central', 'lat' => -13.6333, 'lng' => 32.6500, 'weight' => 4],
            ['province' => 'Eastern Province', 'city' => 'Katete',  'ward' => 'Katete Central',  'lat' => -14.0833, 'lng' => 32.0833, 'weight' => 2],
            ['province' => 'Eastern Province', 'city' => 'Petauke', 'ward' => 'Petauke Central', 'lat' => -14.2417, 'lng' => 31.3333, 'weight' => 1],

            // Northern Province
            ['province' => 'Northern Province', 'city' => 'Kasama', 'ward' => 'Kasama Central', 'lat' => -10.2117, 'lng' => 31.1808, 'weight' => 3],
            ['province' => 'Northern Province', 'city' => 'Mbala',  'ward' => 'Mbala Central',  'lat' => -8.8455,  'lng' => 31.3639, 'weight' => 1],

            // Luapula Province
            ['province' => 'Luapula Province', 'city' => 'Mansa',  'ward' => 'Mansa Central',  'lat' => -11.1994, 'lng' => 28.8942, 'weight' => 2],
            ['province' => 'Luapula Province', 'city' => 'Samfya', 'ward' => 'Samfya Central', 'lat' => -11.3572, 'lng' => 29.5567, 'weight' => 1],

            // North-Western Province
            ['province' => 'North-Western Province', 'city' => 'Solwezi', 'ward' => 'Solwezi Central', 'lat' => -12.1836, 'lng' => 26.3989, 'weight' => 3],

            // Western Province
            ['province' => 'Western Province', 'city' => 'Mongu', 'ward' => 'Mongu Central', 'lat' => -15.2757, 'lng' => 23.1258, 'weight' => 2],

            // Muchinga Province
            ['province' => 'Muchinga Province', 'city' => 'Chinsali', 'ward' => 'Chinsali Central', 'lat' => -10.5433, 'lng' => 32.0678, 'weight' => 1],
        ];
    }

    // ── Names ────────────────────────────────────────────────────────────────

    private function firstNames(): array
    {
        return [
            'Chanda', 'Mutale', 'Naomi', 'Bwalya', 'Chisomo', 'Kelvin', 'Thandiwe', 'Aaron', 'Mwaka', 'Grace',
            'Mumba', 'Kalunga', 'Chola', 'Mwansa', 'Bupe', 'Natasha', 'Given', 'Chomba', 'Nchimunya', 'Twaambo',
            'Mapalo', 'Chilufya', 'Kondwani', 'Musonda', 'Mwelwa', 'Chishala', 'Kabaso', 'Chilombo', 'Yolanda', 'Ruth',
            'Joseph', 'Emmanuel', 'Blessing', 'Precious', 'Gift', 'Loveness', 'Patricia', 'Beauty', 'Charity', 'Innocent',
            'Friday', 'Prince', 'Success', 'Comfort', 'Memory', 'Faith', 'Prudence', 'Mirriam', 'Doreen', 'Christabel',
            'Lubinda', 'Situmbeko', 'Inutu', 'Namakau', 'Sepiso', 'Mwansa', 'Kangwa', 'Chibwe', 'Chali', 'Kayula',
        ];
    }

    private function lastNames(): array
    {
        return [
            'Mwale', 'Banda', 'Phiri', 'Tembo', 'Nkonde', 'Mulenga', 'Lungu', 'Zulu', 'Siame', 'Mwansa',
            'Chanda', 'Kabwe', 'Musonda', 'Kaunda', 'Chilufya', 'Mumba', 'Sakala', 'Njovu', 'Daka', 'Zimba',
            'Nyirenda', 'Mbewe', 'Sichone', 'Simfukwe', 'Mubanga', 'Chishimba', 'Kapembwa', 'Chilangwa', 'Munkombwe', 'Habeenzu',
            'Chibwe', 'Sinyangwe', 'Kalaba', 'Chibale', 'Ngoma', 'Sikaonga', 'Mwiya', 'Muleya', 'Hamweene', 'Chizhande',
        ];
    }

    // ── Category catalogue ───────────────────────────────────────────────────

    private function categoryDemandWeights(): array
    {
        return [
            'cleaning'         => 12,
            'plumbing'         => 10,
            'electrical'       => 9,
            'hair-beauty'      => 10,
            'beauty-grooming'  => 6,
            'home-services'    => 8,
            'tutoring'         => 9,
            'photography'      => 5,
            'delivery'         => 6,
            'graphic-design'   => 5,
            'tech-support'     => 6,
            'laundry'          => 5,
            'gardening'        => 5,
            'catering'         => 4,
            'transport'        => 4,
            'security'         => 3,
            'digital-services' => 5,
        ];
    }

    /** slug => list of {title, desc, min, max, remote} */
    private function categoryTemplates(): array
    {
        return [
            'digital-services' => [
                ['title' => 'Website Design & Development',      'desc' => 'Custom business website, mobile-responsive, with basic SEO setup.', 'min' => 1500, 'max' => 4000, 'remote' => true],
                ['title' => 'Social Media Management (Monthly)', 'desc' => 'Content calendar, posting, and engagement across Facebook/Instagram/WhatsApp.', 'min' => 800, 'max' => 2000, 'remote' => true],
                ['title' => 'Virtual Assistant Services',        'desc' => 'Email management, scheduling, and admin support for busy professionals.', 'min' => 500, 'max' => 1500, 'remote' => true],
            ],
            'cleaning' => [
                ['title' => 'House Deep Cleaning',           'desc' => 'Thorough cleaning of 2-4 bedroom homes — supplies included.', 'min' => 150, 'max' => 350, 'remote' => false],
                ['title' => 'Office Cleaning Service',       'desc' => 'Regular or one-off office cleaning, after-hours available.', 'min' => 300, 'max' => 800, 'remote' => false],
                ['title' => 'Post-Construction Cleanup',     'desc' => 'Dust, debris, and paint-splatter removal after renovation work.', 'min' => 400, 'max' => 900, 'remote' => false],
            ],
            'beauty-grooming' => [
                ['title' => 'Full Spa Package',              'desc' => 'Facial, body scrub, and relaxation treatment at your home.', 'min' => 250, 'max' => 600, 'remote' => false],
                ['title' => 'Manicure & Pedicure',           'desc' => 'Full nail care service, gel or regular polish.', 'min' => 100, 'max' => 250, 'remote' => false],
                ['title' => 'Relaxation Massage Therapy',    'desc' => 'Full-body massage for stress relief, home visit available.', 'min' => 200, 'max' => 450, 'remote' => false],
            ],
            'plumbing' => [
                ['title' => 'Leaking Pipe & Tap Repair',       'desc' => 'Fast response for leaking taps, pipes, and joints.', 'min' => 150, 'max' => 400, 'remote' => false],
                ['title' => 'Geyser Installation & Repair',    'desc' => 'Electric and solar geyser installation, repair, and servicing.', 'min' => 400, 'max' => 1200, 'remote' => false],
                ['title' => 'Borehole & Water Tank Service',   'desc' => 'Borehole pump repair, water tank installation and cleaning.', 'min' => 600, 'max' => 2000, 'remote' => false],
                ['title' => 'Blocked Drain Clearing',          'desc' => 'Drain and toilet unblocking, same-day service.', 'min' => 120, 'max' => 350, 'remote' => false],
            ],
            'home-services' => [
                ['title' => 'Handyman — General Repairs',    'desc' => 'Small household repairs: doors, hinges, shelves, and more.', 'min' => 100, 'max' => 350, 'remote' => false],
                ['title' => 'Furniture Assembly',            'desc' => 'Flat-pack furniture assembly for bedroom and office.', 'min' => 100, 'max' => 300, 'remote' => false],
                ['title' => 'Interior & Exterior Painting',  'desc' => 'Full house painting, quality paint and clean finish.', 'min' => 500, 'max' => 2500, 'remote' => false],
                ['title' => 'Carpentry & Woodwork',          'desc' => 'Custom furniture, repairs, and built-in cabinets.', 'min' => 300, 'max' => 1200, 'remote' => false],
            ],
            'electrical' => [
                ['title' => 'Electrical Wiring & Fault Finding',    'desc' => 'Wiring faults, socket installation, and safety inspections.', 'min' => 200, 'max' => 700, 'remote' => false],
                ['title' => 'Solar Panel Installation',             'desc' => 'Full solar system installation for home or business.', 'min' => 2000, 'max' => 8000, 'remote' => false],
                ['title' => 'DB Board & Prepaid Meter Setup',       'desc' => 'Distribution board upgrades and prepaid meter installation.', 'min' => 350, 'max' => 900, 'remote' => false],
                ['title' => 'Generator Repair & Servicing',         'desc' => 'Diagnostics, servicing, and repair for home generators.', 'min' => 300, 'max' => 1000, 'remote' => false],
            ],
            'hair-beauty' => [
                ['title' => 'Box Braids & Cornrows',             'desc' => 'Neat, long-lasting braids and cornrow styles.', 'min' => 150, 'max' => 450, 'remote' => false],
                ['title' => 'Weave Installation',                'desc' => 'Sew-in and glueless weave installation, all textures.', 'min' => 250, 'max' => 600, 'remote' => false],
                ['title' => 'Bridal & Event Makeup',             'desc' => 'Full glam makeup for weddings and special occasions.', 'min' => 300, 'max' => 800, 'remote' => false],
                ['title' => "Men's Haircut & Grooming (Home Visit)", 'desc' => 'Fade, taper, and beard grooming at your location.', 'min' => 60, 'max' => 150, 'remote' => false],
            ],
            'tutoring' => [
                ['title' => 'Grade 8–12 Mathematics & Science',  'desc' => 'ECZ-aligned tutoring for high school maths and sciences.', 'min' => 100, 'max' => 300, 'remote' => true],
                ['title' => 'University-Level Tutoring',         'desc' => 'Accounting, economics, and engineering module support.', 'min' => 150, 'max' => 400, 'remote' => true],
                ['title' => 'ECZ Exam Preparation',              'desc' => 'Focused revision and past-paper practice for ECZ exams.', 'min' => 120, 'max' => 350, 'remote' => true],
                ['title' => 'Coding & Programming Lessons',      'desc' => 'Beginner to intermediate programming, Python and web basics.', 'min' => 200, 'max' => 500, 'remote' => true],
            ],
            'photography' => [
                ['title' => 'Wedding Photography Package',        'desc' => 'Full-day wedding coverage with edited digital gallery.', 'min' => 1500, 'max' => 5000, 'remote' => false],
                ['title' => 'Graduation & Portrait Photography',  'desc' => 'Studio or outdoor portrait sessions, quick turnaround.', 'min' => 300, 'max' => 800, 'remote' => false],
                ['title' => 'Product & E-commerce Photography',  'desc' => 'Clean product shots for online shops and catalogues.', 'min' => 350, 'max' => 900, 'remote' => false],
                ['title' => 'Drone Aerial Photography',           'desc' => 'Aerial shots and video for events and real estate.', 'min' => 500, 'max' => 1500, 'remote' => false],
            ],
            'delivery' => [
                ['title' => 'Same-Day Parcel Delivery',    'desc' => 'Fast motorbike delivery for documents and small parcels.', 'min' => 30, 'max' => 100, 'remote' => false],
                ['title' => 'Grocery Shopping & Delivery', 'desc' => 'Shop and deliver groceries from major supermarkets.', 'min' => 35, 'max' => 120, 'remote' => false],
                ['title' => 'Courier & Errand Service',    'desc' => 'Pickups, drop-offs, and general errands around town.', 'min' => 40, 'max' => 150, 'remote' => false],
            ],
            'graphic-design' => [
                ['title' => 'Logo & Brand Identity Design',        'desc' => 'Logo design with revisions and full brand file set.', 'min' => 300, 'max' => 900, 'remote' => true],
                ['title' => 'Flyers & Social Media Graphics',      'desc' => 'Eye-catching marketing graphics, 24-hour turnaround.', 'min' => 100, 'max' => 350, 'remote' => true],
                ['title' => 'Business Presentation Design',        'desc' => 'Professional slide decks for pitches and reports.', 'min' => 150, 'max' => 500, 'remote' => true],
            ],
            'tech-support' => [
                ['title' => 'Laptop Repair & Diagnostics',   'desc' => 'Hardware and software troubleshooting, on-site or drop-off.', 'min' => 150, 'max' => 500, 'remote' => false],
                ['title' => 'Phone Screen Repair',           'desc' => 'Screen replacement for popular Android and iPhone models.', 'min' => 250, 'max' => 700, 'remote' => false],
                ['title' => 'Wi-Fi & Network Setup',         'desc' => 'Router setup, extenders, and home network security.', 'min' => 150, 'max' => 450, 'remote' => true],
                ['title' => 'Data Recovery Service',         'desc' => 'Recover deleted files from laptops, phones, and drives.', 'min' => 150, 'max' => 500, 'remote' => false],
            ],
            'laundry' => [
                ['title' => 'Wash & Iron Service',       'desc' => 'Weekly or one-off wash and iron, pickup and delivery.', 'min' => 40, 'max' => 120, 'remote' => false],
                ['title' => 'Dry Cleaning Service',      'desc' => 'Professional dry cleaning for suits and formal wear.', 'min' => 60, 'max' => 200, 'remote' => false],
                ['title' => 'Hostel Laundry Pickup',     'desc' => 'Regular laundry plans for students in hostels.', 'min' => 35, 'max' => 90, 'remote' => false],
            ],
            'gardening' => [
                ['title' => 'Lawn Mowing & Trimming',        'desc' => 'Regular lawn care, edging and hedge trimming.', 'min' => 80, 'max' => 250, 'remote' => false],
                ['title' => 'Landscaping & Garden Design',   'desc' => 'Full garden makeovers, planting and layout design.', 'min' => 400, 'max' => 1500, 'remote' => false],
                ['title' => 'Tree Cutting & Removal',        'desc' => 'Safe tree felling and stump removal.', 'min' => 200, 'max' => 800, 'remote' => false],
            ],
            'catering' => [
                ['title' => 'Wedding & Event Catering',   'desc' => 'Full-service catering for weddings and large events.', 'min' => 2000, 'max' => 8000, 'remote' => false],
                ['title' => 'Private Chef Service',       'desc' => 'In-home chef for dinners and special occasions.', 'min' => 300, 'max' => 900, 'remote' => false],
                ['title' => 'Cake & Pastry Orders',       'desc' => 'Custom cakes for birthdays, weddings, and events.', 'min' => 150, 'max' => 600, 'remote' => false],
            ],
            'transport' => [
                ['title' => 'House Moving & Truck Hire',    'desc' => 'Truck and manpower for household and office moves.', 'min' => 400, 'max' => 1500, 'remote' => false],
                ['title' => 'Private Taxi Service',         'desc' => 'Reliable point-to-point rides around town.', 'min' => 60, 'max' => 250, 'remote' => false],
                ['title' => 'School Run Service (Monthly)', 'desc' => 'Daily school pickup and drop-off, monthly plan.', 'min' => 500, 'max' => 1200, 'remote' => false],
            ],
            'security' => [
                ['title' => 'Security Guard Service (Monthly)', 'desc' => 'Trained guards for homes and businesses.', 'min' => 2500, 'max' => 6000, 'remote' => false],
                ['title' => 'CCTV Installation',                'desc' => 'Camera system supply and installation with remote viewing.', 'min' => 1500, 'max' => 5000, 'remote' => false],
                ['title' => 'Electric Fence Installation',      'desc' => 'Perimeter electric fence supply and installation.', 'min' => 3000, 'max' => 9000, 'remote' => false],
                ['title' => 'Alarm System Installation',        'desc' => 'Home and office alarm system setup and monitoring.', 'min' => 1000, 'max' => 3000, 'remote' => false],
            ],
        ];
    }
}
