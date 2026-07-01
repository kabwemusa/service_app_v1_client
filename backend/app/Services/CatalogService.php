<?php

namespace App\Services;

use App\Exceptions\Api\NotFoundException;
use App\Models\Category;
use App\Models\ProviderService;
use App\Models\Service;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

class CatalogService
{
    public function categories(bool $activeOnly = true): Collection
    {
        $query = Category::whereNull('parent_id')
            ->orderBy('display_order')
            ->orderBy('name');

        if ($activeOnly) {
            $query->where('is_active', true)->with(['children']);
        } else {
            $query->with(['allChildren']);
        }

        return $query->get();
    }

    public function categoryBySlug(string $slug): Category
    {
        $category = Category::where('slug', $slug)->first();

        if (! $category) {
            throw new NotFoundException('Category');
        }

        return $category->load(['children']);
    }

    public function browseServices(array $filters = []): LengthAwarePaginator
    {
        $query = Service::with(['category', 'photos'])
            ->where('services.status', 'ACTIVE')
            ->whereHas('provider', function ($q) {
                $q->where('account_state', 'ACTIVE')
                    ->whereHas('providerProfile', fn ($inner) => $inner->where('trust_tier', '>=', 1));
            });

        if (! empty($filters['category_id'])) {
            $categoryIds = $this->categoryWithDescendantIds((int) $filters['category_id']);
            $query->whereIn('category_id', $categoryIds);
        }

        if (! empty($filters['pricing_model'])) {
            $query->where('pricing_model', $filters['pricing_model']);
        }

        $query->selectRaw('
            services.*,
            (SELECT MIN(ps.price) FROM provider_services ps
             WHERE ps.service_id = services.id AND ps.status = \'ACTIVE\' AND ps.price IS NOT NULL
            ) AS min_provider_price
        ');

        $sortBy = $filters['sort'] ?? 'popular';
        match ($sortBy) {
            'price_asc'  => $query->orderByRaw('COALESCE(min_provider_price, base_price) ASC NULLS LAST'),
            'price_desc' => $query->orderByRaw('COALESCE(min_provider_price, base_price) DESC NULLS LAST'),
            'newest'     => $query->latest(),
            default      => $query->latest(),
        };

        return $query->paginate($filters['per_page'] ?? 20);
    }

    public function serviceDetail(string $serviceId): Service
    {
        $service = Service::find($serviceId);

        if (! $service || $service->status !== 'ACTIVE') {
            throw new NotFoundException('Service');
        }

        $service->load(['category', 'photos', 'inclusions', 'addons']);

        $service->setAttribute('min_price', $this->minPrice($serviceId));
        $service->setAttribute('provider_count', $this->activeProviderCount($serviceId));

        return $service;
    }

    public function serviceProviders(string $serviceId, array $filters = []): LengthAwarePaginator
    {
        $query = ProviderService::with(['provider.providerProfile', 'service'])
            ->where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->whereHas('provider', function ($q) {
                $q->where('account_state', 'ACTIVE')
                    ->whereHas('providerProfile', fn ($inner) => $inner->where('trust_tier', '>=', 1));
            });

        $sortBy = $filters['sort'] ?? 'price_asc';
        match ($sortBy) {
            'price_asc'   => $query->orderByRaw('COALESCE(price, 0) ASC'),
            'price_desc'  => $query->orderByRaw('COALESCE(price, 0) DESC'),
            'rating_desc' => $query->orderByRaw('COALESCE(avg_rating, 0) DESC'),
            default       => $query->orderByRaw('COALESCE(price, 0) ASC'),
        };

        return $query->paginate($filters['per_page'] ?? 20);
    }

    public function minPrice(string $serviceId): ?float
    {
        $min = ProviderService::where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->whereNotNull('price')
            ->min('price');

        if ($min !== null) {
            return (float) $min;
        }

        return Service::where('id', $serviceId)->value('base_price');
    }

    public function activeProviderCount(string $serviceId): int
    {
        return ProviderService::where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->whereHas('provider', function ($q) {
                $q->where('account_state', 'ACTIVE');
            })
            ->count();
    }

    private function categoryWithDescendantIds(int $categoryId): array
    {
        $ids = [$categoryId];
        $children = Category::where('parent_id', $categoryId)->where('is_active', true)->pluck('id')->all();
        foreach ($children as $childId) {
            $ids = array_merge($ids, $this->categoryWithDescendantIds($childId));
        }
        return $ids;
    }
}
