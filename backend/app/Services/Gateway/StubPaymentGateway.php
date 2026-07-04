<?php

namespace App\Services\Gateway;

use App\Contracts\PaymentGateway;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class StubPaymentGateway implements PaymentGateway
{
    public function holdFunds(
        string $payerPhone,
        float  $amount,
        string $bookingId,
        float  $commissionSplit,
        float  $providerSplit,
    ): string {
        $ref = 'STUB-HOLD-' . Str::uuid();
        Log::info('StubPaymentGateway::holdFunds', compact('payerPhone', 'amount', 'bookingId', 'ref'));
        return $ref;
    }

    public function releaseFunds(
        string $holdRef,
        string $providerPhone,
        float  $amount,
        string $bookingId,
    ): ?string {
        $ref = 'STUB-PAYOUT-' . Str::uuid();
        Log::info('StubPaymentGateway::releaseFunds', compact('holdRef', 'providerPhone', 'amount', 'bookingId', 'ref'));
        return $ref;
    }

    public function refund(
        string $holdRef,
        string $payerPhone,
        float  $amount,
    ): bool {
        Log::info('StubPaymentGateway::refund', compact('holdRef', 'payerPhone', 'amount'));
        return true;
    }

    public function status(string $holdRef): array
    {
        return [
            'status'     => 'HELD',
            'amount'     => 0.0,
            'created_at' => now()->toIso8601String(),
        ];
    }
}
