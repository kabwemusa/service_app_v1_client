<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\NotFoundException;
use App\Models\SavedLocation;
use App\Models\User;
use App\Services\Location\GazetteerService;
use App\Services\Location\GeocodingService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * v3.1 §4.2 — owns the user's primary location and address book.
 *
 * `users.primary_location*` and the `is_primary` row in `saved_locations`
 * are kept in lockstep: setting one updates the other so the address book
 * always mirrors the location discovery is currently anchored to.
 *
 * Every confirmed label also feeds the gazetteer (v3.2 §3.1) — the
 * accumulating Zambia-specific place index that improves autocomplete and
 * shrinks the external geocoding bill.
 */
class LocationService
{
    public function __construct(
        private readonly GeocodingService $geocoding,
        private readonly GazetteerService $gazetteer,
    ) {}

    public function searchPlaces(string $query, ?string $sessionToken = null): array
    {
        return array_map(
            fn (array $c) => $this->toApiShape($c),
            $this->geocoding->search($query, 5, $sessionToken),
        );
    }

    public function reverseGeocode(float $lat, float $lng): ?array
    {
        $result = $this->geocoding->reverseGeocode($lat, $lng);

        return $result !== null ? $this->toApiShape($result) : null;
    }

    /** Driver candidate → the {label, region} API shape (region = province). */
    private function toApiShape(array $candidate): array
    {
        return [
            'label'       => $candidate['label'],
            'place_name'  => $candidate['place_name'],
            'region'      => $candidate['region_province'] ?? null,
            'region_ward' => $candidate['region_ward'] ?? null,
            'lat'         => $candidate['lat'],
            'lng'         => $candidate['lng'],
            'gazetteer'   => (bool) ($candidate['gazetteer'] ?? false),
        ];
    }

    public function getPrimary(User $user): ?array
    {
        if (! $user->hasPrimaryLocation()) {
            return null;
        }

        return [
            'lat'    => $user->primary_location_lat,
            'lng'    => $user->primary_location_lng,
            'label'  => $user->primary_location_label,
            'region' => $user->primary_location_region,
            'source' => $user->primary_location_source,
        ];
    }

    /**
     * Set/replace the primary location (v3.1 §4.5-A). Mirrors the change into
     * `saved_locations` so the address book and the active anchor never drift.
     */
    public function setPrimary(User $user, array $data): User
    {
        // v3.2 §3.1 — a confirmed primary location is a verified
        // (geohash → label) pair: capture it in the gazetteer.
        $this->gazetteer->record(
            lat:            (float) $data['lat'],
            lng:            (float) $data['lng'],
            label:          (string) $data['label'],
            regionProvince: $data['region'] ?? null,
            regionWard:     $data['region_ward'] ?? null,
            source:         match ($data['source']) {
                'DEVICE' => GazetteerService::SOURCE_CONFIRMED_REVERSE,
                'SEARCH' => GazetteerService::SOURCE_SEARCH_PICK,
                default  => GazetteerService::SOURCE_SAVED_LOCATION,
            },
        );

        DB::transaction(function () use ($user, $data) {
            $user->update([
                'primary_location_lat'    => $data['lat'],
                'primary_location_lng'    => $data['lng'],
                'primary_location_label'  => $data['label'],
                'primary_location_region' => $data['region'] ?? null,
                'primary_location_source' => $data['source'],
            ]);

            SavedLocation::where('user_id', $user->id)->update(['is_primary' => false]);

            $primary = SavedLocation::where('user_id', $user->id)
                ->where('label', $data['label'])
                ->where('lat', $data['lat'])
                ->where('lng', $data['lng'])
                ->first();

            if ($primary) {
                $primary->update(['is_primary' => true]);
            } else {
                SavedLocation::create([
                    'user_id'    => $user->id,
                    'label'      => $data['label'],
                    'place_name' => $data['label'],
                    'lat'        => $data['lat'],
                    'lng'        => $data['lng'],
                    'region'     => $data['region'] ?? null,
                    'is_primary' => true,
                ]);
            }
        });

        return $user->fresh();
    }

    public function listSaved(User $user): Collection
    {
        return SavedLocation::where('user_id', $user->id)
            ->orderByDesc('is_primary')
            ->orderBy('created_at')
            ->get();
    }

    public function createSaved(User $user, array $data): SavedLocation
    {
        $count = SavedLocation::where('user_id', $user->id)->count();
        $limit = (int) config('location.saved_location_limit');

        if ($count >= $limit) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                "You can save up to {$limit} places. Remove one before adding another.",
            );
        }

        // Saved places are deliberate, named confirmations — prime gazetteer signal.
        $this->gazetteer->record(
            lat:            (float) $data['lat'],
            lng:            (float) $data['lng'],
            label:          (string) $data['label'],
            regionProvince: $data['region'] ?? null,
            regionWard:     $data['region_ward'] ?? null,
            source:         GazetteerService::SOURCE_SAVED_LOCATION,
        );

        return DB::transaction(function () use ($user, $data) {
            $makePrimary = (bool) ($data['is_primary'] ?? false);

            if ($makePrimary) {
                $this->makePrimaryEverywhere($user, $data);
            }

            return SavedLocation::create([
                'user_id'    => $user->id,
                'label'      => $data['label'],
                'place_name' => $data['place_name'],
                'lat'        => $data['lat'],
                'lng'        => $data['lng'],
                'region'     => $data['region'] ?? null,
                'is_primary' => $makePrimary,
            ]);
        });
    }

    public function updateSaved(User $user, string $id, array $data): SavedLocation
    {
        $location = $this->findOwned($user, $id);

        return DB::transaction(function () use ($user, $location, $data) {
            $makePrimary = array_key_exists('is_primary', $data) && (bool) $data['is_primary'];

            $location->update([
                'label'      => $data['label']      ?? $location->label,
                'place_name' => $data['place_name'] ?? $location->place_name,
                'lat'        => $data['lat']        ?? $location->lat,
                'lng'        => $data['lng']        ?? $location->lng,
                'region'     => $data['region']     ?? $location->region,
            ]);

            if ($makePrimary) {
                $this->makePrimaryEverywhere($user, [
                    'label'  => $location->label,
                    'lat'    => $location->lat,
                    'lng'    => $location->lng,
                    'region' => $location->region,
                ]);
                $location->update(['is_primary' => true]);
            }

            return $location->fresh();
        });
    }

    public function deleteSaved(User $user, string $id): void
    {
        $location = $this->findOwned($user, $id);

        if ($location->is_primary) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'You cannot delete your primary location. Set a different one as primary first.',
            );
        }

        $location->delete();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function findOwned(User $user, string $id): SavedLocation
    {
        $location = SavedLocation::where('id', $id)->where('user_id', $user->id)->first();

        if (! $location) {
            throw new NotFoundException('Saved location');
        }

        return $location;
    }

    /** Promotes the given coordinates to primary on both the user record and the address book. */
    private function makePrimaryEverywhere(User $user, array $data): void
    {
        $user->update([
            'primary_location_lat'    => $data['lat'],
            'primary_location_lng'    => $data['lng'],
            'primary_location_label'  => $data['label'],
            'primary_location_region' => $data['region'] ?? null,
            // Promoting an address-book entry is provenance "SEARCH" — DEVICE is reserved
            // for live GPS capture (users.primary_location_source enum, §4.2).
            'primary_location_source' => 'SEARCH',
        ]);

        SavedLocation::where('user_id', $user->id)->update(['is_primary' => false]);
    }
}
