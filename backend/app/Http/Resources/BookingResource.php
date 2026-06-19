<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'payment_mode'    => $this->payment_mode ?? 'ESCROW',
            'status'          => $this->status,
            'payment_status'  => $this->payment_status,
            // Two-party DIRECT settlement — each side independently (null = not yet).
            'provider_marked_paid_at' => $this->provider_marked_paid_at?->toISOString(),
            'customer_marked_paid_at' => $this->customer_marked_paid_at?->toISOString(),
            'agreed_amount'   => $this->agreed_amount !== null ? (float) $this->agreed_amount : null,
            'amount'          => $this->amount !== null ? (float) $this->amount : null,
            'buyer_protection_fee' => (float) ($this->buyer_protection_fee ?? 0),
            'scheduled_start' => $this->scheduled_start?->toISOString(),
            'scheduled_end'   => $this->scheduled_end?->toISOString(),
            'expires_at'      => $this->expires_at?->toISOString(),
            'completed_at'    => $this->completed_at?->toISOString(),
            'payout_eligible_at' => $this->payout_eligible_at?->toISOString(),
            // Auto-confirm deadline while DELIVERED (set by BookingService::findOrFail).
            'auto_release_at' => $this->auto_release_at ?? null,
            // Internal coordinates — used only to launch device maps, never displayed (§4.1).
            'delivery_lat'    => $this->delivery_lat,
            'delivery_lng'    => $this->delivery_lng,
            // Human-readable delivery label/region for display (§4.2).
            'delivery_location_label'  => $this->delivery_location_label,
            'delivery_location_region' => $this->delivery_location_region,
            'notes'           => $this->notes,
            'dispute_reason'  => $this->dispute_reason,
            'service'         => $this->whenLoaded('service', fn () => [
                'id'            => $this->service->id,
                'title'         => $this->service->title,
                'pricing_model' => $this->service->pricing_model,
                'base_price'    => $this->service->base_price,
                'category_name' => $this->service->category?->name,
                'category_icon' => $this->service->category?->icon_url,
            ]),
            'buyer'           => $this->whenLoaded('buyer', fn () => [
                'id'    => $this->buyer->id,
                'email' => $this->buyer->email,
                // Privacy-safe label + qualitative trust hint (§10.2) — never a numeric score.
                'name'       => $this->buyer_label ?? null,
                'trust_hint' => $this->buyer_trust_hint ?? null,
            ]),
            'provider'        => $this->whenLoaded('provider', fn () => [
                'id'           => $this->provider->id,
                'email'        => $this->provider->email,
                'display_name' => $this->provider->providerProfile?->display_name,
                // Public profile photo — never the KYC selfie.
                'avatar_url'   => $this->provider->providerProfile?->avatar_url,
                'trust_tier'   => (int) ($this->provider->providerProfile?->trust_tier ?? 0),
                // Bayesian rating (§7.1) — null until first review; never expose trust_score.
                'rating'       => (int) $this->provider->v_reviews > 0 ? round((float) $this->provider->r_raw, 2) : null,
                'reviews'      => (int) $this->provider->v_reviews,
                // DIRECT mobile-money details — shown ONLY to the buyer on an active,
                // payable booking (never public, never to other parties).
                'payment'      => (
                    $request->user()?->getKey() === $this->buyer_id
                    && ($this->payment_mode ?? 'ESCROW') === 'DIRECT'
                    && in_array($this->status, ['ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED'], true)
                    && $this->provider->providerProfile?->momo_number
                ) ? [
                    'momo_provider' => $this->provider->providerProfile?->momo_provider,
                    'momo_number'   => $this->provider->providerProfile?->momo_number,
                ] : null,
            ]),
            'transactions'    => $this->whenLoaded('transactions', fn () =>
                TransactionResource::collection($this->transactions)
            ),
            // v3 §7.1 — true once the buyer has left a review for this booking.
            'has_review'      => $this->relationLoaded('review')
                ? $this->review !== null
                : $this->review()->exists(),
            'created_at'      => $this->created_at?->toISOString(),
            'updated_at'      => $this->updated_at?->toISOString(),
        ];
    }
}
