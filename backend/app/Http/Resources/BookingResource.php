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
            'agreed_amount'   => $this->agreed_amount !== null ? (float) $this->agreed_amount : null,
            'scheduled_start' => $this->scheduled_start?->toISOString(),
            'scheduled_end'   => $this->scheduled_end?->toISOString(),
            'expires_at'      => $this->expires_at?->toISOString(),
            'delivery_lat'    => $this->delivery_lat,
            'delivery_lng'    => $this->delivery_lng,
            'dispute_reason'  => $this->dispute_reason,
            'service'         => $this->whenLoaded('service', fn () => [
                'id'         => $this->service->id,
                'title'      => $this->service->title,
                'base_price' => $this->service->base_price,
            ]),
            'buyer'           => $this->whenLoaded('buyer', fn () => [
                'id'    => $this->buyer->id,
                'email' => $this->buyer->email,
            ]),
            'provider'        => $this->whenLoaded('provider', fn () => [
                'id'    => $this->provider->id,
                'email' => $this->provider->email,
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
