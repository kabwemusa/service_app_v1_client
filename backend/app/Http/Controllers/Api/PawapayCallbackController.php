<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\ConversationState;
use App\Services\WhatsApp\ConversationEngine;
use App\Services\WhatsApp\MessageBuilder;
use App\Services\WhatsApp\TemplateManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class PawapayCallbackController extends Controller
{
    public function __construct(
        private readonly TemplateManager $templates,
    ) {}

    /**
     * POST /api/pawapay/callback
     *
     * PawaPay sends callbacks for deposits, payouts, and refunds.
     * Deposit callbacks drive the booking lifecycle forward.
     */
    public function handle(Request $request): JsonResponse
    {
        $payload = $request->all();

        Log::info('PawaPay callback received', $payload);

        if (isset($payload['depositId'])) {
            $this->handleDepositCallback($payload);
        } elseif (isset($payload['payoutId'])) {
            $this->handlePayoutCallback($payload);
        } elseif (isset($payload['refundId'])) {
            $this->handleRefundCallback($payload);
        } else {
            Log::warning('PawaPay callback: unrecognized payload', $payload);
        }

        return response()->json(['received' => true]);
    }

    private function handleDepositCallback(array $payload): void
    {
        $depositId = $payload['depositId'];
        $status    = $payload['status'] ?? 'UNKNOWN';

        Log::info('PawaPay deposit callback', [
            'depositId' => $depositId,
            'status'    => $status,
        ]);

        $booking = Booking::where('escrow_hold_ref', $depositId)->first();

        if (! $booking) {
            Log::warning('PawaPay deposit callback: no booking found', ['depositId' => $depositId]);
            return;
        }

        if ($status === 'COMPLETED') {
            $this->onDepositCompleted($booking, $payload);
        } elseif (in_array($status, ['FAILED', 'REJECTED'])) {
            $this->onDepositFailed($booking, $payload);
        }
    }

    private function onDepositCompleted(Booking $booking, array $payload): void
    {
        // Idempotency: PawaPay may re-deliver this callback. We only advance from
        // PENDING_PAYMENT; any later state (FUNDS_HELD, IN_PROGRESS, …) is a no-op.
        if ($booking->status !== 'PENDING_PAYMENT') {
            Log::info('PawaPay: deposit COMPLETED but booking not PENDING_PAYMENT, skipping (idempotent)', [
                'bookingId' => $booking->id,
                'status'    => $booking->status,
            ]);
            return;
        }

        // Funds are now custodied by the licensed gateway — advance to FUNDS_HELD.
        // (No paid_at/payment_ref columns exist on bookings; the gateway depositId
        //  is already persisted as escrow_hold_ref for reconciliation.)
        $booking->update(['status' => 'FUNDS_HELD']);

        Log::info('PawaPay: booking advanced to FUNDS_HELD', [
            'bookingId'             => $booking->id,
            'depositId'             => $booking->escrow_hold_ref,
            'providerTransactionId' => $payload['providerTransactionId'] ?? null,
        ]);

        $customerConvo = ConversationState::where('booking_id', $booking->id)
            ->where('state', 'FUNDING')
            ->first();

        if ($customerConvo) {
            app(ConversationEngine::class)->onFundsHeldFromCallback($customerConvo);
        }
    }

    private function onDepositFailed(Booking $booking, array $payload): void
    {
        if ($booking->status !== 'PENDING_PAYMENT') {
            return;
        }

        $reason = $payload['failureReason']['failureMessage']
            ?? $payload['failureReason']['failureCode']
            ?? 'Payment was not completed';

        $booking->update(['status' => 'PAYMENT_FAILED']);

        Log::info('PawaPay: booking marked PAYMENT_FAILED', [
            'bookingId' => $booking->id,
            'reason'    => $reason,
        ]);

        $customerConvo = ConversationState::where('booking_id', $booking->id)
            ->where('state', 'FUNDING')
            ->first();

        if ($customerConvo) {
            $customerConvo->state = 'PAYMENT_FAILED';
            $customerConvo->save();

            $this->templates->sendInteractive(
                $customerConvo->whatsapp_id,
                MessageBuilder::replyButtons(
                    "Payment failed: {$reason}\n\nWould you like to try again?",
                    [
                        ['id' => 'retry_payment', 'title' => 'Retry Payment'],
                        ['id' => 'cancel_booking', 'title' => 'Cancel'],
                    ],
                ),
                $customerConvo,
            );
        }
    }

    private function handlePayoutCallback(array $payload): void
    {
        $payoutId = $payload['payoutId'];
        $status   = $payload['status'] ?? 'UNKNOWN';

        Log::info('PawaPay payout callback', [
            'payoutId' => $payoutId,
            'status'   => $status,
        ]);

        // The disbursement is initiated optimistically (BookingService::disbursePayout
        // sets DISBURSED on payout ACCEPTED). The callback is the authoritative
        // reconciliation: confirm on COMPLETED, and on failure revert so the
        // due-payout batch re-attempts (MNO outage tolerance).
        $bookingId = $this->metadataValue($payload, 'bookingId');
        $booking   = $bookingId ? Booking::find($bookingId) : null;

        if (\in_array($status, ['FAILED', 'REJECTED'], true)) {
            Log::error('PawaPay: payout failed — will be retried by the due-payout batch', [
                'payoutId'  => $payoutId,
                'bookingId' => $bookingId,
                'reason'    => $payload['failureReason'] ?? null,
            ]);

            if ($booking && $booking->status === 'DISBURSED') {
                $booking->update(['status' => 'COMPLETED', 'disbursed_at' => null]);
            }
            return;
        }

        if ($status === 'COMPLETED' && $booking && $booking->status !== 'DISBURSED') {
            // Idempotent confirm (e.g. a slow async payout that wasn't optimistically marked).
            $booking->update(['status' => 'DISBURSED', 'disbursed_at' => now()]);
        }
    }

    private function handleRefundCallback(array $payload): void
    {
        $refundId = $payload['refundId'];
        $status   = $payload['status'] ?? 'UNKNOWN';

        Log::info('PawaPay refund callback', [
            'refundId'  => $refundId,
            'status'    => $status,
            'bookingId' => $this->metadataValue($payload, 'bookingId'),
        ]);
        // The booking is already moved to CANCELLED synchronously when the refund is
        // initiated (BookingService::cancel); this callback is observability only.
    }

    /**
     * Best-effort extraction of a metadata field from a PawaPay callback,
     * tolerating both the {key,value} shape we send and pawaPay's flat
     * {fieldName: value} echo.
     */
    private function metadataValue(array $payload, string $field): ?string
    {
        foreach ($payload['metadata'] ?? [] as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            if (($entry['key'] ?? null) === $field && isset($entry['value'])) {
                return (string) $entry['value'];
            }
            if (isset($entry[$field])) {
                return (string) $entry[$field];
            }
        }
        return null;
    }
}
