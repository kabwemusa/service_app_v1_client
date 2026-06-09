<?php

namespace App\Services\Payment;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * MTN Mobile Money API client — Collections + Disbursements.
 *
 * Collections (PAY_IN):
 *   POST /collection/v1_0/requesttopay → 202 → poll for SUCCESSFUL / FAILED
 *
 * Disbursements (PAY_OUT / REFUND):
 *   POST /disbursement/v1_0/transfer → 202 → poll for SUCCESSFUL / FAILED
 *
 * Each product uses its own Subscription Key + API User + API Key triple.
 * Tokens are cached in Redis/database until 60 s before they expire.
 *
 * To add Airtel or Zamtel later: implement the same interface in a sibling class
 * (e.g. AirtelMoneyClient) and route from PaymentService based on momo_provider.
 */
class MtnMomoClient
{
    private string $baseUrl;
    private string $environment;
    private string $currency;
    private int    $pollMaxAttempts;
    private int    $pollIntervalMs;

    public function __construct()
    {
        $cfg = config('payment.momo');

        $this->baseUrl         = rtrim($cfg['base_url'], '/');
        $this->environment     = $cfg['environment'];
        $this->currency        = $cfg['currency'];
        $this->pollMaxAttempts = (int) $cfg['poll_max_attempts'];
        $this->pollIntervalMs  = (int) $cfg['poll_interval_ms'];
    }

    /**
     * Charge a customer (PAY_IN).
     *
     * Sends a USSD push to the buyer's phone requesting payment approval.
     * Blocks until SUCCESSFUL / FAILED or the polling window expires.
     *
     * @param  string  $msisdn       Buyer's phone — any Zambian format (normalised internally)
     * @param  float   $amount       ZMW amount
     * @param  string  $referenceId  UUID stored in transactions.momo_reference
     */
    public function requestToPay(string $msisdn, float $amount, string $referenceId): bool
    {
        $msisdn = $this->normaliseMsisdn($msisdn);

        $response = Http::withHeaders($this->buildHeaders('collections', $referenceId))
            ->post("{$this->baseUrl}/collection/v1_0/requesttopay", [
                'amount'       => (string) round($amount, 2),
                'currency'     => $this->currency,
                'externalId'   => $referenceId,
                'payer'        => ['partyIdType' => 'MSISDN', 'partyId' => $msisdn],
                'payerMessage' => 'Payment for Sebenza service',
                'payeeNote'    => 'Sebenza escrow payment',
            ]);

        if ($response->status() !== 202) {
            Log::error('MtnMomo::requestToPay — API rejected request', [
                'http_status'  => $response->status(),
                'body'         => $response->body(),
                'referenceId'  => $referenceId,
                'msisdn'       => $msisdn,
            ]);
            return false;
        }

        return $this->pollUntilDone('collections', $referenceId, 'collection/v1_0/requesttopay');
    }

