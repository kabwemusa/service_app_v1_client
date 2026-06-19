<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CategoryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // Admin endpoint eager-loads `allChildren`; public endpoint loads `children` (active only).
        $childRelation = $this->relationLoaded('allChildren') ? 'allChildren' : 'children';

        return [
            'id'               => $this->id,
            'parent_id'        => $this->parent_id,
            'name'             => $this->name,
            'slug'             => $this->slug,
            'synonyms'         => $this->synonyms ?? [],
            'icon'             => $this->icon,
            'icon_url'         => $this->icon_url,
            'is_active'        => $this->is_active,
            'display_order'    => $this->display_order,
            'commission_band'  => $this->commission_band,
            'commission_rates' => $this->commission_rates,
            'children'         => $this->when(
                $this->relationLoaded($childRelation),
                fn () => CategoryResource::collection($this->$childRelation),
                [],
            ),
        ];
    }
}
