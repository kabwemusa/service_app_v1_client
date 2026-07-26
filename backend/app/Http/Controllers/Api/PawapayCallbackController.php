<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\ConversationState;
use App\Models\PawapayEvent;
use App\Services\WhatsApp\ConversationEngine;
use App\Services\WhatsApp\MessageBuilder;
use App\Services\WhatsApp\TemplateManager;
use App\Support\MnoResolver;
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
     *
     * SECURITY: this endpoint is public (pawaPay is the caller), so its input is
     * untrusted. Two independent defences:
     *   1. An optional shared-secret token (PAWAPAY_CALLBACK_TOKEN) on the URL —
     *      when configured it must match, blocking anonymous probes outright.
     *   2. The status a callback claims is NEVER used to move money. Before acting
     *      on any event we re-fetch the authoritative status from pawaPay's read
     *      API (PaymentStatusVerifier); the posted status is used only for logging
     *      and non-authoritative context (e.g. the failure reason to show a user).
     * A forged callback therefore cannot fake a payment outcome.
     */
    public function handle(Request $request): JsonResponse
    {
        if (! $this->tokenOk($request)) {
            Log::warning('PawaPay callback: rejected — bad or missing callback token', [
                'ip' => $request->ip(),
            ]);
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $payload = $request->all();

        Log::info('PawaPay callback received', $payload);

        if (isset($payload['depositId'])) {
            // Replace the (untrusted) posted status with the authoritative one.
            $payload['status'] = $this->authoritativeStatus('deposit', $payload['depositId'], $payload['status'] ?? 'UNKNOWN');
            $this->logEvent($payload, 'depositId', 'collection');
            $this->handleDepositCallback($payload);
        } elseif (isset($payload['payoutId'])) {
            $payload['status'] = $this->authoritativeStatus('payout', $payload['payoutId'], $payload['status'] ?? 'UNKNOWN');
            $this->logEvent($payload, 'payoutId', 'payout');
            $this->handlePayoutCallback($payload);
        } elseif (isset($payload['refundId'])) {
            $payload['status'] = $this->authoritativeStatus('refund', $payload['refundId'], $payload['status'] ?? 'UNKNOWN');
            $this->logEvent($payload, 'refundId', 'refund');
            $this->handleRefundCallback($payload);
        } else {
            Log::warning('PawaPay callback: unrecognized payload', $payload);
        }

        return response()->json(['received' => true]);
    }

    /**
     * Constant-time comparison of an optional shared secret. When
     * PAWAPAY_CALLBACK_TOKEN is unset the check is skipped (sandbox/local
     * convenience) — but we warn in production so a misconfiguration is loud.
     */
    private function tokenOk(Request $request): bool
    {
        $expected = (string) config('pawapay.callback_token', '');

        if ($expected === '') {
            if (app()->isProduction()) {
                Log::warning('PawaPay callback: PAWAPAY_CALLBACK_TOKEN is not set in production — relying on status re-fetch only.');
            }
            return true;
        }

        $provided = (string) ($request->query('token') ?? $request->header('X-Callback-Token', ''));

        return $provided !== '' && hash_equals($expected, $provided);
    }

    /**
     * Re-fetch the true status from pawaPay when the bound gateway supports it
     * (the real, money-moving gateway does). Falls back to the posted status only
     * for stub/test gateways, which are bound solely when no real funds move.
     */
    private function authoritativeStatus(string $kind, string $ref, string $postedStatus): string
    {
        $gateway = app(\App\Contracts\PaymentGateway::class);

        if (! $gateway instanceof \App\Contracts\PaymentStatusVerifier) {
            return $postedStatus;
        }

        $verified = $gateway->verifyStatus($kind, (string) $ref);

        if ($verified !== $postedStatus) {
            Log::info('PawaPay callback: status re-fetched', [
                'kind' => $kind, 'ref' => $ref, 'posted' => $postedStatus, 'verified' => $verified,
            ]);
        }

        return $verified;
    }

    /**
     * Passive observability only — never throws, never affects reconciliation
     * logic. Backs the admin Finance module's Escrow tab.
     */
    private function logEvent(array $payload, string $refKey, string $type): void
    {
        try {
            $booking = $this->resolveBookingForEvent($payload, $type);

            $phone = $payload['payer']['accountDetails']['phoneNumber']
                ?? $payload['recipient']['accountDetails']['phoneNumber']
                ?? ($type === 'collection' ? $booking?->buyer?->phone : $booking?->provider?->providerProfile?->momo_number);

            // CON-4: a redelivered callback carries the same (external_ref, status).
            // firstOrCreate on that pair de-dupes WITHOUT throwing a unique
            // violation — important because a thrown violation would poison a
            // surrounding DB transaction (e.g. under test) even when caught.
            PawapayEvent::firstOrCreate(
                [
                    'external_ref'   => $payload[$refKey],
                    'pawapay_status' => $payload['status'] ?? 'UNKNOWN',
                ],
                [
                    'booking_id' => $booking?->id,
                    'type'       => $type,
                    'mno'        => MnoResolver::forPhone($phone),
                    'amount'     => isset($payload['amount']) ? (float) $payload['amount'] : null,
                    'created_at' => now(),
                ],
            );
        } catch (\Throwable $e) {
            Log::warning('PawapayEvent: failed to persist', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Resolve the booking an event belongs to using the most reliable
     * identifier available for that event type — never metadata alone.
     * pawaPay's sandbox echoes metadata back inconsistently (observed: a
     * single submitted field comes back as a bare {"value": "..."} object
     * with the field name dropped), so prefer the gateway references we
     * already persist ourselves (escrow_hold_ref / payout_ref), which are
     * exactly what handleDepositCallback/handlePayoutCallback use to drive
     * the booking lifecycle — metadata is only a last-resort fallback.
     */
    private function resolveBookingForEvent(array $payload, string $type): ?Booking
    {
        // Deposits and refunds both carry the original depositId at the top
        // level (refunds reference the deposit they're reversing).
        $depositRef = match ($type) {
            'collection', 'refund' => $payload['depositId'] ?? null,
            default                => null,
        };

        if ($depositRef) {
            $booking = Booking::with(['buyer', 'provider.providerProfile'])
                ->where('escrow_hold_ref', $depositRef)
                ->orWhere('balance_hold_ref', $depositRef)
                ->first();
            if ($booking) {
                return $booking;
            }
        }

        if ($type === 'payout' && isset($payload['payoutId'])) {
            $booking = Booking::with(['buyer', 'provider.providerProfile'])
                ->where('payout_ref', $payload['payoutId'])->first();
            if ($booking) {
                return $booking;
            }
        }

        $bookingId = $this->metadataValue($payload, 'bookingId');
        return $bookingId ? Booking::with(['buyer', 'provider.providerProfile'])->find($bookingId) : null;
    }

    private function handleDepositCallback(array $payload): void
    {
        $depositId = $payload['depositId'];
        $status    = $payload['status'] ?? 'UNKNOWN';

        Log::info('PawaPay deposit callback', [
            'depositId' => $depositId,
            'status'    => $status,
        ]);

        // QUOTE_DEPOSIT phase 2: the balance collection is its own deposit,
        // reconciled via balance_hold_ref — it gates the payout, not the status.
        $balanceBooking = Booking::where('balance_hold_ref', $depositId)->first();
        if ($balanceBooking) {
            $this->onBalanceDeposit($balanceBooking, $status, $payload);
            return;
        }

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

    /**
     * QUOTE_DEPOSIT balance collection resolved. COMPLETED → escrow_phase FULL
     * (both collections custodied) and the payout can proceed; FAILED → back to
     * DEPOSIT so BookingService::collectBalance can be retried.
     */
    private function onBalanceDeposit(Booking $booking, string $status, array $payload): void
    {
        if ($status === 'COMPLETED') {
            if ($booking->escrow_phase === 'FULL') {
                return; // idempotent redelivery
            }

            $booking->update(['escrow_phase' => 'FULL']);
            Log::info('PawaPay: balance collection completed — escrow now FULL', [
                'bookingId' => $booking->id,
                'balanceRef' => $booking->balance_hold_ref,
            ]);

            // Release immediately if the payout hold has already lapsed.
            if ($booking->status === 'COMPLETED'
                && $booking->payout_eligible_at !== null
                && $booking->payout_eligible_at->isPast()) {
                try {
                    app(\App\Services\BookingService::class)->disbursePayout(
                        $booking->fresh()->load('service', 'provider.providerProfile'),
                    );
                } catch (\Throwable $e) {
                    Log::error('PawaPay: post-balance payout failed — due-payout batch will retry', [
                        'bookingId' => $booking->id, 'error' => $e->getMessage(),
                    ]);
                }
            }
            return;
        }

        if (\in_array($status, ['FAILED', 'REJECTED'], true)) {
            $booking->update(['escrow_phase' => 'DEPOSIT', 'balance_hold_ref' => null]);
            Log::error('PawaPay: balance collection failed — retry via collectBalance', [
                'bookingId' => $booking->id,
                'reason'    => $payload['failureReason'] ?? null,
            ]);
        }
    }

    private function onDepositCompleted(Booking $booking, array $payload): void
    {
        // Race: the customer approved the MoMo prompt AFTER the funding window
        // expired (booking already CANCELLED/EXPIRED). Never keep their money —
        // reverse the deposit immediately and tell them.
        if (\in_array($booking->status, ['CANCELLED', 'EXPIRED'], true)) {
            $this->refundLateDeposit($booking);
            return;
        }

        // Funds are now custodied by the licensed gateway. QUOTE_DEPOSIT bookings
        // (escrow_phase DEPOSIT) advance to DEPOSIT_HELD — only the deposit is
        // held, the balance is collected at completion. Everything else FUNDS_HELD.
        $heldState = $booking->escrow_phase === 'DEPOSIT' ? 'DEPOSIT_HELD' : 'FUNDS_HELD';

        // Idempotency + concurrency (TXN-5): PawaPay may re-deliver this callback,
        // and two redeliveries can race. A single conditional UPDATE advances the
        // booking exactly once — only a still-PENDING_PAYMENT row is moved. A
        // redelivery (or any later state) claims 0 rows and is a safe no-op. This
        // is atomic without holding a row lock across the WhatsApp send below.
        $advanced = \Illuminate\Support\Facades\DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', 'PENDING_PAYMENT')
            ->update(['status' => $heldState, 'updated_at' => now()]);

        if ($advanced === 0) {
            Log::info('PawaPay: deposit COMPLETED but booking not PENDING_PAYMENT, skipping (idempotent)', [
                'bookingId' => $booking->id,
                'status'    => $booking->status,
            ]);
            return;
        }

        $booking->status = $heldState; // reflect the committed state for downstream

        // Growth & Promotions: the discount was decided and stamped on the
        // booking at initiation (the customer was already charged the reduced
        // amount). Now that funds have settled, record the campaign spend.
        try {
            app(\App\Services\Growth\CampaignDiscountService::class)->recordReserved($booking);
        } catch (\Throwable $e) {
            Log::warning('PawaPay: campaign spend record failed (non-fatal)', [
                'bookingId' => $booking->id, 'error' => $e->getMessage(),
            ]);
        }

        Log::info("PawaPay: booking advanced to {$heldState}", [
            'bookingId'             => $booking->id,
            'depositId'             => $booking->escrow_hold_ref,
            'providerTransactionId' => $payload['providerTransactionId'] ?? null,
        ]);

        // Funds now custodied → generate the Booking Agreement (both parties get
        // the same document). Best-effort; never blocks the callback.
        try {
            app(\App\Services\BookingService::class)->issueAgreement(
                $booking->fresh()->load(['service.category', 'service.inclusions', 'buyer', 'provider.providerProfile']),
                \App\Services\BookingAgreementService::REASON_CONFIRMATION,
            );
        } catch (\Throwable $e) {
            Log::warning('PawaPay: agreement generation failed', [
                'bookingId' => $booking->id, 'error' => $e->getMessage(),
            ]);
        }

        $customerConvo = ConversationState::where('booking_id', $booking->id)
            ->where('state', 'FUNDING')
            ->first();

        if ($customerConvo) {
            app(ConversationEngine::class)->onFundsHeldFromCallback($customerConvo);
        }
    }

    /**
     * Deposit approved after the booking was already cancelled/expired —
     * reverse it and tell the customer. Never keep money for a dead booking.
     */
    private function refundLateDeposit(Booking $booking): void
    {
        Log::warning('PawaPay: deposit completed for a closed booking — refunding', [
            'bookingId' => $booking->id,
            'status'    => $booking->status,
        ]);

        // Idempotent refund claim (TXN-3): only one caller may refund. If the
        // booking was already refunded (at cancel time, or by a redelivered late
        // callback) this claims 0 rows and we return without a second refund.
        $claimed = \Illuminate\Support\Facades\DB::table('bookings')
            ->where('id', $booking->id)
            ->whereNull('refunded_at')
            ->update(['refunded_at' => now()]);

        if ($claimed === 0) {
            Log::info('PawaPay: late deposit for an already-refunded booking, skipping', [
                'bookingId' => $booking->id,
            ]);
            return;
        }

        $held   = $booking->escrow_phase === 'DEPOSIT'
            ? (float) $booking->deposit_amount
            : (float) ($booking->agreed_amount ?? $booking->amount);
        $amount = $held + (float) $booking->buyer_protection_fee;

        try {
            $ok = app(\App\Contracts\PaymentGateway::class)->refund(
                $booking->escrow_hold_ref,
                $booking->buyer?->phone ?? '',
                $amount,
            );
            if (! $ok) {
                throw new \RuntimeException('Gateway refund returned failure.');
            }
        } catch (\Throwable $e) {
            Log::error('PawaPay: late-deposit refund failed — queued for reconciliation', [
                'bookingId' => $booking->id, 'error' => $e->getMessage(),
            ]);
            app(\App\Services\PaymentReconciliationService::class)->record(
                $booking, \App\Models\PaymentReconciliation::KIND_REFUND,
                $amount, $booking->escrow_hold_ref, $booking->buyer?->phone, $e->getMessage(),
            );
            return;
        }

        $customerConvo = ConversationState::where('booking_id', $booking->id)->first();
        if ($customerConvo) {
            $this->templates->sendMessage(
                $customerConvo->whatsapp_id,
                "Your payment arrived after the booking had already expired, so we've refunded the full amount to your Mobile Money. You can start a new booking anytime.",
                $customerConvo,
            );
        }
    }

    private function onDepositFailed(Booking $booking, array $payload): void
    {
        $reason = $payload['failureReason']['failureMessage']
            ?? $payload['failureReason']['failureCode']
            ?? 'Payment was not completed';

        // Atomic (TXN-5): only a still-PENDING_PAYMENT booking is marked failed;
        // a redelivery claims 0 rows and is a no-op.
        $failed = \Illuminate\Support\Facades\DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', 'PENDING_PAYMENT')
            ->update(['status' => 'PAYMENT_FAILED', 'updated_at' => now()]);

        if ($failed === 0) {
            return;
        }

        $booking->status = 'PAYMENT_FAILED'; // reflect for downstream

        Log::info('PawaPay: booking marked PAYMENT_FAILED', [
            'bookingId' => $booking->id,
            'reason'    => $reason,
        ]);

        $customerConvo = ConversationState::where('booking_id', $booking->id)
            ->where('state', 'FUNDING')
            ->first();

        if ($customerConvo) {
            $customerConvo->state = 'PAYMENT_FAILED';
            $customerConvo->timeout_at = null;
            $customerConvo->save();

            $this->templates->sendInteractive(
                $customerConvo->whatsapp_id,
                MessageBuilder::replyButtons(
                    "Payment failed: {$reason}\n\nWould you like to try again? If your network is having issues, you can pay from a different Mobile Money number.",
                    [
                        ['id' => 'retry_payment',    'title' => 'Retry Payment'],
                        ['id' => 'use_other_number', 'title' => 'Use another number'],
                        ['id' => 'cancel_booking',   'title' => 'Cancel'],
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
        $booking = Booking::where('payout_ref', $payoutId)->first();
        if (! $booking) {
            $bookingId = $this->metadataValue($payload, 'bookingId');
            $booking   = $bookingId ? Booking::find($bookingId) : null;
        }

        if (\in_array($status, ['FAILED', 'REJECTED'], true)) {
            Log::error('PawaPay: payout failed — will be retried by the due-payout batch', [
                'payoutId'  => $payoutId,
                'bookingId' => $booking?->id,
                'reason'    => $payload['failureReason'] ?? null,
            ]);

            // Revert to COMPLETED and RELEASE the payout claim (TXN-1) so the
            // due-payout batch can re-attempt. Atomic + idempotent.
            if ($booking) {
                \Illuminate\Support\Facades\DB::table('bookings')
                    ->where('id', $booking->id)
                    ->where('status', 'DISBURSED')
                    ->update(['status' => 'COMPLETED', 'disbursed_at' => null, 'payout_claimed_at' => null, 'updated_at' => now()]);
            }
            return;
        }

        if ($status === 'COMPLETED' && $booking) {
            // Idempotent confirm (e.g. a slow async payout that wasn't optimistically
            // marked). Only a not-yet-DISBURSED row is advanced; a redelivery no-ops.
            $confirmed = \Illuminate\Support\Facades\DB::table('bookings')
                ->where('id', $booking->id)
                ->where('status', '!=', 'DISBURSED')
                ->update(['status' => 'DISBURSED', 'disbursed_at' => now(), 'updated_at' => now()]);

            if ($confirmed === 0) {
                return;
            }
            $booking->status = 'DISBURSED';

            try {
                app(\App\Services\NotificationDispatcher::class)->dispatch(
                    new \App\Events\PayoutReleased($booking->load('service')),
                );
            } catch (\Throwable $e) {
                Log::warning('PawaPay: payout notification failed', [
                    'bookingId' => $booking->id, 'error' => $e->getMessage(),
                ]);
            }
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
     * Best-effort extraction of a metadata field from a PawaPay callback —
     * a last-resort fallback only (see resolveBookingForEvent). Tolerates
     * the {key,value} list shape we send, pawaPay's flat {fieldName: value}
     * echo, AND the shape actually observed in the sandbox: a single
     * submitted metadata field comes back as a bare {"value": "..."} object
     * with the field name dropped entirely (not wrapped in a list).
     */
    private function metadataValue(array $payload, string $field): ?string
    {
        $metadata = $payload['metadata'] ?? [];

        if (is_array($metadata) && isset($metadata['value']) && ! isset($metadata['key']) && ! isset($metadata[0])) {
            return (string) $metadata['value'];
        }

        foreach ($metadata as $entry) {
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