    /**
     * Send money to a provider or buyer (PAY_OUT / REFUND).
     *
     * @param  string  $msisdn       Recipient's phone — provider's momo_number or buyer's phone
     * @param  float   $amount       ZMW amount
     * @param  string  $referenceId  UUID stored in transactions.momo_reference
     * @param  string  $note         Short note shown to the recipient on their phone
     */
    public function transfer(string $msisdn, float $amount, string $referenceId, string $note = 'Sebenza payout'): bool
    {
        $msisdn = $this->normaliseMsisdn($msisdn);

        $response = Http::withHeaders($this->buildHeaders('disbursements', $referenceId))
            ->post("{$this->baseUrl}/disbursement/v1_0/transfer", [
                'amount'       => (string) round($amount, 2),
                'currency'     => $this->currency,
                'externalId'   => $referenceId,
                'payee'        => ['partyIdType' => 'MSISDN', 'partyId' => $msisdn],
                'payerMessage' => $note,
                'payeeNote'    => $note,
            ]);

        if ($response->status() !== 202) {
            Log::error('MtnMomo::transfer — API rejected request', [
                'http_status'  => $response->status(),
                'body'         => $response->body(),
                'referenceId'  => $referenceId,
                'msisdn'       => $msisdn,
            ]);
            return false;
        }

        return $this->pollUntilDone('disbursements', $referenceId, 'disbursement/v1_0/transfer');
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Poll the status endpoint until SUCCESSFUL, FAILED, or the configured
     * timeout is reached. Each poll waits $pollIntervalMs milliseconds.
     *
     * Default: 24 × 5 s = 2 minutes maximum wait.
     */
    private function pollUntilDone(string $product, string $referenceId, string $statusPath): bool
    {
        for ($i = 0; $i < $this->pollMaxAttempts; $i++) {
            usleep($this->pollIntervalMs * 1000);

            $status = $this->fetchStatus($product, $referenceId, $statusPath);

            if ($status === 'SUCCESSFUL') {
                Log::info("MtnMomo: {$product} {$referenceId} SUCCESSFUL");
                return true;
            }

            if ($status === 'FAILED') {
                Log::warning("MtnMomo: {$product} {$referenceId} FAILED");
                return false;
            }
            // PENDING — keep polling
        }

        Log::error("MtnMomo: polling timed out after {$this->pollMaxAttempts} attempts", [
            'product'     => $product,
            'referenceId' => $referenceId,
        ]);
        return false;
    }

    private function fetchStatus(string $product, string $referenceId, string $statusPath): string
    {
        try {
            $response = Http::withHeaders($this->buildHeaders($product))
                ->get("{$this->baseUrl}/{$statusPath}/{$referenceId}");

            if (! $response->successful()) {
                return 'PENDING';   // treat HTTP errors as still pending
            }

            return $response->json('status', 'PENDING');
        } catch (\Throwable $e) {
            Log::warning('MtnMomo: status check threw exception', ['error' => $e->getMessage()]);
            return 'PENDING';
        }
    }

    /**
     * Build the headers required by the MTN API for a given product.
     * $referenceId is only included on POST requests (creates the resource).
     */
    private function buildHeaders(string $product, ?string $referenceId = null): array
    {
        $cfg     = config("payment.momo.{$product}");
        $headers = [
            'Authorization'             => 'Bearer ' . $this->token($product),
            'X-Target-Environment'      => $this->environment,
            'Ocp-Apim-Subscription-Key' => $cfg['subscription_key'],
            'Content-Type'              => 'application/json',
        ];

        if ($referenceId !== null) {
            $headers['X-Reference-Id'] = $referenceId;
        }

        return $headers;
    }

    /**
     * Fetch (or return cached) OAuth 2.0 bearer token for a given product.
     *
     * Tokens are valid for 3600 s; we cache for 3540 s to always have
     * a 60 s safety buffer before expiry.
     */
    private function token(string $product): string
    {
        return Cache::remember("mtn:momo:token:{$product}", 3540, function () use ($product) {
            $cfg    = config("payment.momo.{$product}");
            $cred   = base64_encode("{$cfg['api_user_id']}:{$cfg['api_key']}");
            $prefix = ($product === 'collections') ? 'collection' : 'disbursement';

            $response = Http::withHeaders([
                'Authorization'             => "Basic {$cred}",
                'Ocp-Apim-Subscription-Key' => $cfg['subscription_key'],
            ])->post("{$this->baseUrl}/{$prefix}/token/");

            if (! $response->successful()) {
                Log::error("MtnMomo: token request failed for {$product}", [
                    'http_status' => $response->status(),
                    'body'        => $response->body(),
                ]);
                throw new \RuntimeException(
                    "MTN MoMo authentication failed for {$product}. Verify your API credentials in .env."
                );
            }

            return $response->json('access_token');
        });
    }

    /**
     * Normalise a Zambian phone number to MSISDN format: 260XXXXXXXXX
     *
     * Handles all common formats:
     *   +260971234567  →  260971234567
     *    260971234567  →  260971234567
     *     0971234567  →  260971234567
     *      971234567  →  260971234567  (bare 9-digit)
     */
    private function normaliseMsisdn(string $phone): string
    {
        $clean = preg_replace('/[\s\-\(\)+]/', '', $phone);

        if (str_starts_with($clean, '260') && strlen($clean) === 12) {
            return $clean;
        }
        if (str_starts_with($clean, '0') && strlen($clean) === 10) {
            return '260' . substr($clean, 1);
        }
        if (strlen($clean) === 9) {
            return '260' . $clean;
        }

        // Already in some valid format — return as-is and let the API reject if wrong
        return $clean;
    }
}
