<?php

namespace App\Console\Commands;

use App\Contracts\PaymentGateway;
use App\Contracts\PaymentStatusVerifier;
use App\Models\Booking;
use App\Services\Payments\PaymentEventProcessor;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Safety net for callbacks that never arrive.
 *
 * The booking lifecycle advances on Lipila's callback, which is a single point
 * of failure: an unreachable URL, an expired tunnel, a deploy during the retry
 * window, or Lipila exhausting its retries all leave a booking stranded at
 * PENDING_PAYMENT while the money has actually moved. `PaymentExpiryWorker` then
 * cancels it on the TTL, and the customer's funds sit with the processor.
 *
 * So we poll. This command asks the gateway for the authoritative status of
 * every reference still awaiting an outcome and feeds it into the SAME
 * PaymentEventProcessor entry points the webhook uses — identical code path,
 * identical idempotency, just a different transport. A booking that already
 * advanced via callback claims 0 rows here and is a no-op.
 *
 * It is also what makes local UI testing work at all: on a laptop there is no
 * publicly reachable callback URL, so without this nothing ever leaves
 * PENDING_PAYMENT.
 *
 * Read-only against our own DB except through the processor, and safe to run as
 * often as the rate limit allows.
 */
class LipilaPollPending extends Command
{
    protected $signature = 'lipila:poll
        {--booking= : Poll only this booking id}
        {--limit=200 : Maximum references to check in one pass}
        {--dry-run : Report what would change without touching anything}';

    protected $description = 'Reconcile bookings whose Lipila callback never arrived by polling transaction status.';

    public function __construct(
        private readonly PaymentEventProcessor $processor,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $gateway = app(PaymentGateway::class);

        // Stub/test gateways have no authoritative status to fetch — under them
        // the lifecycle is synchronous and nothing is ever left pending.
        if (! $gateway instanceof PaymentStatusVerifier) {
            $this->line('Bound gateway cannot verify status (' . get_class($gateway) . ') — nothing to poll.');
            return self::SUCCESS;
        }

        $dryRun = (bool) $this->option('dry-run');
        $limit  = max(1, (int) $this->option('limit'));

        $pending = $this->awaitingOutcome($limit);

        if ($pending === []) {
            $this->line('Nothing awaiting an outcome.');
            return self::SUCCESS;
        }

        $this->line('Checking ' . count($pending) . ' reference(s)' . ($dryRun ? ' (dry run)' : '') . '…');

        $resolved = 0;

        foreach ($pending as $item) {
            ['booking' => $booking, 'kind' => $kind, 'ref' => $ref, 'entry' => $entry] = $item;

            $status = $gateway->verifyStatus($kind, $ref);

            // PENDING is the normal case — the customer simply has not answered
            // the prompt yet. UNKNOWN means we could not read it (404 or a
            // transport failure); either way we make no state change, exactly as
            // the webhook handler would.
            if (! in_array($status, ['COMPLETED', 'FAILED'], true)) {
                $this->line(sprintf('  %-12s %s  %s', $status, substr($ref, 0, 28), 'booking ' . $booking->id));
                continue;
            }

            $this->line(sprintf('  <info>%-12s</info> %s  %s → applying %s',
                $status, substr($ref, 0, 28), 'booking ' . $booking->id, $entry));

            if ($dryRun) {
                $resolved++;
                continue;
            }

            $context = [
                'provider' => 'lipila',
                'source'   => 'poll',
                'amount'   => $this->amountFor($booking, $entry),
                'phone'    => $entry === 'collection'
                    ? $booking->buyer?->phone
                    : $booking->provider?->providerProfile?->momo_number,
            ];

            try {
                $this->processor->record($ref, $entry, $status, $context);

                match ($entry) {
                    'collection' => $this->processor->collection($ref, $status, $context),
                    'payout'     => $this->processor->payout($ref, $status, $context),
                    'refund'     => $this->processor->refund($ref, $status, $context),
                };

                $resolved++;
            } catch (\Throwable $e) {
                Log::error('lipila:poll — failed to apply a resolved status', [
                    'bookingId' => $booking->id,
                    'ref'       => $ref,
                    'entry'     => $entry,
                    'status'    => $status,
                    'error'     => $e->getMessage(),
                ]);
                $this->error('    ' . $e->getMessage());
            }
        }

        $this->info("Resolved {$resolved} of " . count($pending) . '.');

        if ($resolved > 0) {
            Log::info('lipila:poll: reconciled callbacks that never arrived', [
                'checked'  => count($pending),
                'resolved' => $resolved,
            ]);
        }

        return self::SUCCESS;
    }

