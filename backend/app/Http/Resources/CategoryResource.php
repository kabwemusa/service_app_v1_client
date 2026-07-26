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
            // Risk tier (1=remote, 2=public, 3=in-home) — sets the verification
            // a provider needs to receive jobs in this category (onboarding offer step).
            'risk_tier'        => $this->risk_tier !== null ? (int) $this->risk_tier : null,
            'display_order'    => $this->display_order,
            'commission_band'  => $this->commission_band,
            'commission_rates' => $this->commission_rates,
            // ── Category-driven pricing guidance (steers the service editor) ──
            // Raw admin-editable fields (null = "use platform default")…
            'default_pricing_model'      => $this->default_pricing_model,
            'recommended_pricing_models' => $this->recommended_pricing_models,
            'pricing_rationale'          => $this->pricing_rationale,
            'pricing_mismatch_warning'   => $this->pricing_mismatch_warning,
            // …plus the RESOLVED guidance the clients render (config fallbacks
            // applied here so no client re-implements the fallback logic).
            'pricing_guidance' => [
                'default_model' => $this->defaultPricingModel(),
                'recommended'   => $this->recommendedPricingModels(),
                'rationale'     => $this->pricing_rationale
                    ?: (string) config('pricing.models.' . $this->defaultPricingModel() . '.rationale', ''),
                'mismatch_warning' => $this->pricing_mismatch_warning
                    ?: (string) config('pricing.default_mismatch_warning', ''),
            ],
            'children'         => $this->when(
                $this->relationLoaded($childRelation),
                fn () => CategoryResource::collection($this->$childRelation),
                [],
            ),
        ];
    }
}
