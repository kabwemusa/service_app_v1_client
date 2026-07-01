<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TrustSignal extends Model
{
    protected $primaryKey = 'provider_id';
    public $incrementing  = false;
    protected $keyType    = 'string';

    protected $fillable = [
        'provider_id',
        'identity_strength',
        'reliability_pct',
        'on_time_pct',
        'dispute_rate',
        'financial_health',
        'bayesian_rating',
        'rating_count',
        'composite_score',
        'last_computed_at',
    ];

    protected function casts(): array
    {
        return [
            'identity_strength' => 'float',
            'reliability_pct'   => 'float',
            'on_time_pct'       => 'float',
            'dispute_rate'      => 'float',
            'financial_health'  => 'float',
            'bayesian_rating'   => 'float',
            'composite_score'   => 'float',
            'last_computed_at'  => 'datetime',
        ];
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }

    public function providerProfile()
    {
        return $this->belongsTo(ProviderProfile::class, 'provider_id', 'user_id');
    }
}
