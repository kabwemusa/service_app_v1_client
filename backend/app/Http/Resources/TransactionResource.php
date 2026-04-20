<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TransactionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            "id"             => $this->id,
            "type"           => $this->type,
            "status"         => $this->status,
            "amount_gross"   => (float) $this->amount_gross,
            "platform_fee"   => (float) $this->platform_fee,
            "amount_net"     => (float) $this->amount_net,
            "momo_reference" => $this->momo_reference,
            "retry_count"    => $this->retry_count,
            "next_retry_at"  => $this->next_retry_at?->toISOString(),
            "created_at"     => $this->created_at?->toISOString(),
        ];
    }
}
