<?php

namespace App\Services\WhatsApp;

use App\Contracts\PaymentGateway;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class TestPaymentGateway implements PaymentGateway
{
    public function holdFunds(
        string $payerPhone,
        float  $amount,
        string $bookingId,
        float  $commissionSplit,
        float  $providerSplit,
    ): string {
        $ref = 'TEST-HOLD-' . Str::uuid();
        Log::info('TestPaymentGateway::holdFunds — auto-confirmed', compact('payerPhone', 'amount', 'bookingId', 'ref'));
        return $ref;
    }

    public function releaseFunds(
        string $holdRef,
        string $providerPhone,
        float  $amount,
        string $bookingId,
    ): ?string {
        $ref = 'TEST-PAYOUT-' . Str::uuid();
        Log::info('TestPaymentGateway::releaseFunds — auto-released', compact('holdRef', 'providerPhone', 'amount', 'bookingId', 'ref'));
        return $ref;
    }

    public function refund(
        string $holdRef,
        string $payerPhone,
        float  $amount,
    ): bool {
        Log::info('TestPaymentGateway::refund — auto-refunded', compact('holdRef', 'payerPhone', 'amount'));
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
