<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * Append-only log of gateway collection/payout/refund events, written by
 * PaymentEventProcessor::record(). Observability only — it never drives the
 * booking lifecycle. Backs the admin Finance module's Escrow reconciliation tab,
 * where MATCHED/MISMATCH is computed at read time (booking status can move after
 * an event is logged, so storing the verdict would go stale).
 *
 * `provider` discriminates rows written by different processors: 'lipila' for new
 * rows, 'lenco' and 'pawapay' for historical ones.
 */
class PaymentEvent extends Model
{
    protected $table = 'payment_events';

    public $incrementing = false;
    protected $keyType   = 'string';
    public $timestamps   = false;

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            $model->id ??= (string) Str::uuid();
            $model->created_at ??= now();
        });
    }

    protected $fillable = [
        'booking_id', 'provider', 'external_ref', 'type', 'provider_status', 'mno', 'amount', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'amount'     => 'float',
            'created_at' => 'datetime',
        ];
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }
}
