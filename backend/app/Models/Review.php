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
    ];

    protected function casts(): array
    {
        return [
            'rating' => 'float',
        ];
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
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
