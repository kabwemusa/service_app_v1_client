<?php

namespace App\Http\Controllers\Api;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Location\ReverseGeocodeRequest;
use App\Http\Requests\Location\SaveLocationRequest;
use App\Http\Requests\Location\SearchPlacesRequest;
use App\Http\Requests\Location\SetPrimaryLocationRequest;
use App\Http\Resources\SavedLocationResource;
use App\Services\LocationService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * v3.1 §4 — location capture & address book. Every response is
 * {label, region} shaped; raw coordinates never reach the client as
 * something to read or re-enter (§4.1 principles).
 */
class LocationController extends Controller
{
    public function __construct(private readonly LocationService $location) {}

    /** GET /location/search?q=... — forward geocode / place autocomplete (§4.3). */
    public function search(SearchPlacesRequest $request): JsonResponse
    {
        $results = $this->location->searchPlaces($request->validated('q'));

        return ApiResponse::success(
            collect($results)->map(fn (array $r) => [
                'label'       => $r['label'],
                'place_name'  => $r['place_name'],
                'region'      => $r['region'],
                // v3.2 §3.4 — township/ward level alongside province
                'region_ward' => $r['region_ward'] ?? null,
                // True for entries served from our own gazetteer (§3.1)
                'gazetteer'   => (bool) ($r['gazetteer'] ?? false),
                'lat'         => $r['lat'],
                'lng'         => $r['lng'],
            ]),
            'Place candidates retrieved.',
        );
    }

    /** POST /location/reverse — device GPS → readable label + region (§4.3). */
    public function reverse(ReverseGeocodeRequest $request): JsonResponse
    {
        $result = $this->location->reverseGeocode(
            (float) $request->validated('lat'),
            (float) $request->validated('lng'),
        );

        if (! $result) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'Could not resolve that location. Try searching for a place instead.',
            );
        }

        return ApiResponse::success($result, 'Location resolved.');
    }

    /** GET /me/location — the signed-in user's primary location, or null if unset. */
    public function showPrimary(Request $request): JsonResponse
    {
        return ApiResponse::success($this->location->getPrimary($request->user()), 'Primary location retrieved.');
    }

    /** PUT /me/location — set/replace the primary location (§4.5-A onboarding). */
    public function setPrimary(SetPrimaryLocationRequest $request): JsonResponse
    {
        $user = $this->location->setPrimary($request->user(), $request->validated());

        return ApiResponse::success($this->location->getPrimary($user), 'Primary location saved.');
    }

    /** GET /me/saved-locations — the address book (Home/Work/...), primary first. */
    public function indexSaved(Request $request): JsonResponse
    {
        $locations = $this->location->listSaved($request->user());

        return ApiResponse::success(SavedLocationResource::collection($locations), 'Saved locations retrieved.');
    }

    /** POST /me/saved-locations — add a place to the address book. */
    public function storeSaved(SaveLocationRequest $request): JsonResponse
    {
        $location = $this->location->createSaved($request->user(), $request->validated());

        return ApiResponse::success(new SavedLocationResource($location), 'Location saved.', 201);
    }

    /** PUT /me/saved-locations/{id} — rename/relocate/promote a saved place. */
    public function updateSaved(SaveLocationRequest $request, string $id): JsonResponse
    {
        $location = $this->location->updateSaved($request->user(), $id, $request->validated());

        return ApiResponse::success(new SavedLocationResource($location), 'Location updated.');
    }

    /** DELETE /me/saved-locations/{id} — remove a place (primary cannot be removed directly). */
    public function destroySaved(Request $request, string $id): JsonResponse
    {
        $this->location->deleteSaved($request->user(), $id);

        return ApiResponse::success(null, 'Location removed.');
    }
}
