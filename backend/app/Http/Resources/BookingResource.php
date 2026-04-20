<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'status'         => $this->status,
            'scheduled_start' => $this->scheduled_start?->toISOString(),
            'scheduled_end'   => $this->scheduled_end?->toISOString(),
            'delivery_lat'   => $this->delivery_lat,
            'delivery_lng'   => $this->delivery_lng,
            'dispute_reason' => $this->dispute_reason,
            'service'        => $this->whenLoaded('service', fn () => [
                'id'         => $this->service->id,
                'title'      => $this->service->title,
                'base_price' => $this->service->base_price,
            ]),
            'buyer'          => $this->whenLoaded('buyer', fn () => [
                'id'    => $this->buyer->id,
                'email' => $this->buyer->email,
            ]),
            'provider'       => $this->whenLoaded('provider', fn () => [
                'id'    => $this->provider->id,
                'email' => $this->provider->email,
            ]),
            'transactions'   => $this->whenLoaded('transactions', fn () =>
                TransactionResource::collection($this->transactions)
            ),
            'created_at'     => $this->created_at?->toISOString(),
            'updated_at'     => $this->updated_at?->toISOString(),
        ];
    }
}
