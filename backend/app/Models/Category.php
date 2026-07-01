<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Category extends Model
{
    protected $fillable = [
        'parent_id',
        'name',
        'slug',
        'synonyms',
        'icon_url',
        'icon',
        'is_active',
        'display_order',
        'risk_tier',
        'commission_band',
        'commission_rates',
    ];

    protected function casts(): array
    {
        return [
            'is_active'        => 'boolean',
            'synonyms'         => 'array',
            'commission_rates' => 'array',
        ];
    }

    public function parent()
    {
        return $this->belongsTo(Category::class, 'parent_id');
    }

    /** Active children only — used by the public GET /categories endpoint. */
    public function children()
    {
        return $this->hasMany(Category::class, 'parent_id')->where('is_active', true)->orderBy('display_order');
    }

    /** All children regardless of status — used by admin GET /admin/categories. */
    public function allChildren()
    {
        return $this->hasMany(Category::class, 'parent_id')->orderBy('display_order')->orderBy('name');
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
