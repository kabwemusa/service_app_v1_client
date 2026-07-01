<?php

namespace App\Contracts;

interface DispatchService
{
    /**
     * Build a ranked shortlist of eligible providers for a booking request.
     *
     * @param  string     $serviceId
     * @param  float      $lat           Delivery latitude
     * @param  float      $lng           Delivery longitude
     * @param  string     $scheduledStart ISO 8601
     * @param  string     $scheduledEnd   ISO 8601
     * @param  array      $preferences   Optional customer preferences (budget, language, etc.)
     * @return array<int, array{provider_id: string, score: float, price: float, distance_km: float}>
     */
    public function shortlist(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
        array  $preferences = [],
    ): array;

    /**
     * Auto-match: pick the single best provider and create an offer.
     * Returns null if no eligible provider found.
     *
     * @param  string  $serviceId
     * @param  float   $lat
     * @param  float   $lng
     * @param  string  $scheduledStart
     * @param  string  $scheduledEnd
     * @return array{provider_id: string, price: float}|null
     */
    public function autoMatch(
        string $serviceId,
        float  $lat,
        float  $lng,
        string $scheduledStart,
        string $scheduledEnd,
    ): ?array;

    /**
     * Cascade: after a provider declines/times-out, offer to the next in the shortlist.
     *
     * @param  string  $bookingId
     * @return array{provider_id: string, price: float}|null  Next offer, or null if exhausted
     */
    public function cascade(string $bookingId): ?array;
}
