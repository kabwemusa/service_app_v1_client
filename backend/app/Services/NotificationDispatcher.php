<?php

namespace App\Services;

use App\Events\NotifiableEvent;
use App\Jobs\SendPushNotificationJob;
use App\Jobs\SmsFallbackJob;
use App\Models\Notification;
use App\Models\NotificationSetting;
use Illuminate\Support\Facades\Log;

/**
 * Central notification dispatcher. Every NotifiableEvent flows through here.
 *
 * Responsibilities:
 *  1. Persist the notification record (with event_time for second-accurate display).
 *  2. Broadcast to the user's private WebSocket channel (foreground delivery).
 *  3. Dispatch high-priority FCM/APNs push job (background delivery).
 *  4. For time-critical types: schedule SMS fallback if push is not acked within window.
 *  5. Record dispatch_time for latency observability.
 *  6. Respect channel + quiet-hour preferences (except critical/safety).
 *
 * End-to-end delivery latency is bounded by FCM/APNs/network/OS and cannot be
 * guaranteed to an exact second. Timers are exact via event_time.
 */
class NotificationDispatcher
{
    private const SMS_FALLBACK_DELAY_SECONDS = 45;

    public function dispatch(NotifiableEvent $event): Notification
    {
        $settings = NotificationSetting::forUser($event->recipientId());
        $category = $event->settingsCategory();
        $prefs    = $settings->categories[$category] ?? ['push' => true, 'sms' => true, 'in_app' => true];
        $isCritical = $event->isTimeCritical() || $category === 'safety';

        $inAppEnabled = $isCritical || ($prefs['in_app'] ?? true);
        $pushEnabled  = $isCritical || ($prefs['push'] ?? true);
        $smsEnabled   = $isCritical || ($prefs['sms'] ?? false);

        // Quiet hours: suppress non-critical notifications during quiet period
        if (!$isCritical && $this->isQuietHour($settings)) {
            $pushEnabled = false;
            $smsEnabled  = false;
            // in_app still persists — user sees it when they open the app
        }

        // 1. Persist notification record
        $notification = Notification::create([
            'user_id'       => $event->recipientId(),
            'type'          => $event->notificationType(),
            'title'         => $event->title(),
            'body'          => $event->body(),
            'entity_type'   => $event->entityType(),
            'entity_id'     => $event->entityId(),
            'payment_mode'  => $event->paymentMode(),
            'meta'          => array_merge($event->meta(), ['event_time' => $event->eventTime]),
            'event_time'    => $event->eventTime,
            'dispatch_time' => now()->toIso8601String(),
            'priority'      => $event->isTimeCritical() ? 'high' : 'normal',
        ]);

        // 2. Broadcast to private WebSocket channel (foreground — instant)
        if ($inAppEnabled) {
            $this->broadcastToChannel($notification);
        }

        // 3. FCM/APNs push (background — near-instant)
        if ($pushEnabled) {
            SendPushNotificationJob::dispatch($notification)
                ->onQueue($event->isTimeCritical() ? 'push-high' : 'push');
        }

        // 4. SMS fallback for time-critical types
        if ($smsEnabled && $event->isTimeCritical()) {
            SmsFallbackJob::dispatch($notification->id)
                ->delay(now()->addSeconds(self::SMS_FALLBACK_DELAY_SECONDS))
                ->onQueue('sms');
        }

        // 4b. WhatsApp leg — the platform's primary channel. Verification
        // decisions and payout releases must reach providers who never open
        // the app. Session message inside the 24 h window, pre-approved
        // template outside it. Best-effort: failures never block the rest.
        $this->sendWhatsAppLeg($notification);

        // 5. Observability
        Log::info('NotificationDispatcher: dispatched', [
            'notification_id' => $notification->id,
            'type'            => $notification->type,
            'recipient'       => $notification->user_id,
            'priority'        => $notification->priority,
            'push'            => $pushEnabled,
            'sms_scheduled'   => $smsEnabled && $event->isTimeCritical(),
            'event_time'      => $event->eventTime,
            'dispatch_time'   => $notification->dispatch_time,
        ]);

        return $notification;
    }

    /**
     * Types that also go out on WhatsApp, mapped to their pre-approved
     * template (used outside the 24 h session window). Inside the window the
     * plain title+body is sent as a session message.
     */
    private const WHATSAPP_TYPES = [
        'VERIFICATION_UPDATE' => null, // template resolved from outcome below
        'PAYOUT_RELEASED'     => 'payout_released',
    ];

    private function sendWhatsAppLeg(Notification $notification): void
    {
        if (! array_key_exists($notification->type, self::WHATSAPP_TYPES)) {
            return;
        }

        try {
            $user = \App\Models\User::find($notification->user_id);
            if (! $user?->phone) {
                return;
            }

            $wa    = ltrim($user->phone, '+');
            $convo = \App\Models\ConversationState::where('whatsapp_id', $wa)->first();
            $meta  = $notification->meta ?? [];

            [$templateKey, $variables] = match ($notification->type) {
                'VERIFICATION_UPDATE' => ($meta['outcome'] ?? '') === 'approved'
                    ? ['verification_approved', ['tier' => (string) ($meta['tier'] ?? 1)]]
                    : ['verification_update',   ['reason' => $notification->body]],
                'PAYOUT_RELEASED' => ['payout_released', [
                    'amount'        => number_format((float) ($meta['amount'] ?? 0), 2),
                    'service_title' => $meta['service_title'] ?? 'your booking',
                ]],
            };

            app(\App\Services\WhatsApp\TemplateManager::class)->sendProactiveOrTemplate(
                $wa,
                $templateKey,
                $variables,
                "*{$notification->title}*\n{$notification->body}",
                $convo,
            );
        } catch (\Throwable $e) {
            Log::warning('NotificationDispatcher: WhatsApp leg failed', [
                'notification_id' => $notification->id,
                'error'           => $e->getMessage(),
            ]);
        }
    }

    private function broadcastToChannel(Notification $notification): void
    {
        try {
            $channel = "private-user.{$notification->user_id}";
            $payload = [
                'id'           => $notification->id,
                'type'         => $notification->type,
                'title'        => $notification->title,
                'body'         => $notification->body,
                'entity_type'  => $notification->entity_type,
                'entity_id'    => $notification->entity_id,
                'payment_mode' => $notification->payment_mode,
                'meta'         => $notification->meta,
                'event_time'   => $notification->meta['event_time'] ?? $notification->created_at->toIso8601String(),
                'created_at'   => $notification->created_at->toIso8601String(),
            ];

            broadcast(new \App\Events\NotificationBroadcast($channel, $payload))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('NotificationDispatcher: broadcast failed', [
                'notification_id' => $notification->id,
                'error'           => $e->getMessage(),
            ]);
        }
    }

    private function isQuietHour(NotificationSetting $settings): bool
    {
        $qh = $settings->quiet_hours;
        if (!($qh['enabled'] ?? false)) return false;

        $now   = now()->format('H:i');
        $start = $qh['start'] ?? '22:00';
        $end   = $qh['end']   ?? '07:00';

        if ($start <= $end) {
            return $now >= $start && $now < $end;
        }
        // Wraps midnight (e.g. 22:00 → 07:00)
        return $now >= $start || $now < $end;
    }
}
