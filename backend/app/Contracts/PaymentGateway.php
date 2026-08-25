<?php

namespace App\Contracts;

interface PaymentGateway
{
    /**
     * Hold funds in escrow for a booking.
     * Returns a gateway reference string for tracking.
     *
     * @param  string  $payerPhone   Customer's MoMo number
     * @param  float   $amount       Total amount to hold (service + protection fee)
     * @param  string  $bookingId    Internal booking UUID for reconciliation
     * @param  float   $commissionSplit  Platform commission portion
     * @param  float   $providerSplit    Provider portion
     * @return string  Gateway hold/transaction reference
     */
    public function holdFunds(
        string $payerPhone,
        float  $amount,
        string $bookingId,
        float  $commissionSplit,
        float  $providerSplit,
    ): string;

    /**
     * Release provider's portion from escrow to their MoMo.
     *
     * @param  string  $holdRef       Gateway hold reference from holdFunds()
     * @param  string  $providerPhone Provider's MoMo number
     * @param  float   $amount        Amount to disburse
     * @param  string  $bookingId     Internal booking UUID
     * @return string|null  Gateway payout reference if disbursement was initiated
     *                      successfully (persist it for reconciling the async
     *                      payout callback), null on failure.
     */
    public function releaseFunds(
        string $holdRef,
        string $providerPhone,
        float  $amount,
        string $bookingId,
    ): ?string;

    /**
     * Refund held funds back to the customer.
     *
     * Not every processor can reverse the original collection — Lipila, for one,
     * sends the money back as a fresh outbound disbursement with its own reference.
     * Callers must therefore persist the returned reference (bookings.refund_ref)
     * so the asynchronous outcome can be reconciled to the booking.
     *
     * @param  string  $holdRef    Gateway hold reference being reversed
     * @param  string  $payerPhone Customer's phone
     * @param  float   $amount     Amount to refund (full or partial)
     * @return string|null  Gateway refund reference if the refund was initiated
     *                      successfully, null on failure.
     */
    public function refund(
        string $holdRef,
        string $payerPhone,
        float  $amount,
    ): ?string;

    /**
     * Query the status of a hold/transaction.
     *
     * @param  string  $holdRef  Gateway reference
     * @return array{status: string, amount: float, created_at: string}
     */
    public function status(string $holdRef): array;
}