    /**
     * Every reference still waiting on a terminal outcome, as
     * {booking, kind, ref, entry} rows.
     *
     * `kind` is what the gateway reads (collections vs disbursements endpoint);
     * `entry` is which processor entry point owns the outcome. They differ for
     * refunds, which are disbursements at Lipila but refunds to the lifecycle.
     *
     * @return list<array{booking: Booking, kind: string, ref: string, entry: string}>
     */
    private function awaitingOutcome(int $limit): array
    {
        $with = ['buyer', 'provider.providerProfile'];

        if ($bookingId = $this->option('booking')) {
            $bookings = Booking::with($with)->whereKey($bookingId)->get();

            return $bookings->flatMap(fn (Booking $b) => $this->referencesFor($b, force: true))->all();
        }

        $rows = [];

        // 1. The initial collection. This is the one that strands a booking.
        $collections = Booking::with($with)
            ->where('status', 'PENDING_PAYMENT')
            ->whereNotNull('escrow_hold_ref')
            ->orderBy('updated_at')
            ->limit($limit)
            ->get();

        foreach ($collections as $booking) {
            $rows[] = ['booking' => $booking, 'kind' => 'deposit', 'ref' => $booking->escrow_hold_ref, 'entry' => 'collection'];
        }

        // 2. QUOTE_DEPOSIT phase two — the balance collection gates the payout.
        $balances = Booking::with($with)
            ->where('escrow_phase', 'BALANCE')
            ->whereNotNull('balance_hold_ref')
            ->orderBy('updated_at')
            ->limit($limit)
            ->get();

        foreach ($balances as $booking) {
            $rows[] = ['booking' => $booking, 'kind' => 'deposit', 'ref' => $booking->balance_hold_ref, 'entry' => 'collection'];
        }

        // 3. Payouts are marked DISBURSED optimistically on acceptance; a missed
        //    failure callback would leave a booking claiming money it never sent.
        $payouts = Booking::with($with)
            ->where('status', 'DISBURSED')
            ->whereNotNull('payout_ref')
            ->orderBy('updated_at')
            ->limit($limit)
            ->get();

        foreach ($payouts as $booking) {
            $rows[] = ['booking' => $booking, 'kind' => 'payout', 'ref' => $booking->payout_ref, 'entry' => 'payout'];
        }

        // 4. Refunds. Only a FAILURE acts (it queues reconciliation), but that is
        //    precisely the outcome we must not miss — the customer is owed money.
        $refunds = Booking::with($with)
            ->whereNotNull('refund_ref')
            ->whereNotNull('refunded_at')
            ->orderBy('updated_at')
            ->limit($limit)
            ->get();

        foreach ($refunds as $booking) {
            $rows[] = ['booking' => $booking, 'kind' => 'refund', 'ref' => $booking->refund_ref, 'entry' => 'refund'];
        }

        return array_slice($rows, 0, $limit);
    }

    /**
     * Every reference on one booking, regardless of state — used by --booking so
     * a single booking can be inspected without matching the sweep's filters.
     *
     * @return list<array{booking: Booking, kind: string, ref: string, entry: string}>
     */
    private function referencesFor(Booking $booking, bool $force = false): array
    {
        $candidates = [
            ['deposit', $booking->escrow_hold_ref,   'collection'],
            ['deposit', $booking->balance_hold_ref,  'collection'],
            ['payout',  $booking->payout_ref,        'payout'],
            ['refund',  $booking->refund_ref,        'refund'],
        ];

        $rows = [];
        foreach ($candidates as [$kind, $ref, $entry]) {
            if ($ref) {
                $rows[] = ['booking' => $booking, 'kind' => $kind, 'ref' => $ref, 'entry' => $entry];
            }
        }

        return $rows;
    }

    /** Best-effort amount for the observability row; never drives logic. */
    private function amountFor(Booking $booking, string $entry): ?float
    {
        return match ($entry) {
            'collection' => (float) ($booking->agreed_amount ?? $booking->amount),
            'payout'     => (float) ($booking->provider_split ?? 0) ?: null,
            default      => null,
        };
    }
}
