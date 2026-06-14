<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ServiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                     => $this->id,
            'provider_id'            => $this->provider_id,
            'category_id'            => $this->category_id,
            'category'               => new CategoryResource($this->whenLoaded('category')),
            'title'                  => $this->title,
            'description'            => $this->description,
            // Platform payment mode a new booking for this service would be created under
            // (DIRECT = pay provider directly, no escrow). Drives mode-aware CTA copy.
            'payment_mode'           => config('booking.payment_mode', 'DIRECT'),
            // §5.1/§5.5 — QUOTE listings carry no price; the client shows "By quote".
            'pricing_model'          => $this->pricing_model,
            'base_price'             => $this->base_price,
            'duration_estimate_mins' => $this->duration_estimate_mins,
            'status'                 => $this->status,
            'is_pinned'              => (bool) $this->is_pinned,
            // These are injected by ServiceService queries via ST_Y / ST_X
            'latitude'     => isset($this->latitude)  ? (float) $this->latitude  : null,
            'longitude'    => isset($this->longitude) ? (float) $this->longitude : null,
            // Populated when a distance-aware query is used (Phase 3 search)
            'distance_km'  => isset($this->distance_km) ? round((float) $this->distance_km / 1000, 2) : null,

            // ── Provider ────────────────────────────────────────────────────────
            // The show endpoint (findOrFail) eager-loads provider.providerProfile and
            // computes provider_badges / provider_reviews / provider_review_count /
            // provider_star_distribution as service attributes.  List endpoints only
            // load User (no providerProfile), so the extra fields fall back to null/[].
            'provider' => $this->whenLoaded('provider', fn () => [
                'id'                     => $this->provider->id,
                'display_name'           => $this->provider->providerProfile?->display_name,
                'bio'                    => $this->provider->providerProfile?->bio,
                // Public profile photo — never the KYC selfie (schema note, v3.1 task)
                'avatar_url'             => $this->provider->providerProfile?->avatar_url,
                'cover_image_url'        => $this->provider->providerProfile?->cover_image_url,
                'trust_tier'             => (int) ($this->provider->providerProfile?->trust_tier ?? 0),
                'kyc_status'             => $this->provider->providerProfile?->kyc_status,
                'year_started'           => $this->provider->providerProfile?->year_started,
                // v3.1 §6.6 — language set limited to supported codes: en/ny/bem/ton
                'languages'              => $this->provider->providerProfile?->languages ?? [],
                'certifications'         => $this->provider->providerProfile?->certifications ?? [],
                'base_location_label'    => $this->provider->providerProfile?->base_location_label,
                'response_time_p50_mins'  => $this->provider->providerProfile?->response_time_p50_mins,
                'availability_matrix'    => $this->provider->providerProfile?->availability_matrix,
                'repeat_client_rate'     => $this->provider->providerProfile?->repeat_client_rate !== null
                    ? round((float) $this->provider->providerProfile->repeat_client_rate, 3)
                    : null,
                // Bayesian-rated ranking metrics (v3 §7.1) — r_raw is the Bayesian-weighted
                // value stored on the user; trust_score is NEVER exposed to customers (§7).
                'r_raw'                  => round((float) $this->provider->r_raw, 2),
                'v_reviews'              => (int) $this->provider->v_reviews,
                // NULL = no history yet (v3.2 §4.1) — clients render "–", never 0%
                'completion_rate'        => $this->provider->completion_rate !== null
                    ? round((float) $this->provider->completion_rate, 3)
                    : null,
                // Earned badges (v3 §9.2) — set by findOrFail via ProviderProfileService::earnedBadges()
                'badges'                 => $this->provider_badges ?? [],
            ]),

            // ── Service inclusions / add-ons / photos ────────────────────────
            'inclusions'   => $this->whenLoaded('inclusions', fn () =>
                $this->inclusions->pluck('text')->values(), []
            ),
            'addons'       => $this->whenLoaded('addons', fn () =>
                $this->addons->map(fn ($addon) => [
                    'id'    => $addon->id,
                    'name'  => $addon->name,
                    'price' => (float) $addon->price,
                ])->values(), []
            ),
            'photos'       => $this->whenLoaded('photos', fn () =>
                ServicePhotoResource::collection($this->photos), []
            ),

            // ── Provider reviews (set only on the show / detail endpoint) ────
            // trust_score is NEVER surfaced here or anywhere in the customer UI (v3.1 §7).
            'reviews' => isset($this->provider_reviews)
                ? array_map(fn ($rev) => [
                    'id'         => $rev->id,
                    'rating'     => (float) $rev->rating,
                    'comment'    => $rev->comment,
                    'created_at' => $rev->created_at,
                    'reviewer'   => ['id' => $rev->reviewer_id, 'name' => $rev->reviewer_name],
                ], (array) $this->provider_reviews)
                : [],

            'review_count' => $this->provider_review_count ?? 0,

            // Star distribution for the rating-bar chart on the service detail screen.
            'star_distribution' => isset($this->provider_star_distribution)
                ? array_map(
                    fn ($row) => ['star' => (int) $row->star, 'count' => (int) $row->cnt],
                    (array) $this->provider_star_distribution,
                )
                : [],

            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
