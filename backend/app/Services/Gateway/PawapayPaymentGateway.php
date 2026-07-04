<?php

namespace App\Services\Gateway;

use App\Contracts\PaymentGateway;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PawapayPaymentGateway implements PaymentGateway
{
    private string $baseUrl;
    private string $token;
    private string $currency;
    private array  $prefixMap;
    private string $statement;
    private ?string $sandboxForcePayer;

    public function __construct()
    {
        $this->baseUrl   = rtrim(config('pawapay.base_url'), '/');
        $this->token     = config('pawapay.api_token');
        $this->currency  = config('pawapay.currency');
        $this->prefixMap = config('pawapay.prefix_map');
        $this->statement = $this->sanitizeCustomerMessage(config('pawapay.statement_description'));
        // Sandbox-only: force the payer MSISDN to a pawaPay test number so deposits
        // resolve to a deterministic outcome (e.g. 260973456789 → COMPLETED). MUST be
        // empty in production — guarded again at use-site against the sandbox base URL.
        $this->sandboxForcePayer = config('pawapay.sandbox_force_payer') ?: null;
    }

    /**
     * pawaPay v2 `customerMessage`: 4–22 chars, alphanumeric + spaces only
     * (^[a-zA-Z0-9 ]+$). Strip disallowed characters, collapse whitespace and
     * clamp length; fall back to a safe default if nothing usable remains.
     */
    private function sanitizeCustomerMessage(?string $raw): string
    {
        $clean = preg_replace('/[^a-zA-Z0-9 ]/', '', (string) $raw);
        $clean = trim(preg_replace('/\s+/', ' ', $clean));

        if (strlen($clean) < 4) {
            $clean = 'Sebenza';
        }

        return substr($clean, 0, 22);
    }

    /**
     * Initiate a deposit (customer collection) via PawaPay.
     * Returns the depositId — the actual payment is ASYNC;
     * PawaPay will POST to our callback when completed/failed.
     */
    public function holdFunds(
        string $payerPhone,
        float  $amount,
        string $bookingId,
        float  $commissionSplit,
        float  $providerSplit,
    ): string {
        $depositId    = (string) Str::uuid();

        $effectivePayer = $payerPhone;
        if ($this->sandboxForcePayer && str_contains($this->baseUrl, 'sandbox')) {
            Log::warning('PawaPay: SANDBOX payer override active — using test MSISDN', [
                'realPayer'  => $payerPhone,
                'forced'     => $this->sandboxForcePayer,
            ]);
            $effectivePayer = $this->sandboxForcePayer;
        }

        $phone        = $this->normalizePhone($effectivePayer);
        $correspondent = $this->resolveCorrespondent($phone);

        $payload = [
            'depositId'  => $depositId,
            'amount'     => number_format($amount, 2, '.', ''),
            'currency'   => $this->currency,
            'payer'      => [
                'type'           => 'MMO',
                'accountDetails' => [
                    'phoneNumber' => $phone,
                    'provider'    => $correspondent,
                ],
            ],
            'customerMessage'      => $this->statement,
            'metadata'             => [
                ['key' => 'bookingId', 'value' => $bookingId],
            ],
        ];

        Log::info('PawaPay: initiating deposit', [
            'depositId' => $depositId,
            'phone'     => $phone,
            'amount'    => $amount,
            'provider'  => $correspondent,
            'bookingId' => $bookingId,
        ]);

        $response = Http::withToken($this->token)
            ->timeout(30)
            ->post("{$this->baseUrl}/v2/deposits", $payload);

        if ($response->failed()) {
            Log::error('PawaPay: deposit initiation failed', [
                'depositId' => $depositId,
                'status'    => $response->status(),
                'body'      => $response->body(),
            ]);
            throw new \RuntimeException(
                "PawaPay deposit failed: {$response->status()} — {$response->body()}"
            );
        }

        $data = $response->json();

        if (($data['status'] ?? '') === 'REJECTED') {
            $reason = $data['failureReason']['failureMessage'] ?? 'Unknown';
            Log::error('PawaPay: deposit rejected', ['depositId' => $depositId, 'reason' => $reason]);
            throw new \RuntimeException("PawaPay deposit rejected: {$reason}");
        }

        Log::info('PawaPay: deposit accepted', [
            'depositId' => $depositId,
            'status'    => $data['status'] ?? 'unknown',
        ]);

        return $depositId;
    }

    /**
     * Payout to provider's MoMo.
     */
    public function releaseFunds(
        string $holdRef,
        string $providerPhone,
        float  $amount,
        string $bookingId,
    ): ?string {
        $payoutId      = (string) Str::uuid();
        $phone         = $this->normalizePhone($providerPhone);
        $correspondent = $this->resolveCorrespondent($phone);

        $payload = [
            'payoutId'  => $payoutId,
            'amount'    => number_format($amount, 2, '.', ''),
            'currency'  => $this->currency,
            'recipient' => [
                'type'           => 'MMO',
                'accountDetails' => [
                    'phoneNumber' => $phone,
                    'provider'    => $correspondent,
                ],
            ],
            'customerMessage'      => $this->statement,
            'metadata'             => [
                ['key' => 'bookingId', 'value' => $bookingId],
                ['key' => 'depositRef', 'value' => $holdRef],
            ],
        ];

        Log::info('PawaPay: initiating payout', [
            'payoutId'  => $payoutId,
            'phone'     => $phone,
            'amount'    => $amount,
            'bookingId' => $bookingId,
        ]);

        $response = Http::withToken($this->token)
            ->timeout(30)
            ->post("{$this->baseUrl}/v2/payouts", $payload);

        if ($response->failed()) {
            Log::error('PawaPay: payout failed', [
                'payoutId' => $payoutId,
                'status'   => $response->status(),
                'body'     => $response->body(),
            ]);
            return null;
        }

        $data = $response->json();
        Log::info('PawaPay: payout accepted', ['payoutId' => $payoutId, 'status' => $data['status'] ?? 'unknown']);

        return ($data['status'] ?? '') === 'ACCEPTED' ? $payoutId : null;
    }

    /**
     * Refund deposit back to customer.
     */
    public function refund(
        string $holdRef,
        string $payerPhone,
        float  $amount,
    ): bool {
        $refundId = (string) Str::uuid();

        $payload = [
            'refundId'  => $refundId,
            'depositId' => $holdRef,
            'amount'    => number_format($amount, 2, '.', ''),
            'currency'  => $this->currency,
            'customerMessage'      => $this->statement,
        ];

        Log::info('PawaPay: initiating refund', [
            'refundId'  => $refundId,
            'depositId' => $holdRef,
            'amount'    => $amount,
        ]);

        $response = Http::withToken($this->token)
            ->timeout(30)
            ->post("{$this->baseUrl}/v2/refunds", $payload);

        if ($response->failed()) {
            Log::error('PawaPay: refund failed', [
                'refundId' => $refundId,
                'status'   => $response->status(),
                'body'     => $response->body(),
            ]);
            return false;
        }

        $data = $response->json();
        Log::info('PawaPay: refund accepted', ['refundId' => $refundId, 'status' => $data['status'] ?? 'unknown']);

        return ($data['status'] ?? '') === 'ACCEPTED';
    }

    /**
     * Check deposit status.
     */
    public function status(string $holdRef): array
    {
        $response = Http::withToken($this->token)
            ->timeout(15)
            ->get("{$this->baseUrl}/v2/deposits/{$holdRef}");

        if ($response->failed()) {
            return ['status' => 'UNKNOWN', 'amount' => 0.0, 'created_at' => ''];
        }

        $data = $response->json();

        return [
            'status'     => $data['status'] ?? 'UNKNOWN',
            'amount'     => (float) ($data['amount'] ?? 0),
            'created_at' => $data['created'] ?? '',
        ];
    }

    /**
     * Strip +/spaces, ensure bare digits starting with country code.
     */
    private function normalizePhone(string $phone): string
    {
        $phone = preg_replace('/[^0-9]/', '', $phone);

        // If it starts with 0, prepend 260
        if (str_starts_with($phone, '0')) {
            $phone = '260' . substr($phone, 1);
        }

        return $phone;
    }

    /**
     * Map a Zambian phone number to its PawaPay correspondent code.
     */
    private function resolveCorrespondent(string $phone): string
    {
        // Phone is bare digits starting with 260
        $local = substr($phone, 3); // strip 260 → 97xxxxxxx
        $prefix = '0' . substr($local, 0, 2); // → 097

        if (isset($this->prefixMap[$prefix])) {
            return $this->prefixMap[$prefix];
        }

        Log::warning('PawaPay: unknown phone prefix, defaulting to AIRTEL', [
            'phone' => $phone, 'prefix' => $prefix,
        ]);
        return 'AIRTEL_OAPI_ZMB';
    }
}
