<?php

namespace App\Events;

/**
 * Notifies the REPORTER only, once their report/emergency has been reviewed.
 * Deliberately generic: outcome, internal notes and the reported party's
 * identity are never included — those stay internal to the admin audit log.
 */
class SafetyReportResolved extends NotifiableEvent
{
    public function __construct(
        public readonly string $reporterId,
        public readonly string $kind, // 'report' | 'emergency'
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'SAFETY_REPORT_RESOLVED'; }
    public function recipientId(): string { return $this->reporterId; }
    public function entityType(): ?string { return $this->kind === 'emergency' ? 'emergency_event' : 'safety_report'; }
    public function entityId(): ?string { return null; }
    public function settingsCategory(): string { return 'safety'; }

    public function title(): string { return 'Your report has been reviewed'; }

    public function body(): string
    {
        return 'Thank you for letting us know. Our team has reviewed your report and taken appropriate action.';
    }
}
