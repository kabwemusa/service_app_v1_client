<?php

namespace App\Events;

class VerificationUpdated extends NotifiableEvent
{
    public function __construct(
        public readonly string $userId,
        public readonly string $outcome, // 'approved' | 'rejected' | 'info_requested'
        public readonly int    $newTier,
        public readonly ?string $reason,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'VERIFICATION_UPDATE'; }
    public function recipientId(): string { return $this->userId; }
    public function entityType(): ?string { return 'verification'; }
    public function entityId(): ?string { return null; }
    public function settingsCategory(): string { return 'verification'; }

    public function title(): string
    {
        return match ($this->outcome) {
            'approved'       => 'Verification approved',
            'rejected'       => 'Verification update',
            'info_requested' => 'More info needed',
            default          => 'Verification update',
        };
    }

    public function body(): string
    {
        return match ($this->outcome) {
            'approved'       => "Congratulations! You've reached Tier {$this->newTier}. New capabilities unlocked.",
            'rejected'       => $this->reason ?? 'Your document was not approved. Check your verification status for details.',
            'info_requested' => $this->reason ?? 'We need additional information for your verification. Check your verification status.',
            default          => 'Your verification status has been updated.',
        };
    }

    public function meta(): array
    {
        return [
            'outcome' => $this->outcome,
            'tier'    => $this->newTier,
        ];
    }
}
