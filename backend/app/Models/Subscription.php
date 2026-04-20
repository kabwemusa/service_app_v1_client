<?php

namespace App\Models;

use App\Enums\SubscriptionPlan;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Subscription extends Model
{
    public $incrementing = false;
    public $timestamps = false;
    protected $keyType = 'string';

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
        'provider_id',
        'plan',
        'status',
        'current_period_start',
        'current_period_end',
        'renews_at',
        'cancelled_at',
    ];

    protected function casts(): array
    {
        return [
            'current_period_start' => 'datetime',
            'current_period_end'   => 'datetime',
            'renews_at'            => 'datetime',
            'cancelled_at'         => 'datetime',
        ];
    }

    public function plan(): SubscriptionPlan
    {
        return SubscriptionPlan::from($this->attributes['plan'] ?? 'FREE');
    }

    public function isActive(): bool
    {
        return in_array($this->status, ['ACTIVE', 'GRACE'], true);
    }

    public function commissionDiscount(): float
    {
        return $this->plan()->commissionDiscount();
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }
}
