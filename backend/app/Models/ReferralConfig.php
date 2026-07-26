<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Single-row configuration for the referral mechanic. Modelled and admin-editable,
 * but `enabled` defaults to false — the live referrer/referee reward flow is not
 * yet implemented (surfaced in the admin Referrals tab as "not yet active").
 */
class ReferralConfig extends Model
{
    protected $fillable = [
        'enabled',
        'referrer_reward_zmw',
        'referee_reward_zmw',
        'max_referrals_per_user',
        'budget_cap',
        'budget_spent',
    ];

    protected function casts(): array
    {
        return [
            'enabled'                => 'boolean',
            'referrer_reward_zmw'    => 'float',
            'referee_reward_zmw'     => 'float',
            'max_referrals_per_user' => 'integer',
            'budget_cap'             => 'float',
            'budget_spent'           => 'float',
        ];
    }

    /** The single config row, created with defaults on first access. */
    public static function current(): self
    {
        return static::query()->firstOrCreate(['id' => 1]);
    }
}
