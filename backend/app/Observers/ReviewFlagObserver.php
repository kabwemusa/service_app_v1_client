<?php

namespace App\Observers;

use App\Events\AdminQueueEvent;
use App\Models\ReviewFlag;

class ReviewFlagObserver
{
    public function created(ReviewFlag $flag): void
    {
        AdminQueueEvent::fire('reviews', 'review.flagged', $flag->id, [
            'review_id'   => $flag->review_id,
            'reviewee_id' => $flag->reviewee_id,
            'reason'      => $flag->reason,
            'source'      => $flag->source,
        ]);
    }
}
