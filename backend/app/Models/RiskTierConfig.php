<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RiskTierConfig extends Model
{
    protected $fillable = [
        'risk_tier',
        'label',
        'eligibility_requirements',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'eligibility_requirements' => 'array',
        ];
    }

    public function requirementsForTrustTier(int $trustTier): array
    {
        $requirements = $this->eligibility_requirements ?? [];
        $key = "tier_{$trustTier}";
        return $requirements[$key] ?? $requirements['tier_1'] ?? [];
    }
}
