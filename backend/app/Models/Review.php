<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single review for a completed booking (v3 §7.1). One row per booking
 * (unique booking_id). A DB trigger keeps users.r_raw / users.v_reviews in
 * sync with the reviewee's average rating on insert.
 */
class Review extends Model
{
    protected $fillable = [
        'booking_id',
        'reviewer_id',
        'reviewee_id',
        'rating',
        'comment',
        // Admin moderation bookkeeping (§7.1 / §10.4) — reviews are never edited,
        // only soft-removed / restored; responses moderated separately.
        'removed_at',
        'removed_by',
        'flags_cleared_at',
        'response_text',
        'response_at',
        'response_removed_at',
    ];

    protected function casts(): array
    {
        return [
            'rating'              => 'float',
            'removed_at'          => 'datetime',
            'flags_cleared_at'    => 'datetime',
            'response_at'         => 'datetime',
            'response_removed_at' => 'datetime',
        ];
    }

    /** A removed review stops counting toward the provider's rating. */
    public function isRemoved(): bool
    {
        return $this->removed_at !== null;
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }

    public function flags()
    {
        return $this->hasMany(ReviewFlag::class, 'review_id');
    }

    public function reviewer()
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }

    public function reviewee()
    {
        return $this->belongsTo(User::class, 'reviewee_id');
    }
}
