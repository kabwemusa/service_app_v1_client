<?php

namespace App\Events;

class AccountModerated extends NotifiableEvent
{
    public function __construct(
        public readonly string $userId,
        public readonly string $action, // 'warned' | 'suspended' | 'banned' | 'reinstated'
        public readonly ?string $reason,
        public readonly ?string $suspendedUntil = null,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'ACCOUNT_MODERATION'; }
    public function recipientId(): string { return $this->userId; }
    public function entityType(): ?string { return 'user'; }
    public function entityId(): ?string { return null; }
    public function settingsCategory(): string { return 'moderation'; }
    public function isTimeCritical(): bool { return in_array($this->action, ['suspended', 'banned'], true); }

    public function title(): string
    {
        return match ($this->action) {
            'warned'     => 'Account warning',
            'suspended'  => 'Account suspended',
            'banned'     => 'Account suspended',
            'reinstated' => 'Account reinstated',
            default      => 'Account update',
        };
    }

    public function body(): string
    {
        return match ($this->action) {
            'warned' => $this->reason
                ? "You've received a warning: {$this->reason}"
                : "You've received a warning. Please review our community guidelines.",
            'suspended' => $this->suspendedUntilBody(),
            'banned' => $this->reason
                ? "Your account has been suspended. Reason: {$this->reason} Contact support if you believe this is an error."
                : 'Your account has been suspended. Contact support if you believe this is an error.',
            'reinstated' => 'Your account access has been restored. Welcome back.',
            default => 'Your account status has been updated.',
        };
    }

    private function suspendedUntilBody(): string
    {
        $until = $this->suspendedUntil ? " until {$this->suspendedUntil}" : '';
        $reasonPart = $this->reason ? " Reason: {$this->reason}" : '';

        return "Your account has been temporarily suspended{$until}.{$reasonPart} Contact support if you believe this is an error.";
    }

    public function meta(): array
    {
        return ['action' => $this->action, 'reason' => $this->reason];
    }
}
