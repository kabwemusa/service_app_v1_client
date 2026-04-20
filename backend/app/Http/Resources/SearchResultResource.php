<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Transforms a raw search candidate row (stdClass from SearchService)
 * into the canonical API response shape.
 */
class SearchResultResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'          => $this->id,
            'provider_id' => $this->provider_id,
            'category'    => [
                'id'   => $this->cat_id,
                'name' => $this->category_name,
            ],
            'title'       => $this->title,
            'description' => $this->description,
            'base_price'  => (float) $this->base_price,
            'latitude'    => (float) $this->latitude,
            'longitude'   => (float) $this->longitude,
            'distance_km' => round((float) $this->distance_m / 1000, 2),
            'provider'    => [
                'id'              => $this->provider_id,
                'r_raw'           => round((float) $this->r_raw, 2),
                'r_bayes'         => round((float) ($this->r_bayes ?? 0), 3),
                'v_reviews'       => (int) $this->v_reviews,
                'completion_rate' => round((float) $this->completion_rate, 2),
                'kyc_status'      => $this->kyc_status,
            ],
            'sort_score'  => round((float) ($this->sort_score ?? 0), 4),
        ];
    }
}
