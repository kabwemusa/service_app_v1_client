<?php

namespace App\Services\WhatsApp;

use App\Contracts\DispatchService;
use App\Models\ProviderService;
use App\Models\User;

class TestDispatchService implements DispatchService
{
    public function shortlist(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
        array  $preferences = [],
    ): array {
        $providerServices = ProviderService::where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->with(['provider.providerProfile'])
            ->whereHas('provider', fn ($q) => $q->where('account_state', 'ACTIVE'))
            ->limit(3)
            ->get();

        if ($providerServices->isEmpty()) {
            return $this->cannedShortlist();
        }

        return $providerServices->map(fn (ProviderService $ps) => [
            'provider_id' => $ps->provider_id,
            'name'        => $ps->provider->legal_name ?? $ps->provider->email ?? 'Provider',
            'score'       => 0.85,
            'price'       => (float) ($ps->price ?? 100),
            'distance_km' => 5.0,
            'tier'        => $ps->provider->providerProfile?->trust_tier ?? 1,
        ])->values()->all();
    }

    public function autoMatch(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
    ): ?array {
        $shortlist = $this->shortlist($serviceId, $lat, $lng, $scheduledStart, $scheduledEnd);
        return $shortlist[0] ?? null;
    }

    public function cascade(string $bookingId): ?array
    {
        return null;
    }

    private function cannedShortlist(): array
    {
        return [
            [
                'provider_id' => 'test-provider-001',
                'name'        => 'Grace M.',
                'score'       => 0.92,
                'price'       => 150.00,
                'distance_km' => 3.2,
                'tier'        => 3,
            ],
            [
                'provider_id' => 'test-provider-002',
                'name'        => 'James K.',
                'score'       => 0.87,
                'price'       => 120.00,
                'distance_km' => 5.1,
                'tier'        => 2,
            ],
            [
                'provider_id' => 'test-provider-003',
                'name'        => 'New Provider',
                'score'       => 0.60,
                'price'       => 100.00,
                'distance_km' => 7.8,
                'tier'        => 1,
            ],
        ];
    }
}
