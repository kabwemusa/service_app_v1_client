<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProviderProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'user_id'              => $this->user_id,
            'display_name'         => $this->display_name,
            'bio'                  => $this->bio,
            'nrc_number'           => $this->nrc_number,
            'student_id_url'       => $this->student_id_url,
            'kyc_status'           => $this->kyc_status,
            'momo_provider'        => $this->momo_provider,
            'momo_number'          => $this->momo_number,
            'base_location_lat'    => $this->base_location_lat,
            'base_location_lng'    => $this->base_location_lng,
            'max_radius_km'        => $this->max_radius_km,
            'availability_matrix'  => $this->availability_matrix,
            'profile_completeness' => $this->profile_completeness,
        ];
    }
}
