<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * A single tap-to-send structured status update ("On my way", "Arrived", …).
 * Write-once: there is no updated_at and the app never edits a row — each update
 * is timestamped, immutable dispute evidence.
 */
class BookingStatusUpdate extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';
    // Immutable: created_at only, no updated_at.
    public $timestamps = false;

    protected $fillable = [
        'id', 'booking_id', 'actor_id', 'actor_role', 'type', 'payload', 'body', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'payload'    => 'array',
            'created_at' => 'datetime',
        ];
    }

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
            if (empty($model->created_at)) {
                $model->created_at = now();
            }
        });
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }

    public function actor()
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
