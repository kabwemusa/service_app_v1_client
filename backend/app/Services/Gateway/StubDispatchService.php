<?php

namespace App\Services\Gateway;

use App\Contracts\DispatchService;

class StubDispatchService implements DispatchService
{
    public function shortlist(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
        array  $preferences = [],
    ): array {
        // Phase 3: implement ranked shortlist with trust scoring + fairness floor
        return [];
    }

    public function autoMatch(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
    ): ?array {
        // Phase 3: implement auto-match (pick best provider)
        return null;
    }

    public function cascade(string $bookingId): ?array
    {
        // Phase 3: implement cascade (offer to next provider after decline/timeout)
        return null;
    }
}
