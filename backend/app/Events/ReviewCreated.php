<?php

namespace App\Events;

use App\Models\Review;

class ReviewCreated extends NotifiableEvent
{
    public function __construct(public readonly Review $review) { parent::__construct(); }

    public function notificationType(): string { return 'NEW_REVIEW'; }
    public function recipientId(): string { return $this->review->reviewee_id; }
    public function entityType(): ?string { return 'review'; }
    public function entityId(): ?string { return $this->review->reviewee_id; }
    public function settingsCategory(): string { return 'reviews'; }

    public function title(): string { return 'New review received'; }
    public function body(): string
    {
        $stars = str_repeat('★', (int) $this->review->rating);
        return "{$stars} " . ($this->review->comment
            ? '"' . mb_substr($this->review->comment, 0, 80) . (mb_strlen($this->review->comment) > 80 ? '…' : '') . '"'
            : 'No comment.');
    }

    public function meta(): array
    {
        return [
            'rating'  => (float) $this->review->rating,
            'comment' => $this->review->comment,
        ];
    }
}
