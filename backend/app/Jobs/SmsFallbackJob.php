<?php

namespace App\Jobs;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * SMS fallback for time-critical notifications.
 *
 * Dispatched with a delay (default 45s) after the push is sent. On execution,
 * checks whether the push was acked (via WebSocket or FCM delivery receipt).
 * If NOT acked, sends an SMS to the user's phone number.
 *
 * This matters in the Zambian context where push delivery is unreliable due to
 * network conditions, older devices, and battery optimization. SMS is the
 * highest-reach channel.
 *
 * Integration point: replace the stub in `sendSms()` with Africa's Talking
 * SDK or equivalent SMS gateway.
 */
class SmsFallbackJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public array $backoff = [10, 60];

    public function __construct(
        public readonly string $notificationId,
    ) {}

    public function handle(): void
    {
        $notification = Notification::find($this->notificationId);
        if (!$notification) return;

        // Already acked via push/WebSocket — no SMS needed
        if ($notification->ack_time !== null) {
            Log::info('SmsFallbackJob: push already acked, skipping SMS', [
                'notification_id' => $notification->id,
            ]);
            return;
        }

        // Already sent SMS for this notification
        if ($notification->sms_sent_at !== null) return;

        $user = User::find($notification->user_id);
        if (!$user || !$user->phone) {
            Log::info('SmsFallbackJob: no phone number, cannot SMS', [
                'notification_id' => $notification->id,
                'user_id'         => $notification->user_id,
            ]);
            return;
        }

        $this->sendSms($user->phone, $notification->title, $notification->body);

        $notification->update(['sms_sent_at' => now()]);

        Log::info('SmsFallbackJob: SMS sent', [
            'notification_id' => $notification->id,
            'user_id'         => $notification->user_id,
            'phone'           => substr($user->phone, 0, 6) . '****',
        ]);
    }

    /**
     * SMS gateway integration stub.
     *
     * Replace with Africa's Talking (recommended for Zambia), Twilio, or
     * equivalent. The message should be concise — SMS has a 160-char limit
     * per segment.
     */
    private function sendSms(string $phone, string $title, string $body): void
    {
        $message = "{$title}: " . mb_substr($body, 0, 130);

        // TODO: integrate Africa's Talking SMS client
        // $at = new AfricasTalking(config('services.africastalking.username'), config('services.africastalking.api_key'));
        // $sms = $at->sms();
        // $sms->send(['to' => $phone, 'message' => $message, 'from' => config('services.africastalking.sender_id')]);

        Log::info('SmsFallbackJob: SMS stub', [
            'phone'   => substr($phone, 0, 6) . '****',
            'message' => $message,
        ]);
    }
}
