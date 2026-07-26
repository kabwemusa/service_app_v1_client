<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * One immutable, versioned Booking Agreement ("Service Confirmation") document.
 *
 * Generated from real booking data on confirmation and re-generated as a NEW
 * version on a material change (approved quote, cap extension, reschedule) —
 * prior versions are kept. The document itself lives on the private disk at
 * document_path; the snapshot column is the exact data it was rendered from.
 *
 * Privacy: neither the snapshot nor the rendered document contains NRC, selfie,
 * coordinates, phone numbers, or trust score (see BookingAgreementService).
 */
class BookingAgreement extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected $fillable = [
        'id', 'booking_id', 'version', 'content_hash', 'status_snapshot', 'reason',
        'terms_version', 'terms_effective_date', 'format', 'document_path',
        'snapshot', 'generated_at',
    ];

    protected function casts(): array
    {
        return [
            'version'              => 'integer',
            'snapshot'             => 'array',
            'terms_effective_date' => 'date',
            'generated_at'         => 'datetime',
        ];
    }

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
            if (empty($model->generated_at)) {
                $model->generated_at = now();
            }
        });
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }
}
