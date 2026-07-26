<?php

namespace App\Services\Dispatch;

use App\Models\Service;
use Carbon\Carbon;

class RequestClassifier
{
    public function classify(string $serviceId, string $scheduledStart): array
    {
        $service  = Service::with('category')->find($serviceId);
        $riskTier = (int) ($service?->category?->risk_tier ?? 1);
        $isRemote = (bool) $service?->isRemote();

        $start    = Carbon::parse($scheduledStart, 'Africa/Lusaka');
        $hoursOut = max(0, now()->diffInHours($start, false));

        $isNow       = $hoursOut < 2;
        $isScheduled = ! $isNow;

        if ($riskTier >= 3 || $isScheduled) {
            $mode = 'considered';
        } else {
            $mode = 'instant';
        }

        // Remote (online) services dispatch nationwide regardless of category —
        // no rings, no distance.
        $geoMode = ($isRemote || $riskTier === 1) ? 'nationwide' : 'rings';

        return [
            'risk_tier'    => $riskTier,
            'risk_label'   => match ($riskTier) { 1 => 'Remote', 2 => 'Public Venue', 3 => 'In-Home', default => 'Unknown' },
            'service_mode' => $mode,
            'geo_mode'     => $geoMode,
            'is_urgent'    => $isNow,
            'hours_out'    => $hoursOut,
        ];
    }

    public function geoRings(string $geoMode): array
    {
        if ($geoMode === 'nationwide') {
            return [['label' => 'Nationwide', 'radius_km' => 99999]];
        }

        return [
            ['label' => 'Ring 1 (local)',     'radius_km' => config('dispatch.geo.ring1_km', 5)],
            ['label' => 'Ring 2 (city-wide)', 'radius_km' => config('dispatch.geo.ring2_km', 25)],
            ['label' => 'Ring 3 (inter-city)', 'radius_km' => config('dispatch.geo.ring3_km', 100)],
        ];
    }
}
