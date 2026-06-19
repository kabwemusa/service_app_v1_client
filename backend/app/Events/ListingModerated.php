<?php

namespace App\Events;

use App\Models\Service;

class ListingModerated extends NotifiableEvent
{
    public function __construct(
        public readonly Service $service,
        public readonly string  $action, // 'hidden' | 'requires_changes' | 'restored'
        public readonly ?string $reason,
    ) {
        parent::__construct();
    }

    public function notificationType(): string { return 'LISTING_MODERATION'; }
    public function recipientId(): string { return $this->service->provider_id; }
    public function entityType(): ?string { return 'service'; }
    public function entityId(): ?string { return $this->service->id; }
    public function settingsCategory(): string { return 'moderation'; }

    public function title(): string
    {
        return match ($this->action) {
            'hidden'           => 'Listing hidden',
            'requires_changes' => 'Listing needs changes',
            'restored'         => 'Listing restored',
            default            => 'Listing update',
        };
    }

    public function body(): string
    {
        $t = $this->service->title ?? 'Your listing';
        return match ($this->action) {
            'hidden'           => "\"{$t}\" has been hidden by a moderator." . ($this->reason ? " Reason: {$this->reason}" : ''),
            'requires_changes' => "\"{$t}\" needs changes before it can be shown." . ($this->reason ? " Reason: {$this->reason}" : ''),
            'restored'         => "\"{$t}\" is now visible again.",
            default            => "\"{$t}\" was updated by a moderator.",
        };
    }

    public function meta(): array
    {
        return ['action' => $this->action, 'reason' => $this->reason];
    }
}
