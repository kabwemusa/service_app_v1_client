<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A flag on a review (admin Reviews moderation queue). Written by upstream
 * systems — the report button, the text-moderation job, the nightly pattern
 * detector (§10.4) — and consumed read-only by the admin module.
 *
 * status: OPEN (in queue) | DISMISSED (not a violation) | ACTIONED (review removed).
 */
class ReviewFlag extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected $fillable = [
        'review_id',
        'reviewee_id',
        'reason',
        'source',
        'details',
        'reported_by',
        'status',
        'reviewed_by',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'details'     => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function review()
    {
        return $this->belongsTo(Review::class, 'review_id');
    }
}
