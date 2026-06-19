<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Transforms a raw search candidate row (stdClass from SearchService)
 * into the canonical API response shape.
 *
 * §7: Never expose trust_score (raw 0–1 float) to customer-facing clients.
 *     trust_tier (int 1-4) may be shown as a badge label.
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
                'icon' => $this->cat_icon,
            ],
            'title'         => $this->title,
            'description'   => $this->description,
            'pricing_model' => $this->pricing_model,
            'base_price'    => isset($this->base_price) ? (float) $this->base_price : null,
            // Platform payment mode a booking would be created under (drives CTA copy).
            'payment_mode'  => config('booking.payment_mode', 'DIRECT'),
            'latitude'      => (float) $this->latitude,
            'longitude'     => (float) $this->longitude,
            'distance_km'   => $this->distance_m !== null
                ? round((float) $this->distance_m / 1000, 2)
                : null,
            'has_promo_slot'      => (bool) ($this->has_promo_slot ?? false),
            // v3.2 §1.5 — structural, not cosmetic: positions 1/4 carry
            // promoted inventory; the client renders the "Promoted" label
            // from this field, never from heuristics.
            'placement'           => $this->placement ?? 'organic',
            'completed_job_count' => (int) ($this->completed_job_count ?? 0),
            'provider' => [
                'id'                     => $this->provider_id,
                'display_name'           => $this->display_name ?? '',
                'r_raw'                  => round((float) $this->r_raw, 2),
                'r_bayes'                => round((float) ($this->r_bayes ?? 0), 3),
                'v_reviews'              => (int) $this->v_reviews,
                // NULL = no history yet (v3.2 §4.1) — clients render "–", never 0%
                'completion_rate'        => $this->completion_rate !== null ? round((float) $this->completion_rate, 2) : null,
                'trust_tier'             => (int) ($this->trust_tier ?? 0),
                'response_time_p50_mins' => $this->response_time_p50_mins !== null
                    ? (int) $this->response_time_p50_mins
                    : null,
                'base_location_label'    => $this->base_location_label,
            ],
            'photo_urls' => json_decode($this->photo_urls ?? '[]', true) ?: [],
            'sort_score' => round((float) ($this->sort_score ?? 0), 4),
        ];
    }
}
