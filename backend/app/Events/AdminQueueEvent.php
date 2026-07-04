<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Generic real-time signal to an admin module queue (verification, finance,
 * safety, reviews, services). Fired by model observers (see
 * AppServiceProvider::boot()) whenever a row enters one of those queues,
 * regardless of which code path created it.
 *
 * Channel: private-admin.{module}
 * Event name: matches $type, e.g. "verification.submitted"
 */
class AdminQueueEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public readonly string $id;
    public readonly string $createdAt;

    public function __construct(
        public readonly string $module,
        public readonly string $type,
        public readonly string $entityId,
        public readonly array  $payload = [],
    ) {
        $this->id        = (string) Str::uuid();
        $this->createdAt = now()->toIso8601String();
    }

    /**
     * Fire the event, swallowing broadcast failures.
     *
     * ShouldBroadcastNow pushes to the WebSocket server (Reverb) synchronously,
     * inline in the caller's request — if Reverb is down/unreachable, that
     * throws and would otherwise crash whatever triggered it. Several call
     * sites are on paths that must never fail because of this (payment
     * webhooks, safety/emergency reports), so this is the one place that
     * absorbs the failure — mirrors NotificationDispatcher::broadcastToChannel.
     * The admin queue simply misses a live update; it still shows up on
     * next poll/reload.
     */
    public static function fire(string $module, string $type, string $entityId, array $payload = []): void
    {
        try {
            static::dispatch($module, $type, $entityId, $payload);
        } catch (\Throwable $e) {
            Log::warning('AdminQueueEvent: broadcast failed (non-fatal)', [
                'module' => $module, 'type' => $type, 'entity_id' => $entityId,
                'error'  => $e->getMessage(),
            ]);
        }
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel("admin.{$this->module}")];
    }

    public function broadcastAs(): string
    {
        return $this->type;
    }

    public function broadcastWith(): array
    {
        return [
            'id'         => $this->id,
            'type'       => $this->type,
            'module'     => $this->module,
            'entity_id'  => $this->entityId,
            'payload'    => $this->payload,
            'created_at' => $this->createdAt,
        ];
    }
}
