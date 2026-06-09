<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Booking extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->{$model->getKeyName()})) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'buyer_id',
        'provider_id',
        'service_id',
        'status',
        'amount',
        'buyer_protection_fee',
        'payout_eligible_at',
        'instant_payout_requested',
        'scheduled_start',
        'scheduled_end',
        'completed_at',
        'disbursed_at',
        'dispute_reason',
        'delivery_location_label',
        'delivery_location_region',
        'delivery_location_source',
    ];

    protected function casts(): array
    {
        return [
            'scheduled_start'          => 'datetime',
            'scheduled_end'            => 'datetime',
            'completed_at'             => 'datetime',
            'disbursed_at'             => 'datetime',
            'payout_eligible_at'       => 'datetime',
            'amount'                   => 'float',
            'buyer_protection_fee'     => 'float',
            'instant_payout_requested' => 'boolean',
        ];
    }

    // Appended by raw-SQL queries (BookingService)
    public float|null $delivery_lat = null;
    public float|null $delivery_lng = null;

    public function buyer()
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }

    public function service()
    {
        return $this->belongsTo(Service::class, 'service_id');
    }

    public function transactions()
    {
        return $this->hasMany(Transaction::class)->latest();
    }

    public function commission()
    {
        return $this->hasOne(\App\Models\Commission::class);
    }

    public function dispute()
    {
        return $this->hasOne(\App\Models\Dispute::class);
    }
}
