<?php

namespace App\Models;

use App\Enums\DisputeStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Dispute extends Model
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
        'booking_id',
        'raised_by',
        'against',
        'reason_category',
        'description',
        'evidence',
        'status',
        'resolution_notes',
        'refund_amount',
        'resolved_by',
        'opened_at',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'evidence'      => 'array',
            'refund_amount' => 'float',
            'opened_at'     => 'datetime',
            'resolved_at'   => 'datetime',
        ];
    }

    public function disputeStatus(): DisputeStatus
    {
        return DisputeStatus::from($this->status);
    }

    public function isResolved(): bool
    {
        return $this->disputeStatus()->isResolved();
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }

    public function raisedByUser()
    {
        return $this->belongsTo(User::class, 'raised_by');
    }

    public function againstUser()
    {
        return $this->belongsTo(User::class, 'against');
    }

    public function resolvedBy()
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
