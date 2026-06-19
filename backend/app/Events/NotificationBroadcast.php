<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts a notification to the user's private WebSocket channel.
 *
 * Uses ShouldBroadcastNow (synchronous broadcast) so the event reaches
 * the client within the same request cycle as the domain action — target
 * is sub-second delivery for foregrounded clients.
 *
 * Channel: private-user.{userId}
 * Event name: notification.received
 */
class NotificationBroadcast implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        private readonly string $channel,
        public readonly array   $payload,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel(str_replace('private-', '', $this->channel))];
    }

    public function broadcastAs(): string
    {
        return 'notification.received';
    }

    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
