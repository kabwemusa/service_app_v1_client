<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Category extends Model
{
    protected $fillable = ['name', 'icon_url', 'is_active', 'commission_rates'];

    protected function casts(): array
    {
        return [
            'is_active'        => 'boolean',
            'commission_rates' => 'array',
        ];
    }

    public function services()
    {
        return $this->hasMany(Service::class, 'category_id');
    }

    public function tierCommissionRate(int $tier): float
    {
        $rates = $this->commission_rates ?? [];
        return isset($rates[(string) $tier]) ? (float) $rates[(string) $tier] : match($tier) {
            1       => 0.18,
            2       => 0.15,
            3       => 0.13,
            default => 0.11,
        };
    }
}
