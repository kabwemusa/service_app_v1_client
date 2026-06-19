<?php

namespace App\Jobs;

use App\Models\DeviceToken;
use App\Models\Notification;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Sends an OS-level push notification via the Expo Push API.
 *
 * Expo Push acts as a unified gateway: we send Expo push tokens, and Expo
 * routes to FCM (Android) / APNs (iOS) under the hood. The notification
 * appears on the lock screen, notification shade, with sound + vibration —
 * exactly like WhatsApp.
 *
 * Time-critical types use high priority so they bypass Doze/batching.
 */
class SendPushNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [5, 30, 120];

    private const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

    public function __construct(
        public readonly Notification $notification,
    ) {}

    public function handle(): void
    {
        $notification = $this->notification->fresh();
        if (!$notification) return;

        $tokens = DeviceToken::where('user_id', $notification->user_id)
            ->pluck('token')
            ->filter(fn ($t) => str_starts_with($t, 'ExponentPushToken[') || str_starts_with($t, 'ExpoPushToken['))
            ->values()
            ->all();

        if (empty($tokens)) {
            Log::info('SendPushNotificationJob: no device tokens', [
                'notification_id' => $notification->id,
                'user_id'         => $notification->user_id,
            ]);
            $notification->update(['push_status' => 'no_token']);
            return;
        }

        $isHighPriority = $notification->priority === 'high';

        $messages = array_map(fn (string $token) => [
            'to'               => $token,
            'title'            => $notification->title,
            'body'             => $notification->body,
            'sound'            => 'default',
            'priority'         => $isHighPriority ? 'high' : 'default',
            'channelId'        => $this->channelId($notification->type),
            '_displayInForeground' => true,
            'data'             => [
                'notification_id' => $notification->id,
                'type'            => $notification->type,
                'entity_type'     => $notification->entity_type,
                'entity_id'       => $notification->entity_id,
                'event_time'      => $notification->meta['event_time'] ?? null,
            ],
        ], $tokens);

        try {
            $response = Http::timeout(10)
                ->withHeaders([
                    'Accept'       => 'application/json',
                    'Content-Type' => 'application/json',
                ])
                ->post(self::EXPO_PUSH_URL, $messages);

            $body = $response->json();

            // Check for ticket errors (invalid tokens etc.)
            $this->handleTickets($body['data'] ?? [], $tokens);

            $notification->update(['push_status' => 'sent']);

            Log::info('SendPushNotificationJob: sent', [
                'notification_id' => $notification->id,
                'token_count'     => count($tokens),
                'status'          => $response->status(),
            ]);
        } catch (\Throwable $e) {
            Log::error('SendPushNotificationJob: failed', [
                'notification_id' => $notification->id,
                'error'           => $e->getMessage(),
            ]);

            $notification->update(['push_status' => 'failed']);

            throw $e;
        }
    }

    private function channelId(string $type): string
    {
        $urgentTypes = [
            'NEW_BOOKING_REQUEST', 'REQUEST_EXPIRING', 'CUSTOMER_MARKED_PAID',
            'PAY_REMINDER', 'SAFETY_NOTICE',
        ];

        return in_array($type, $urgentTypes, true) ? 'urgent' : 'default';
    }

    /**
     * Process Expo push ticket responses. Remove tokens that are no longer
     * valid (DeviceNotRegistered) so we don't keep sending to dead tokens.
     */
    private function handleTickets(array $tickets, array $tokens): void
    {
        foreach ($tickets as $i => $ticket) {
            if (($ticket['status'] ?? '') === 'error') {
                $detail = $ticket['details']['error'] ?? '';

                if ($detail === 'DeviceNotRegistered' && isset($tokens[$i])) {
                    DeviceToken::where('token', $tokens[$i])->delete();
                    Log::info('SendPushNotificationJob: removed stale token', [
                        'token' => substr($tokens[$i], 0, 30) . '…',
                    ]);
                }
            }
        }
    }
}
