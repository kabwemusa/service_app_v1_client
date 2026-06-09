<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SearchSuggestService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchSuggestController extends Controller
{
    public function __construct(private readonly SearchSuggestService $suggest) {}

    /**
     * GET /search/suggest?q=&lat=&lng=
     *
     * Returns up to 10 mixed suggestions (categories, services, providers)
     * for the autocomplete screen. `lat`/`lng` are optional delivery-location
     * coordinates; when provided they bias service/provider ranking by proximity.
     * No radius is exposed to the customer (v3.1 §4.1 hard invariant).
     */
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'q'   => ['required', 'string', 'min:1', 'max:100'],
            'lat' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'lng' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
        ]);

        $lat = $request->filled('lat') ? (float) $request->input('lat') : null;
        $lng = $request->filled('lng') ? (float) $request->input('lng') : null;

        // Require both or neither
        if (($lat === null) !== ($lng === null)) {
            $lat = null;
            $lng = null;
        }

        $result = $this->suggest->suggest(
            q:   $request->input('q'),
            lat: $lat,
            lng: $lng,
        );

        return ApiResponse::success($result, 'Suggestions retrieved.');
    }
}
