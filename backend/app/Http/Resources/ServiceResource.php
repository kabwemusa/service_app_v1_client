<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ServiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'provider_id'  => $this->provider_id,
            'category_id'  => $this->category_id,
            'category'     => new CategoryResource($this->whenLoaded('category')),
            'title'        => $this->title,
            'description'  => $this->description,
            'base_price'   => $this->base_price,
            'is_active'    => $this->is_active,
            // These are injected by ServiceService queries via ST_Y / ST_X
            'latitude'     => isset($this->latitude)  ? (float) $this->latitude  : null,
            'longitude'    => isset($this->longitude) ? (float) $this->longitude : null,
            // Populated when a distance-aware query is used (Phase 3 search)
            'distance_km'  => isset($this->distance_km) ? round((float) $this->distance_km / 1000, 2) : null,
            'provider'     => $this->whenLoaded('provider', fn () => [
                'id'              => $this->provider->id,
                'r_raw'           => $this->provider->r_raw,
                'v_reviews'       => $this->provider->v_reviews,
                'completion_rate' => $this->provider->completion_rate,
            ]),
            'photos'       => $this->whenLoaded('photos', fn () =>
                ServicePhotoResource::collection($this->photos)
            ),
            'created_at'   => $this->created_at?->toISOString(),
        ];
    }
}
