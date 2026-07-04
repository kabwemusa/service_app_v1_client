<?php

namespace App\Events;

class ReviewModerated extends NotifiableEvent
{
    public function __construct(
        public readonly string $providerId,
        public readonly string $reviewId,
        public readonly string $action, // 'removed' | 'restored' | 'response_removed'
        public readonly ?string $reason,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'REVIEW_MODERATION'; }
    public function recipientId(): string { return $this->providerId; }
    public function entityType(): ?string { return 'review'; }
    public function entityId(): ?string { return $this->reviewId; }
    public function settingsCategory(): string { return 'moderation'; }

    public function title(): string
    {
        return match ($this->action) {
            'removed'          => 'Review removed',
            'restored'         => 'Review restored',
            'response_removed' => 'Your response was removed',
            default            => 'Review update',
        };
    }

    public function body(): string
    {
        return match ($this->action) {
            'removed' => 'A review on your profile has been removed by a moderator.' . ($this->reason ? " Reason: {$this->reason}" : ''),
            'restored' => 'A previously removed review on your profile has been restored.',
            'response_removed' => 'Your response to a review has been removed by a moderator.' . ($this->reason ? " Reason: {$this->reason}" : ''),
            default => 'A review on your profile was updated by a moderator.',
        };
    }

    public function meta(): array
    {
        return ['action' => $this->action, 'reason' => $this->reason];
    }
}
