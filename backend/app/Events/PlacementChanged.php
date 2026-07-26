<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Public real-time signal that a campaign's placement footprint changed —
 * launched, paused, ended, or hit its budget cap. Every app client listens on
 * the public `placements` channel and refetches its slots, so a campaign appears
 * or disappears without a rebuild or reload.
 *
 * No per-user fan-out and no PII: the payload only says "something changed";
 * clients re-evaluate their own eligibility against the server.
 */
class PlacementChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public readonly string $at;

    public function __construct(
        public readonly string $campaignId,
        public readonly string $reason,
    ) {
        $this->at = now()->toIso8601String();
    }

    /** Fire-and-forget: a broadcast failure must never break a campaign mutation. */
    public static function fire(string $campaignId, string $reason): void
    {
        try {
            static::dispatch($campaignId, $reason);
        } catch (\Throwable $e) {
            Log::warning('PlacementChanged: broadcast failed (non-fatal)', [
                'campaign_id' => $campaignId, 'reason' => $reason, 'error' => $e->getMessage(),
            ]);
        }
    }

    public function broadcastOn(): array
    {
        return [new Channel('placements')];
    }

    public function broadcastAs(): string
    {
        return 'campaign.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'campaign_id' => $this->campaignId,
            'reason'      => $this->reason,
            'at'          => $this->at,
        ];
    }
}
