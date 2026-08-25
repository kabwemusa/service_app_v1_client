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
        'payout_ref',
        'refund_ref',
        'legacy_payment_mode',
        'channel',
        'payment_status',
        'payment_marked_by',
        'payment_marked_at',
        'provider_marked_paid_at',
        'customer_marked_paid_at',
        'payout_eligible_at',
        'payout_claimed_at',
        'refunded_at',
        'idempotency_key',
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
        'scope_brief',
        'scope_brief_attachments',
        'provider_quote',
        'actual_hours_logged',
        'actual_charge_zmw',
        'job_started_at',
        'job_ended_at',
        'observed_minutes',
        'final_charge_zmw',
        'pause_events',
        'cap_extension_zmw',
        'cap_extension_ref',
        'cap_extension_requested_at',
        'deposit_amount',
        'balance_amount',
        'balance_hold_ref',
        'escrow_phase',
        // Growth & Promotions — the customer discount stamped at checkout.
        'campaign_id',
        'campaign_discount_zmw',
        'promo_code',
    ];

    protected function casts(): array
    {
        return [
            'scheduled_start'          => 'datetime',
            'scheduled_end'            => 'datetime',
            'completed_at'             => 'datetime',
            'disbursed_at'             => 'datetime',
            'payout_claimed_at'        => 'datetime',
            'refunded_at'              => 'datetime',
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
            'scope_brief'              => 'array',
            'scope_brief_attachments'  => 'array',
            'provider_quote'           => 'array',
            'actual_hours_logged'      => 'float',
            'actual_charge_zmw'        => 'float',
            'job_started_at'           => 'datetime',
            'job_ended_at'             => 'datetime',
            'observed_minutes'         => 'integer',
            'final_charge_zmw'         => 'float',
            'pause_events'             => 'array',
            'cap_extension_zmw'        => 'float',
            'cap_extension_requested_at' => 'datetime',
            'deposit_amount'           => 'float',
            'balance_amount'           => 'float',
            'campaign_discount_zmw'    => 'float',
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

    public function statusUpdates()
    {
        return $this->hasMany(BookingStatusUpdate::class)->orderBy('created_at');
    }

    public function agreements()
    {
        return $this->hasMany(BookingAgreement::class)->orderByDesc('version');
    }

    /** The current (latest-version) Booking Agreement, if one exists. */
    public function latestAgreement()
    {
        return $this->hasOne(BookingAgreement::class)->latestOfMany('version');
    }
}
