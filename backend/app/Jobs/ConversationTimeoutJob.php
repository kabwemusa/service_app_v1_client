<?php

namespace App\Jobs;

use App\Models\ConversationState;
use App\Services\WhatsApp\TemplateManager;
use App\Services\WhatsApp\MessageBuilder;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ConversationTimeoutJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(TemplateManager $templates): void
    {
        $expired = ConversationState::whereNotNull('timeout_at')
            ->where('timeout_at', '<=', now())
            ->whereNotIn('state', ['MENU', 'COMPLETED', 'EXPIRED', 'CANCELLED'])
            ->get();

        foreach ($expired as $convo) {
            Log::info('ConversationTimeoutJob: expiring', [
                'wa'    => $convo->whatsapp_id,
                'state' => $convo->state,
            ]);

            $previousState = $convo->state;

            match ($previousState) {
                'COLLECTING' => $this->expireCollecting($convo, $templates),
                'DISPATCHING' => $this->expireDispatching($convo, $templates),
                'FUNDING' => $this->expireFunding($convo, $templates),
                default => $this->expireGeneric($convo, $templates),
            };
        }
    }

    private function expireCollecting(ConversationState $convo, TemplateManager $templates): void
    {
        $templates->sendInteractive(
            $convo->whatsapp_id,
            MessageBuilder::replyButtons(
                "Your booking session has timed out. Would you like to start over?",
                [
                    ['id' => 'menu_book_now', 'title' => 'Start Over'],
                    ['id' => 'back_menu',     'title' => 'Main Menu'],
                ],
            ),
            $convo,
        );

        $convo->update([
            'state'      => 'EXPIRED',
            'sub_state'  => null,
            'timeout_at' => null,
        ]);
    }

    private function expireDispatching(ConversationState $convo, TemplateManager $templates): void
    {
        $role = $convo->getContextValue('role');

        if ($role === 'provider') {
            $bookingId = $convo->booking_id ?? $convo->getContextValue('offer_booking_id');

            $templates->sendMessage(
                $convo->whatsapp_id,
                "The job offer has expired because you didn't respond in time. It will be offered to another provider.",
                $convo,
            );
            // booking_id must be cleared BEFORE cascading — the cascade looks up
            // the customer conversation by booking_id and must not find this one.
            $convo->update(['state' => 'MENU', 'sub_state' => null, 'timeout_at' => null, 'context' => [], 'booking_id' => null]);

            // An ignored offer must cascade exactly like a decline — otherwise
            // the customer (who may already have paid) is silently stranded.
            if ($bookingId) {
                try {
                    app(\App\Services\WhatsApp\ConversationEngine::class)->cascadeToNextProvider($bookingId);
                } catch (\Throwable $e) {
                    Log::error('ConversationTimeoutJob: cascade after offer timeout failed', [
                        'booking_id' => $bookingId, 'error' => $e->getMessage(),
                    ]);
                }
            }
            return;
        }

        $templates->sendMessage(
            $convo->whatsapp_id,
            "Sorry, no provider accepted your request in time. Would you like to try again?",
            $convo,
        );
        $convo->update(['state' => 'NO_PROVIDERS', 'sub_state' => null, 'timeout_at' => null]);
    }

    private function expireFunding(ConversationState $convo, TemplateManager $templates): void
    {
        // Cancel the unpaid booking too — the copy below promises it.
        if ($convo->booking_id) {
            $booking = \App\Models\Booking::find($convo->booking_id);
            if ($booking && \in_array($booking->status, ['REQUESTED', 'QUOTED', 'PENDING_PAYMENT', 'PAYMENT_FAILED'], true)) {
                $booking->update(['status' => 'CANCELLED']);
            }
        }

        $templates->sendMessage(
            $convo->whatsapp_id,
            "Your payment window has expired and the booking was cancelled — no money was taken. You can start a new booking anytime.",
            $convo,
        );
        $convo->update(['state' => 'EXPIRED', 'sub_state' => null, 'timeout_at' => null]);
    }

    private function expireGeneric(ConversationState $convo, TemplateManager $templates): void
    {
        $convo->update(['state' => 'MENU', 'sub_state' => null, 'timeout_at' => null, 'context' => []]);
    }
}
