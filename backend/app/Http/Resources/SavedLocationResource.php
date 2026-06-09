<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Same contract as `getPrimary()` — `lat`/`lng` travel with the resource because
 * the client needs them to anchor search/booking when a saved place is chosen as
 * the delivery location (§4.5-B). The UI itself never renders them; only `label`/
 * `place_name`/`region` ever reach the screen as text (v3.1 §4.1).
 */
class SavedLocationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'label'      => $this->label,
            'place_name' => $this->place_name,
            'region'     => $this->region,
            'lat'        => (float) $this->lat,
            'lng'        => (float) $this->lng,
            'is_primary' => (bool) $this->is_primary,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
