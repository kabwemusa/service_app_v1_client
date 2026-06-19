<?php

namespace App\Events;

use App\Models\SafetyReport;

/**
 * TIME-CRITICAL: safety report filed against a user.
 * Cannot be suppressed by quiet hours or channel preferences.
 */
class SafetyAlert extends NotifiableEvent
{
    public function __construct(
        public readonly SafetyReport $report,
        public readonly string       $recipientUserId,
        public readonly string       $messageBody,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'SAFETY_NOTICE'; }
    public function recipientId(): string { return $this->recipientUserId; }
    public function entityType(): ?string { return 'safety_report'; }
    public function entityId(): ?string { return $this->report->id; }
    public function settingsCategory(): string { return 'safety'; }
    public function isTimeCritical(): bool { return true; }

    public function title(): string { return 'Safety alert'; }
    public function body(): string { return $this->messageBody; }
}
