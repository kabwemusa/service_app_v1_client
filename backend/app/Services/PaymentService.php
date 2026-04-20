<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\Booking;
use App\Models\Transaction;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PaymentService
{
    private float $feePct;
    private array $retryDelays;
    private int   $maxRetries;

    public function __construct()
    {
        $this->feePct      = (float) config("payment.platform_fee_pct", 0.05);
        $this->retryDelays = config("payment.retry_delays", [1 => 5, 2 => 30, 3 => 120]);
        $this->maxRetries  = (int) config("payment.max_retries", 3);
    }

    public function initiatePayIn(Booking $booking): Transaction
    {
        $this->assertStatus($booking, "PENDING_PAYMENT");
        $booking->load("buyer", "service");

        $gross = (float) $booking->service->base_price;
        $fee   = round($gross * $this->feePct, 2);
        $net   = round($gross - $fee, 2);
        $ref   = "PAY-" . strtoupper(Str::random(12));

        return DB::transaction(function () use ($booking, $gross, $fee, $net, $ref) {
            $tx = Transaction::create([
                "booking_id"     => $booking->id,
                "momo_reference" => $ref,
                "amount_gross"   => $gross,
                "platform_fee"   => $fee,
                "amount_net"     => $net,
                "type"           => "PAY_IN",
                "status"         => "PENDING",
            ]);

            $success = $this->callMomoApi("pay_in", ["amount" => $gross, "reference" => $ref, "payer" => $booking->buyer->email]);

            if (! $success) {
                $tx->update(["status" => "FAILED"]);
                throw new ApiException(ErrorCode::PAYMENT_FAILED, "Mobile Money payment failed. Please try again.");
            }

            $tx->update(["status" => "SUCCESS"]);
            $booking->update(["status" => "FUNDS_HELD"]);
            Log::info("PaymentService: PAY_IN success", ["booking_id" => $booking->id]);
            return $tx->fresh();
        });
    }

    public function initiatePayout(Booking $booking, bool $instantPayout = false): Transaction
    {
        $payIn = Transaction::where("booking_id", $booking->id)->where("type", "PAY_IN")->where("status", "SUCCESS")->first();
        if (! $payIn) {
            throw new ApiException(ErrorCode::SERVER_ERROR, "Cannot process payout: no successful PAY_IN found.");
        }

        // Instant payout deducts 1% fee from net (§8.6)
        $netAmount = $payIn->amount_net;
        if ($instantPayout) {
            $netAmount = round($netAmount * (1 - (float) env('INSTANT_PAYOUT_FEE', 0.01)), 2);
        }

        $ref = "OUT-" . strtoupper(Str::random(12));

        return DB::transaction(function () use ($booking, $payIn, $netAmount, $ref) {
            $tx = Transaction::create([
                "booking_id"     => $booking->id,
                "momo_reference" => $ref,
                "amount_gross"   => $payIn->amount_gross,
                "platform_fee"   => $payIn->platform_fee,
                "amount_net"     => $netAmount,
                "type"           => "PAY_OUT",
                "status"         => "PENDING",
            ]);
            $this->attemptPayout($tx, $booking);
            return $tx->fresh();
        });
    }

    public function attemptPayout(Transaction $tx, ?Booking $booking = null): void
    {
        $booking ??= $tx->booking()->with("provider")->first();

        $success = $this->callMomoApi("pay_out", [
            "amount"    => $tx->amount_net,
            "reference" => $tx->momo_reference,
            "payee"     => $booking?->provider?->email,
        ]);

        if ($success) {
            $tx->update(["status" => "SUCCESS", "next_retry_at" => null]);
            Log::info("PaymentService: PAY_OUT success", ["tx_id" => $tx->id]);
            return;
        }

        $attempts = $tx->retry_count + 1;

        if ($attempts > $this->maxRetries) {
            $tx->update(["status" => "FAILED", "retry_count" => $attempts, "next_retry_at" => null]);
            Log::error("PaymentService: PAY_OUT permanently failed", ["tx_id" => $tx->id]);
            return;
        }

        $delayMins = $this->retryDelays[$attempts] ?? 120;
        $tx->update(["status" => "FAILED", "retry_count" => $attempts, "next_retry_at" => Carbon::now()->addMinutes($delayMins)]);
        Log::warning("PaymentService: PAY_OUT failed, retry scheduled", ["tx_id" => $tx->id, "attempt" => $attempts, "delay_mins" => $delayMins]);
    }

    public function initiateRefund(Booking $booking): Transaction
    {
        $booking->load("buyer");
        $payIn = Transaction::where("booking_id", $booking->id)->where("type", "PAY_IN")->where("status", "SUCCESS")->first();
        if (! $payIn) {
            throw new ApiException(ErrorCode::SERVER_ERROR, "Cannot process refund: no successful PAY_IN found.");
        }

        $ref = "REF-" . strtoupper(Str::random(12));

        return DB::transaction(function () use ($booking, $payIn, $ref) {
            $tx = Transaction::create([
                "booking_id"     => $booking->id,
                "momo_reference" => $ref,
                "amount_gross"   => $payIn->amount_gross,
                "platform_fee"   => 0.00,
                "amount_net"     => $payIn->amount_gross,
                "type"           => "REFUND",
                "status"         => "PENDING",
            ]);

            $success = $this->callMomoApi("refund", ["amount" => $payIn->amount_gross, "reference" => $ref, "payee" => $booking->buyer->email]);
            $tx->update(["status" => $success ? "SUCCESS" : "FAILED"]);
            Log::info("PaymentService: REFUND " . ($success ? "success" : "failed"), ["tx_id" => $tx->id]);
            return $tx->fresh();
        });
    }

    /**
     * Partial refund — returns only $refundAmount to the buyer (§12.3).
     */
    public function initiatePartialRefund(Booking $booking, float $refundAmount): Transaction
    {
        $booking->load("buyer");
        $payIn = Transaction::where("booking_id", $booking->id)->where("type", "PAY_IN")->where("status", "SUCCESS")->first();
        if (! $payIn) {
            throw new ApiException(ErrorCode::SERVER_ERROR, "Cannot process refund: no successful PAY_IN found.");
        }

        $ref = "REF-" . strtoupper(Str::random(12));

        return DB::transaction(function () use ($booking, $refundAmount, $ref) {
            $tx = Transaction::create([
                "booking_id"     => $booking->id,
                "momo_reference" => $ref,
                "amount_gross"   => $refundAmount,
                "platform_fee"   => 0.00,
                "amount_net"     => $refundAmount,
                "type"           => "REFUND",
                "status"         => "PENDING",
            ]);

            $success = $this->callMomoApi("refund", ["amount" => $refundAmount, "reference" => $ref, "payee" => $booking->buyer->email]);
            $tx->update(["status" => $success ? "SUCCESS" : "FAILED"]);
            Log::info("PaymentService: PARTIAL_REFUND " . ($success ? "success" : "failed"), ["tx_id" => $tx->id, "amount" => $refundAmount]);
            return $tx->fresh();
        });
    }

    public function processRetryQueue(): array
    {
        $due = Transaction::where("type", "PAY_OUT")
            ->where("status", "FAILED")
            ->where("retry_count", "<=", $this->maxRetries)
            ->where("next_retry_at", "<=", Carbon::now())
            ->whereNotNull("next_retry_at")
            ->get();

        $attempted = 0;
        $succeeded = 0;

        foreach ($due as $tx) {
            /** @var Transaction $tx */
            $attempted++;
            $this->attemptPayout($tx);
            $tx->refresh();
            if ($tx->status === "SUCCESS") {
                $succeeded++;
            }
        }

        return compact("attempted", "succeeded");
    }

    private function callMomoApi(string $_operation, array $_payload): bool
    {
        if ((bool) env("MOMO_SIMULATE_FAILURE", false)) {
            return false;
        }
        return true; // TODO: real MTN MoMo API in production
    }

    private function assertStatus(Booking $booking, string $expected): void
    {
        if ($booking->status !== $expected) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, "Booking must be in status {$expected} (current: {$booking->status}).");
        }
    }
}
