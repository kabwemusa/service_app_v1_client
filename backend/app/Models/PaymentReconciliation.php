<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class PaymentReconciliation extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    public const KIND_REFUND  = 'REFUND';
    public const KIND_PAYOUT  = 'PAYOUT';
    public const KIND_BALANCE = 'BALANCE_COLLECTION';

    public const STATUS_PENDING   = 'PENDING';
    public const STATUS_RESOLVED  = 'RESOLVED';
    public const STATUS_ABANDONED = 'ABANDONED';

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
        'booking_id', 'kind', 'amount', 'hold_ref', 'phone',
        'status', 'attempts', 'last_error', 'next_attempt_at', 'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'amount'          => 'float',
            'attempts'        => 'integer',
            'next_attempt_at' => 'datetime',
            'resolved_at'     => 'datetime',
        ];
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }
}
