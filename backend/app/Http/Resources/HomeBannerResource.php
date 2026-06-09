<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class HomeBannerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'type'       => $this->type,
            'title'      => $this->title,
            'subtitle'   => $this->subtitle,
            'image_url'  => $this->image_url,
            'bg_token'   => $this->bg_token,
            'cta_label'  => $this->cta_label,
            'cta_action' => $this->cta_action,
        ];
    }
}
