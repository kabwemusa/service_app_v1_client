<?php

namespace App\Services\Payments;

use App\Models\Booking;
use App\Models\ConversationState;
use App\Models\PaymentEvent;
use App\Services\BookingAgreementService;
use App\Services\BookingService;
use App\Services\Growth\CampaignDiscountService;
use App\Services\NotificationDispatcher;
use App\Services\PaymentReconciliationService;
use App\Services\WhatsApp\ConversationEngine;
use App\Services\WhatsApp\MessageBuilder;
use App\Services\WhatsApp\TemplateManager;
use App\Support\MnoResolver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Drives the booking lifecycle from a settled (or failed) payment event.
 *
 * PROCESSOR-AGNOSTIC BY DESIGN. Webhook controllers own transport concerns —
 * signature verification, payload shape, event naming — and hand this class only
 * three things: our own reference, an already-VERIFIED canonical status
 * (COMPLETED | FAILED | PENDING | UNKNOWN), and context for logging. Swapping the
 * gateway again should touch a controller and an adapter, never this file.
 *
 * Every entry point is idempotent: a webhook is redelivered until acknowledged,
 * and two redeliveries can race, so each state advance is a single conditional
 * UPDATE that claims the transition exactly once.
 */
class PaymentEventProcessor
{
    public function __construct(
        private readonly TemplateManager $templates,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Entry points
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * A customer collection resolved. Advances the booking to FUNDS_HELD /
     * DEPOSIT_HELD, or marks it PAYMENT_FAILED.
     */
    public function collection(string $reference, string $status, array $context = []): void
    {
        Log::info('Payments: collection event', ['reference' => $reference, 'status' => $status] + $context);

        // QUOTE_DEPOSIT phase 2: the balance collection is its own charge,
        // reconciled via balance_hold_ref — it gates the payout, not the status.
        $balanceBooking = Booking::where('balance_hold_ref', $reference)->first();
        if ($balanceBooking) {
            $this->onBalanceCollection($balanceBooking, $status, $context);
            return;
        }

        $booking = Booking::where('escrow_hold_ref', $reference)->first();

        if (! $booking) {
            Log::warning('Payments: collection event for an unknown reference', ['reference' => $reference]);
            return;
        }

        if ($status === 'COMPLETED') {
            $this->onCollectionCompleted($booking, $context);
        } elseif ($status === 'FAILED') {
            $this->onCollectionFailed($booking, $context);
        }
    }

    /**
     * A provider payout resolved. The disbursement is initiated optimistically
     * (BookingService::disbursePayout sets DISBURSED on acceptance); this is the
     * authoritative reconciliation — confirm on success, and on failure release
     * the claim so the due-payout batch re-attempts (MNO outage tolerance).
     */
    public function payout(string $reference, string $status, array $context = []): void
    {
        Log::info('Payments: payout event', ['reference' => $reference, 'status' => $status] + $context);

        $booking = Booking::where('payout_ref', $reference)->first();

        if ($status === 'FAILED') {
            Log::error('Payments: payout failed — will be retried by the due-payout batch', [
                'reference' => $reference,
                'bookingId' => $booking?->id,
                'reason'    => $context['reason'] ?? null,
            ]);

            if ($booking) {
                DB::table('bookings')
                    ->where('id', $booking->id)
                    ->where('status', 'DISBURSED')
                    ->update([
                        'status'            => 'COMPLETED',
                        'disbursed_at'      => null,
                        'payout_claimed_at' => null,
                        'updated_at'        => now(),
                    ]);
            }
            return;
        }

        if ($status !== 'COMPLETED' || ! $booking) {
            return;
        }

        // Idempotent confirm (e.g. a slow async payout that wasn't optimistically
        // marked). Only a not-yet-DISBURSED row advances; a redelivery no-ops.
        $confirmed = DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', '!=', 'DISBURSED')
            ->update(['status' => 'DISBURSED', 'disbursed_at' => now(), 'updated_at' => now()]);

        if ($confirmed === 0) {
            return;
        }
        $booking->status = 'DISBURSED';

        try {
            app(NotificationDispatcher::class)->dispatch(
                new \App\Events\PayoutReleased($booking->load('service')),
            );
        } catch (\Throwable $e) {
            Log::warning('Payments: payout notification failed', [
                'bookingId' => $booking->id, 'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * A refund resolved. The booking is already CANCELLED synchronously when the
     * refund is initiated (BookingService::cancel), so a success here is pure
     * observability. A FAILURE is not: the customer's money never left our float,
     * so it goes onto the reconciliation queue to be re-attempted.
     */
    public function refund(string $reference, string $status, array $context = []): void
    {
        Log::info('Payments: refund event', ['reference' => $reference, 'status' => $status] + $context);

        if ($status !== 'FAILED') {
            return;
        }

        $booking = Booking::with('buyer')->where('refund_ref', $reference)->first();

        if (! $booking) {
            Log::error('Payments: refund FAILED for an unknown reference — manual finance review', [
                'reference' => $reference, 'reason' => $context['reason'] ?? null,
            ]);
            return;
        }

        Log::error('Payments: refund failed — queued for reconciliation', [
            'bookingId' => $booking->id, 'reference' => $reference, 'reason' => $context['reason'] ?? null,
        ]);

        app(PaymentReconciliationService::class)->record(
            $booking,
            \App\Models\PaymentReconciliation::KIND_REFUND,
            (float) ($context['amount'] ?? 0),
            $booking->escrow_hold_ref,
            $booking->buyer?->phone,
            'Refund transfer failed at the gateway: ' . ($context['reason'] ?? 'unknown'),
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Observability
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Append-only event log backing the admin Finance module's Escrow tab. Purely
     * passive: it never throws and never affects reconciliation logic.
     *
     * A redelivered webhook carries the same (reference, status) pair, so
     * firstOrCreate on that pair de-dupes WITHOUT a unique violation — important,
     * because a thrown violation would poison a surrounding DB transaction even
     * when caught.
     */
    public function record(string $reference, string $type, string $status, array $context = []): void
    {
        try {
            $booking = $this->resolveBooking($reference, $type);

            $phone = $context['phone']
                ?? ($type === 'collection'
                    ? $booking?->buyer?->phone
                    : $booking?->provider?->providerProfile?->momo_number);

            PaymentEvent::firstOrCreate(
                [
                    'external_ref'    => $reference,
                    'provider_status' => $status,
                ],
                [
                    'booking_id' => $booking?->id,
                    'provider'   => $context['provider'] ?? 'lipila',
                    'type'       => $type,
                    'mno'        => MnoResolver::forPhone($phone),
                    'amount'     => isset($context['amount']) ? (float) $context['amount'] : null,
                    'created_at' => now(),
                ],
            );
        } catch (\Throwable $e) {
            Log::warning('PaymentEvent: failed to persist', ['error' => $e->getMessage()]);
        }
    }

    /**
     * The booking an event belongs to, resolved from the reference WE generated
     * and persisted — never from gateway-echoed metadata. Every reference is
     * written to exactly one column before the request that mints it returns.
     */
    private function resolveBooking(string $reference, string $type): ?Booking
    {
        $query = Booking::with(['buyer', 'provider.providerProfile']);

        return match ($type) {
            'collection' => (clone $query)->where('escrow_hold_ref', $reference)
                ->orWhere('balance_hold_ref', $reference)->first(),
            'payout' => $query->where('payout_ref', $reference)->first(),
            'refund' => $query->where('refund_ref', $reference)->first(),
            default  => null,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Collection outcomes
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * QUOTE_DEPOSIT balance collection resolved. COMPLETED → escrow_phase FULL
     * (both collections custodied) and the payout can proceed; FAILED → back to
     * DEPOSIT so BookingService::collectBalance can be retried.
     */
    private function onBalanceCollection(Booking $booking, string $status, array $context): void
    {
        if ($status === 'COMPLETED') {
            if ($booking->escrow_phase === 'FULL') {
                return; // idempotent redelivery
            }

            $booking->update(['escrow_phase' => 'FULL']);
            Log::info('Payments: balance collection completed — escrow now FULL', [
                'bookingId'  => $booking->id,
                'balanceRef' => $booking->balance_hold_ref,
            ]);

            // Release immediately if the payout hold has already lapsed.
            if ($booking->status === 'COMPLETED'
                && $booking->payout_eligible_at !== null
                && $booking->payout_eligible_at->isPast()) {
                try {
                    app(BookingService::class)->disbursePayout(
                        $booking->fresh()->load('service', 'provider.providerProfile'),
                    );
                } catch (\Throwable $e) {
                    Log::error('Payments: post-balance payout failed — due-payout batch will retry', [
                        'bookingId' => $booking->id, 'error' => $e->getMessage(),
                    ]);
                }
            }
            return;
        }

        if ($status === 'FAILED') {
            $booking->update(['escrow_phase' => 'DEPOSIT', 'balance_hold_ref' => null]);
            Log::error('Payments: balance collection failed — retry via collectBalance', [
                'bookingId' => $booking->id,
                'reason'    => $context['reason'] ?? null,
            ]);
        }
    }

    private function onCollectionCompleted(Booking $booking, array $context): void
    {
        // Race: the customer approved the MoMo prompt AFTER the funding window
        // expired (booking already CANCELLED/EXPIRED). Never keep their money —
        // reverse the collection immediately and tell them.
        if (\in_array($booking->status, ['CANCELLED', 'EXPIRED'], true)) {
            $this->refundLateCollection($booking);
            return;
        }

        // Funds are now custodied by the licensed gateway. QUOTE_DEPOSIT bookings
        // (escrow_phase DEPOSIT) advance to DEPOSIT_HELD — only the deposit is
        // held, the balance is collected at completion. Everything else FUNDS_HELD.
        $heldState = $booking->escrow_phase === 'DEPOSIT' ? 'DEPOSIT_HELD' : 'FUNDS_HELD';

        // Idempotency + concurrency: a single conditional UPDATE advances the
        // booking exactly once — only a still-PENDING_PAYMENT row is moved. A
        // redelivery (or any later state) claims 0 rows and is a safe no-op. This
        // is atomic without holding a row lock across the WhatsApp send below.
        $advanced = DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', 'PENDING_PAYMENT')
            ->update(['status' => $heldState, 'updated_at' => now()]);

        if ($advanced === 0) {
            Log::info('Payments: collection COMPLETED but booking not PENDING_PAYMENT, skipping (idempotent)', [
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
            app(CampaignDiscountService::class)->recordReserved($booking);
        } catch (\Throwable $e) {
            Log::warning('Payments: campaign spend record failed (non-fatal)', [
                'bookingId' => $booking->id, 'error' => $e->getMessage(),
            ]);
        }

        Log::info("Payments: booking advanced to {$heldState}", [
            'bookingId' => $booking->id,
            'reference' => $booking->escrow_hold_ref,
        ] + $context);

        // Funds now custodied → generate the Booking Agreement (both parties get
        // the same document). Best-effort; never blocks the webhook.
        try {
            app(BookingService::class)->issueAgreement(
                $booking->fresh()->load(['service.category', 'service.inclusions', 'buyer', 'provider.providerProfile']),
                BookingAgreementService::REASON_CONFIRMATION,
            );
        } catch (\Throwable $e) {
            Log::warning('Payments: agreement generation failed', [
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
     * Collection approved after the booking was already cancelled/expired —
     * reverse it and tell the customer. Never keep money for a dead booking.
     */
    private function refundLateCollection(Booking $booking): void
    {
        Log::warning('Payments: collection completed for a closed booking — refunding', [
            'bookingId' => $booking->id,
            'status'    => $booking->status,
        ]);

        // Idempotent refund claim: only one caller may refund. If the booking was
        // already refunded (at cancel time, or by a redelivered late webhook) this
        // claims 0 rows and we return without a second refund.
        $claimed = DB::table('bookings')
            ->where('id', $booking->id)
            ->whereNull('refunded_at')
            ->update(['refunded_at' => now()]);

        if ($claimed === 0) {
            Log::info('Payments: late collection for an already-refunded booking, skipping', [
                'bookingId' => $booking->id,
            ]);
            return;
        }

        $held = $booking->escrow_phase === 'DEPOSIT'
            ? (float) $booking->deposit_amount
            : (float) ($booking->agreed_amount ?? $booking->amount);
        $amount = $held + (float) $booking->buyer_protection_fee;

        try {
            $refundRef = app(\App\Contracts\PaymentGateway::class)->refund(
                $booking->escrow_hold_ref,
                $booking->buyer?->phone ?? '',
                $amount,
            );
            if (! $refundRef) {
                throw new \RuntimeException('Gateway refund returned failure.');
            }
            $booking->update(['refund_ref' => $refundRef]);
        } catch (\Throwable $e) {
            Log::error('Payments: late-collection refund failed — queued for reconciliation', [
                'bookingId' => $booking->id, 'error' => $e->getMessage(),
            ]);
            app(PaymentReconciliationService::class)->record(
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

    private function onCollectionFailed(Booking $booking, array $context): void
    {
        $reason = $context['reason'] ?? null ?: 'Payment was not completed';

        // Atomic: only a still-PENDING_PAYMENT booking is marked failed; a
        // redelivery claims 0 rows and is a no-op.
        $failed = DB::table('bookings')
            ->where('id', $booking->id)
            ->where('status', 'PENDING_PAYMENT')
            ->update(['status' => 'PAYMENT_FAILED', 'updated_at' => now()]);

        if ($failed === 0) {
            return;
        }

        $booking->status = 'PAYMENT_FAILED'; // reflect for downstream

        Log::info('Payments: booking marked PAYMENT_FAILED', [
            'bookingId' => $booking->id,
            'reason'    => $reason,
        ]);

        $customerConvo = ConversationState::where('booking_id', $booking->id)
            ->where('state', 'FUNDING')
            ->first();

        if ($customerConvo) {
            $customerConvo->state      = 'PAYMENT_FAILED';
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
}
