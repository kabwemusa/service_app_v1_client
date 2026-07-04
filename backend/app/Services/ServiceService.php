<?php

namespace App\Services;

use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Service;
use App\Models\User;
use App\Services\Location\RegionResolver;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * v3.1 §5 — the `services` entity: pricing model, status lifecycle,
 * inclusions/add-ons, and the live commission preview that backs the
 * "At {price}, {category}/{tier} commission is {rate}. You keep ~{net}."
 * line in the service editor (§6.7).
 */
class ServiceService
{
    public function __construct(
        private readonly CommissionService $commission,
        private readonly ProviderProfileService $providerProfile,
        private readonly RegionResolver $regionResolver,
    ) {}

    /**
     * List publicly browsable services (status = ACTIVE) with lat/lng
     * extracted from PostGIS. Supports optional category/provider filters.
     */
    public function list(array $filters = []): LengthAwarePaginator
    {
        $query = Service::with(['provider', 'category'])
            ->selectRaw("
                services.*,
                ST_Y(service_location::geometry) AS latitude,
                ST_X(service_location::geometry) AS longitude
            ")
            ->where('services.status', 'ACTIVE')
            ->whereHas('provider', function ($q) {
                $q->where('account_state', 'ACTIVE')
                  ->whereHas('providerProfile', function ($inner) {
                      $inner->where('trust_tier', '>=', 1);
                  });
            });

        if (! empty($filters['category_id'])) {
            $query->where('category_id', $filters['category_id']);
        }

        if (! empty($filters['provider_id'])) {
            $query->where('provider_id', $filters['provider_id']);
        }

        return $query->latest()->paginate(20);
    }

    /**
     * All services for the authenticated provider, any status — the
     * "Services — list/editor" surface (§6.7) needs to show drafts/paused too.
     */
    public function listMine(User $provider): LengthAwarePaginator
    {
        return Service::with(['category', 'inclusions', 'addons', 'photos'])
            // §6.7 list — surface a genuine "N booked" stat on each card (completed jobs only).
            ->withCount(['bookings as bookings_count' => fn ($q) => $q->where('status', 'COMPLETED')])
            ->selectRaw("
                services.*,
                ST_Y(service_location::geometry) AS latitude,
                ST_X(service_location::geometry) AS longitude
            ")
            ->where('provider_id', $provider->id)
            ->latest()
            ->paginate(20);
    }

    public function findOrFail(string $id): Service
    {
        $rows = DB::select("
            SELECT services.*,
                   ST_Y(service_location::geometry) AS latitude,
                   ST_X(service_location::geometry) AS longitude
            FROM services
            WHERE id = ?
            LIMIT 1
        ", [$id]);

        if (empty($rows)) {
            throw new NotFoundException('Service');
        }

        $service = Service::find($id);
        $service->latitude  = $rows[0]->latitude;
        $service->longitude = $rows[0]->longitude;

        // Load provider with their profile so ServiceResource can surface the
        // full provider card (avatar, tier, bio, badges, etc.) without a
        // separate API call from the client.
        $service->load(['category', 'provider.providerProfile', 'photos', 'inclusions', 'addons']);

        // Earned badges — computed from current metrics (v3 §9.2).
        if ($service->provider && $service->provider->providerProfile) {
            $service->setAttribute(
                'provider_badges',
                $this->providerProfile->earnedBadges($service->provider, $service->provider->providerProfile),
            );
        } else {
            $service->setAttribute('provider_badges', []);
        }

        // Recent reviews for the provider (up to 5 for the service detail snippet).
        $pid = $service->provider_id;

        $reviews = DB::select("
            SELECT r.id, r.rating, r.comment, r.created_at,
                   u.id            AS reviewer_id,
                   u.legal_name    AS reviewer_name
            FROM   reviews r
            JOIN   users   u ON u.id = r.reviewer_id
            WHERE  r.reviewee_id = ?
            ORDER  BY r.created_at DESC
            LIMIT  5
        ", [$pid]);

        $reviewCount = (int) (DB::selectOne(
            'SELECT COUNT(*) AS cnt FROM reviews WHERE reviewee_id = ?',
            [$pid],
        )?->cnt ?? 0);

        // Star distribution for the rating-bar chart (1–5).
        $starDist = DB::select("
            SELECT CAST(ROUND(rating::numeric) AS INTEGER) AS star,
                   COUNT(*) AS cnt
            FROM   reviews
            WHERE  reviewee_id = ?
            GROUP  BY ROUND(rating::numeric)
            ORDER  BY star DESC
        ", [$pid]);

        $service->setAttribute('provider_reviews',           $reviews);
        $service->setAttribute('provider_review_count',      $reviewCount);
        $service->setAttribute('provider_star_distribution', $starDist);

        return $service;
    }

    public function create(User $provider, array $data): Service
    {
        return DB::transaction(function () use ($provider, $data) {
            $pricingModel = $data['pricing_model'];

            $service = Service::create(array_merge([
                'provider_id'            => $provider->id,
                'category_id'            => $data['category_id'],
                'title'                  => $data['title'],
                'description'            => $data['description'] ?? null,
                'pricing_model'          => $pricingModel,
                'duration_estimate_mins' => $data['duration_estimate_mins'] ?? null,
                'status'                 => $data['status'] ?? 'DRAFT',
                'is_pinned'              => $data['is_pinned'] ?? false,
            ], $this->pricingFields($pricingModel, $data)));

            // Service location defaults to the provider's base location when the
            // provider doesn't pin a specific spot (dedup — one place to set it),
            // and can still be overridden per service.
            $base = $provider->providerProfile;
            $lat  = $data['latitude']  ?? $base?->base_location_lat;
            $lng  = $data['longitude'] ?? $base?->base_location_lng;

            if ($lat !== null && $lng !== null) {
                $this->setLocation($service->id, (float) $lat, (float) $lng);
            }

            $this->replaceInclusions($service, $data['inclusions'] ?? null);
            $this->replaceAddons($service, $data['addons'] ?? null);

            // §6.7 AC — publishing awards the §9.1 "list ≥3 services" checklist points.
            if ($service->status === 'ACTIVE') {
                $this->providerProfile->recalculateCompleteness($provider);
            }

            return $this->findOrFail($service->id);
        });
    }

    public function update(User $provider, string $id, array $data): Service
    {
        $service = Service::find($id);

        if (! $service) {
            throw new NotFoundException('Service');
        }

        if ($service->provider_id !== $provider->id) {
            throw new ForbiddenException('You do not own this service.');
        }

        return DB::transaction(function () use ($provider, $service, $data) {
            $pricingModel  = $data['pricing_model'] ?? $service->pricing_model;
            $statusChanged = array_key_exists('status', $data) && $data['status'] !== $service->status;

            $service->update(array_filter([
                'category_id'            => $data['category_id']            ?? null,
                'title'                  => $data['title']                  ?? null,
                'description'            => $data['description']            ?? null,
                'pricing_model'          => $data['pricing_model']          ?? null,
                'duration_estimate_mins' => $data['duration_estimate_mins'] ?? null,
                'status'                 => $data['status']                 ?? null,
                'is_pinned'              => $data['is_pinned']              ?? null,
            ], fn ($v) => $v !== null));

            // Pricing parameters travel with pricing_model — switching model clears
            // the fields the new model doesn't use, and any edit to the pricing
            // fields resolves the migration "review your cap" flag.
            $touchedPricing = array_key_exists('pricing_model', $data)
                || array_intersect(array_keys($data), ['base_price', 'hourly_rate', 'minimum_hours', 'cap_hours', 'deposit_percent', 'scope_prompts']);

            if ($touchedPricing) {
                foreach ($this->pricingFields($pricingModel, $data, $service) as $field => $value) {
                    $service->{$field} = $value;
                }
                $service->needs_pricing_review = false;
            }
            $service->save();

            if (isset($data['latitude'], $data['longitude'])) {
                $this->setLocation($service->id, $data['latitude'], $data['longitude']);
            }

            if (array_key_exists('inclusions', $data)) {
                $this->replaceInclusions($service, $data['inclusions']);
            }

            if (array_key_exists('addons', $data)) {
                $this->replaceAddons($service, $data['addons']);
            }

            // §6.7 AC — publishing/pausing changes the §9.1 "list ≥3 services" count.
            if ($statusChanged) {
                $this->providerProfile->recalculateCompleteness($provider);
            }

            return $this->findOrFail($service->id);
        });
    }

    public function delete(User $provider, string $id): void
    {
        $service = Service::find($id);

        if (! $service) {
            throw new NotFoundException('Service');
        }

        if ($service->provider_id !== $provider->id) {
            throw new ForbiddenException('You do not own this service.');
        }

        $wasActive = $service->status === 'ACTIVE';
        $service->delete();

        if ($wasActive) {
            $this->providerProfile->recalculateCompleteness($provider);
        }
    }

    /**
     * §6.7 live commission preview — "At {price}, {category}/{tier}
     * commission is {rate}. You keep ~{net}." Uses the provider's *actual*
     * tier rate (v3 §8.1) and the §8.2 commission math, pre-computed so the
     * editor can render it as the provider types a price.
     */
    public function commissionPreview(User $provider, int $categoryId, float $price): array
    {
        $tier = (int) ($provider->providerProfile?->trust_tier ?? 1);

        return $this->commission->calculate(
            gross:      $price,
            categoryId: $categoryId,
            tier:       $tier,
            providerId: $provider->id,
        );
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /**
     * Resolve the pricing columns for a model, clearing the ones it doesn't
     * use. base_price stays populated for every model as the ranking/browse
     * "from" price: the outcome price (OUTCOME_FIXED), the spend cap
     * (HOURLY_CAPPED — what the customer's hold will be), or null for the
     * quote-first models where no upfront price exists.
     */
    private function pricingFields(string $model, array $data, ?Service $existing = null): array
    {
        $get = fn (string $key) => array_key_exists($key, $data) ? $data[$key] : $existing?->{$key};

        return match ($model) {
            'OUTCOME_FIXED' => [
                'base_price'      => $get('base_price'),
                'hourly_rate'     => null,
                'minimum_hours'   => null,
                'cap_hours'       => null,
                'cap_amount'      => null,
                'deposit_percent' => null,
                'scope_prompts'   => null,
            ],
            'HOURLY_CAPPED' => (function () use ($get) {
                $rate = $get('hourly_rate');
                $cap  = $get('cap_hours');
                $capAmount = ($rate !== null && $cap !== null) ? round((float) $rate * (float) $cap, 2) : null;
                return [
                    'base_price'      => $capAmount,
                    'hourly_rate'     => $rate,
                    'minimum_hours'   => $get('minimum_hours'),
                    'cap_hours'       => $cap,
                    'cap_amount'      => $capAmount,
                    'deposit_percent' => null,
                    'scope_prompts'   => null,
                ];
            })(),
            'PROVIDER_SCOPE' => [
                'base_price'      => null,
                'hourly_rate'     => $get('hourly_rate'),
                'minimum_hours'   => null,
                'cap_hours'       => null,
                'cap_amount'      => null,
                'deposit_percent' => null,
                'scope_prompts'   => $get('scope_prompts'),
            ],
            'QUOTE_DEPOSIT' => [
                'base_price'      => null,
                'hourly_rate'     => null,
                'minimum_hours'   => null,
                'cap_hours'       => null,
                'cap_amount'      => null,
                'deposit_percent' => $get('deposit_percent') ?? 30,
                'scope_prompts'   => $get('scope_prompts'),
            ],
            default => [],
        };
    }

    private function setLocation(string $serviceId, float $lat, float $lng): void
    {
        // Resolve the service's region hierarchy (area → city → province) so the
        // search geo-widening can tier on it. Off in tests (seeded directly).
        $region = config('search.geo.auto_resolve_regions', true)
            ? $this->regionResolver->resolve($lat, $lng)
            : ['ward' => null, 'city' => null, 'province' => null];

        DB::statement(
            'UPDATE services
                SET service_location = ST_GeogFromText(?),
                    region_ward      = ?,
                    region_city      = ?,
                    region_province  = ?
              WHERE id = ?',
            ["POINT({$lng} {$lat})", $region['ward'], $region['city'], $region['province'], $serviceId],
        );
    }

    /** §5.2 — bullets are saved as a full ordered replacement (add/remove/reorder in one write). */
    private function replaceInclusions(Service $service, ?array $items): void
    {
        if ($items === null) {
            return;
        }

        $service->inclusions()->delete();

        foreach (array_values($items) as $position => $text) {
            $service->inclusions()->create(['position' => $position, 'text' => $text]);
        }
    }

    /** §5.3 — add-ons are saved as a full ordered replacement (add/remove/reorder in one write). */
    private function replaceAddons(Service $service, ?array $items): void
    {
        if ($items === null) {
            return;
        }

        $service->addons()->delete();

        foreach (array_values($items) as $position => $addon) {
            $service->addons()->create([
                'position' => $position,
                'name'     => $addon['name'],
                'price'    => $addon['price'],
            ]);
        }
    }
}
