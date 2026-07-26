<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * Metadata for one masked/proxied voice call between the two booking parties.
 *
 * We store WHO initiated, WHEN, DURATION and the BOOKING — for dispute evidence
 * — and the masked (proxy) number the provider bridged through. We NEVER store
 * call content and NEVER store either party's real number here. Content is not
 * recorded at all (legal + cost + privacy).
 */
class BookingCallSession extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected $fillable = [
        'id', 'booking_id', 'initiator_id', 'initiator_role', 'provider',
        'session_ref', 'masked_number', 'status', 'reveal_expires_at',
        'started_at', 'answered_at', 'ended_at', 'duration_seconds', 'metadata',
    ];

    protected function casts(): array
    {
        return [
            'reveal_expires_at' => 'datetime',
            'started_at'        => 'datetime',
            'answered_at'       => 'datetime',
            'ended_at'          => 'datetime',
            'duration_seconds'  => 'integer',
            'metadata'          => 'array',
        ];
    }

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }

    public function initiator()
    {
        return $this->belongsTo(User::class, 'initiator_id');
    }
}
