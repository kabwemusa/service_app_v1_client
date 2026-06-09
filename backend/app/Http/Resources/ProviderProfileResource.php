<?php

namespace App\Http\Resources;

use App\Enums\TrustTier;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProviderProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $tier = TrustTier::from($this->trust_tier ?? 0);

        return [
            'user_id'              => $this->user_id,
            'display_name'         => $this->display_name,
            'bio'                  => $this->bio,
            'year_started'         => $this->year_started,
            'languages'            => $this->languages ?? [],
            'nrc_number'           => $this->nrc_number,
            'student_id_url'       => $this->student_id_url,
            'kyc_status'           => $this->kyc_status,
            'trust_tier'           => $tier->value,
            'tier_label'           => $tier->label(),
            'trust_score'          => $this->trust_score,
            'momo_provider'        => $this->momo_provider,
            'momo_number'          => $this->momo_number,
            'base_location_lat'    => $this->base_location_lat,
            'base_location_lng'    => $this->base_location_lng,
            'max_radius_km'        => $this->max_radius_km,
            'service_radius_km'    => $this->service_radius_km,
            'availability_matrix'  => $this->availability_matrix,
            'cover_image_url'      => $this->cover_image_url,
            'portfolio_images'     => $this->portfolio_images ?? [],
            'certifications'       => $this->certifications ?? [],
            'highlights'           => $this->highlights ?? ['pinned_service_ids' => [], 'featured_photo_keys' => [], 'featured_badges' => []],
            'profile_completeness' => $this->profile_completeness,
        ];
    }
}
