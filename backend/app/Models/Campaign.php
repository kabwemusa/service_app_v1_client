<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * A Growth & Promotions campaign. The audience is resolved from live data at
 * eval time (see AudienceResolver) — the columns hold the *rule*, never a list
 * of users. Budget is enforced atomically via CampaignDiscountService.
 */
class Campaign extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'name',
        'audience_type',
        'audience_filter',
        'audience_params',
        'offer_type',
        'offer_value',
        'offer_params',
        'placements',
        'content',
        'code',
        'code_multi_use',
        'start_at',
        'end_at',
        'budget_cap',
        'budget_spent',
        'max_uses_per_user',
        'total_uses_cap',
        'total_uses',
        'status',
        'created_by_admin_id',
    ];

    protected function casts(): array
    {
        return [
            'audience_params'   => 'array',
            'offer_params'      => 'array',
            'placements'        => 'array',
            'content'           => 'array',
            'code_multi_use'    => 'boolean',
            'start_at'          => 'datetime',
            'end_at'            => 'datetime',
            'offer_value'       => 'float',
            'budget_cap'        => 'float',
            'budget_spent'      => 'float',
            'max_uses_per_user' => 'integer',
            'total_uses_cap'    => 'integer',
            'total_uses'        => 'integer',
        ];
    }

    public function ledgerEntries()
    {
        return $this->hasMany(CampaignLedgerEntry::class);
    }

    /**
     * LIVE + inside its schedule + budget remaining. This is the single
     * predicate used everywhere a campaign is considered "renderable/applicable"
     * before the per-user audience check.
     */
    public function isCurrentlyLive(): bool
    {
        if ($this->status !== 'LIVE') {
            return false;
        }
        $now = now();
        if ($this->start_at && $this->start_at->isAfter($now)) {
            return false;
        }
        if ($this->end_at && $this->end_at->isBefore($now)) {
            return false;
        }
        return $this->budgetRemaining() > 0.0;
    }

    /** Remaining ZMW budget (PHP_FLOAT_MAX when uncapped). */
    public function budgetRemaining(): float
    {
        if ($this->budget_cap === null) {
            return PHP_FLOAT_MAX;
        }
        return max(0.0, (float) $this->budget_cap - (float) $this->budget_spent);
    }

    /** True when this campaign renders in the given placement slot. */
    public function hasPlacement(string $slot): bool
    {
        return in_array($slot, $this->placements ?? [], true);
    }
}
