<?php

namespace App\Services;

use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Models\Service;
use App\Models\User;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

class ServiceService
{
    /**
     * List active services with lat/lng extracted from PostGIS.
     * Supports optional category filter and pagination.
     */
    public function list(array $filters = []): LengthAwarePaginator
    {
        $query = Service::with(['provider', 'category'])
            ->selectRaw("
                services.*,
                ST_Y(service_location::geometry) AS latitude,
                ST_X(service_location::geometry) AS longitude
            ")
            ->where('is_active', true);

        if (! empty($filters['category_id'])) {
            $query->where('category_id', $filters['category_id']);
        }

        if (! empty($filters['provider_id'])) {
            $query->where('provider_id', $filters['provider_id']);
        }

        return $query->latest()->paginate(20);
    }

    /**
     * All services for the authenticated provider (active + inactive).
     */
    public function listMine(User $provider): LengthAwarePaginator
    {
        return Service::with('category')
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

        return $service->load(['category', 'provider', 'photos']);
    }

    public function create(User $provider, array $data): Service
    {
        $service = Service::create([
            'provider_id'  => $provider->id,
            'category_id'  => $data['category_id'],
            'title'        => $data['title'],
            'description'  => $data['description'] ?? null,
            'base_price'   => $data['base_price'],
            'is_active'    => $data['is_active'] ?? true,
        ]);

        $this->setLocation($service->id, $data['latitude'], $data['longitude']);

        return $this->findOrFail($service->id);
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

        $service->update(array_filter([
            'category_id' => $data['category_id'] ?? null,
            'title'       => $data['title']       ?? null,
            'description' => $data['description'] ?? null,
            'base_price'  => $data['base_price']  ?? null,
            'is_active'   => $data['is_active']   ?? null,
        ], fn ($v) => $v !== null));

        if (isset($data['latitude'], $data['longitude'])) {
            $this->setLocation($service->id, $data['latitude'], $data['longitude']);
        }

        return $this->findOrFail($service->id);
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

        $service->delete();
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function setLocation(string $serviceId, float $lat, float $lng): void
    {
        DB::statement(
            "UPDATE services SET service_location = ST_GeogFromText(?) WHERE id = ?",
            ["POINT({$lng} {$lat})", $serviceId],
        );
    }
}
