<?php

namespace App\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Base class for every event that produces a user-facing notification.
 *
 * event_time is the authoritative server timestamp (UTC) of the domain action.
 * The client derives ALL displayed times and countdowns from this value against
 * a synced clock — never from push-arrival time. This makes timers second-accurate
 * regardless of delivery jitter.
 */
abstract class NotifiableEvent
{
    use Dispatchable, SerializesModels;

    public readonly string $eventTime;

    public function __construct()
    {
        $this->eventTime = now()->toIso8601String();
    }

    abstract public function notificationType(): string;

    abstract public function recipientId(): string;

    abstract public function title(): string;

    abstract public function body(): string;

    abstract public function entityType(): ?string;

    abstract public function entityId(): ?string;

    public function paymentMode(): ?string { return null; }

    public function meta(): array { return []; }

    /** Is this a time-critical type requiring high-priority push + SMS fallback? */
    public function isTimeCritical(): bool { return false; }

    /** Category key for matching notification settings. */
    abstract public function settingsCategory(): string;
}
