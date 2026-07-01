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
        'payment_mode',
        'status',
        'amount',
        'agreed_amount',
        'quoted_amount',
        'quote_message',
        'buyer_protection_fee',
        'commission_split_zmw',
        'provider_split_zmw',
        'escrow_hold_ref',
        'legacy_payment_mode',
        'channel',
        'payment_status',
        'payment_marked_by',
        'payment_marked_at',
        'provider_marked_paid_at',
        'customer_marked_paid_at',
        'payout_eligible_at',
        'expires_at',
        'instant_payout_requested',
        'scheduled_start',
        'scheduled_end',
        'completed_at',
        'disbursed_at',
        'dispute_reason',
        'delivery_location_label',
        'delivery_location_region',
        'delivery_location_source',
        'notes',
        'selected_addon_ids',
    ];

    protected function casts(): array
    {
        return [
            'scheduled_start'          => 'datetime',
            'scheduled_end'            => 'datetime',
            'completed_at'             => 'datetime',
            'disbursed_at'             => 'datetime',
            'payout_eligible_at'       => 'datetime',
            'payment_marked_at'        => 'datetime',
            'provider_marked_paid_at'  => 'datetime',
            'customer_marked_paid_at'  => 'datetime',
            'expires_at'               => 'datetime',
            'amount'                   => 'float',
            'agreed_amount'            => 'float',
            'quoted_amount'            => 'float',
            'buyer_protection_fee'     => 'float',
            'commission_split_zmw'     => 'float',
            'provider_split_zmw'       => 'float',
            'instant_payout_requested' => 'boolean',
            'selected_addon_ids'       => 'array',
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

    public function review()
    {
        return $this->hasOne(\App\Models\Review::class);
    }
}
