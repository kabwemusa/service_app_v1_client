<?php

namespace App\Services\Gateway;

use App\Contracts\PaymentGateway;
use App\Contracts\PaymentStatusVerifier;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Lipila (https://blaze-docs.lipila.dev) — Mobile Money collections + disbursements.
 *
 * Four things differ from the Lenco adapter this replaced, and all four are load
 * bearing:
 *
 *  1. WE own the reference — same as before. Lipila takes a merchant-supplied
 *     `referenceId` on both collections and disbursements and keys its read API
 *     (`/collections/check-status?referenceId=`, `/disbursements/check-status?…`)
 *     and its callbacks on it. So the string we persist in escrow_hold_ref /
 *     balance_hold_ref / payout_ref / refund_ref IS the lookup key. A repeat is a
 *     hard 400 ("Duplicate reference ID attempted"), which makes it a de-facto
 *     idempotency key too.
 *
 *  2. NO operator field. Lenco made us map a prefix to an operator enum and
 *     rejected a mismatch. Lipila resolves the MNO from the MSISDN itself and
 *     reports it back as `paymentType` (MtnMoney | AirtelMoney | ZamtelKwacha).
 *     One less thing to get wrong; config('lipila.prefix_map') survives only for
 *     admin-side MNO grouping.
 *
 *  3. Phone format is INTERNATIONAL, `260XXXXXXXXX`. Lenco wanted the local
 *     0-leading form. Sending the local form to Lipila is a 400.
 *
 *  4. Responses are FLAT — no `{status, message, data}` envelope. The transaction
 *     object is the response body. (The one exception is /merchants/balance,
 *     which does wrap in `data`.)
 *
 * Unchanged from Lenco: there is still NO refund endpoint. A refund is an
 * ordinary mobile-money disbursement back to the payer, debited from our wallet.
 * It therefore has its own reference and reconciles as a disbursement, not as a
 * child of the collection — which is why bookings.refund_ref exists.
 *
 * Statuses are translated into the canonical uppercase vocabulary the booking
 * lifecycle already speaks (COMPLETED / FAILED / PENDING / UNKNOWN) so nothing
 * downstream has to know which processor is bound.
 */
class LipilaPaymentGateway implements PaymentGateway, PaymentStatusVerifier
{
    /** Lipila status → the canonical status the booking lifecycle understands. */
    private const STATUS_MAP = [
        'successful' => 'COMPLETED',
        'success'    => 'COMPLETED',
        'completed'  => 'COMPLETED',
        'failed'     => 'FAILED',
        'cancelled'  => 'FAILED',
        'pending'    => 'PENDING',
        'processing' => 'PENDING',
    ];

    private string  $baseUrl;
    private string  $apiKey;
    private string  $disbursementApiKey;
    private string  $currency;
    private string  $narration;
    private string  $refPrefix;
    private ?string $callbackUrl;
    private ?string $sandboxForcePayer;

    public function __construct()
    {
        $this->baseUrl            = rtrim((string) config('lipila.base_url'), '/');
        $this->apiKey             = (string) config('lipila.api_key');
        $this->disbursementApiKey = (string) (config('lipila.disbursement_api_key') ?: $this->apiKey);
        $this->currency           = (string) config('lipila.currency', 'ZMW');
        $this->narration          = $this->sanitizeNarration(config('lipila.narration'));
        $this->refPrefix          = preg_replace('/[^a-zA-Z0-9]/', '', (string) config('lipila.reference_prefix', 'sbz')) ?: 'sbz';
        $this->callbackUrl        = config('lipila.callback_url') ?: null;
        // Sandbox-only payer override — guarded again at the use site against the
        // sandbox base URL so a stray env var cannot redirect a live charge.
        $this->sandboxForcePayer  = config('lipila.sandbox_force_payer') ?: null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PaymentGateway
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Collect from the customer's Mobile Money wallet.
     *
     * ASYNCHRONOUS: a 200 here means Lipila accepted the request and pushed a
     * prompt to the handset (status `Pending`), NOT that money moved. The booking
     * only advances when the callback arrives (and its status is re-verified).
     * Returns the reference to persist as the hold ref.
     */
    public function holdFunds(
        string $payerPhone,
        float  $amount,
        string $bookingId,
        float  $commissionSplit,
        float  $providerSplit,
    ): string {
        $reference = $this->reference('dep');

        $effectivePayer = $payerPhone;
        if ($this->sandboxForcePayer && $this->isSandbox()) {
            Log::warning('Lipila: SANDBOX payer override active — using test MSISDN', [
                'realPayer' => $payerPhone,
                'forced'    => $this->sandboxForcePayer,
            ]);
            $effectivePayer = $this->sandboxForcePayer;
        }

        $phone = $this->normalizePhone($effectivePayer);

        $payload = [
            'referenceId'   => $reference,
            'amount'        => round($amount, 2),
            'narration'     => $this->narration . ' booking',
            'accountNumber' => $phone,
            'currency'      => $this->currency,
            // Echoed back on every status read and callback. Purely diagnostic —
            // bookings are ALWAYS resolved by the reference we persisted, never by
            // anything the gateway echoes.
            'referenceData' => $bookingId,
        ];

        Log::info('Lipila: initiating collection', [
            'reference' => $reference,
            'phone'     => $phone,
            'amount'    => $amount,
            'bookingId' => $bookingId,
        ]);

        try {
            $response = $this->client('write', $this->apiKey)
                ->post("{$this->baseUrl}/api/v1/collections/mobile-money", $payload);
        } catch (\Throwable $e) {
            Log::error('Lipila: collection threw', ['reference' => $reference, 'error' => $e->getMessage()]);
            throw new \RuntimeException('Lipila collection failed: ' . $e->getMessage(), previous: $e);
        }

        if ($response->failed()) {
            Log::error('Lipila: collection initiation failed', [
                'reference' => $reference,
                'http'      => $response->status(),
                'body'      => $response->body(),
            ]);
            throw new \RuntimeException(
                'Lipila collection failed: ' . $response->status() . ' — ' . $this->errorMessage($response)
            );
        }

        $data   = (array) ($response->json() ?? []);
        $status = $this->canonical($data['status'] ?? null);

        // Some failure modes (barred wallet, unroutable MSISDN) are reported
        // synchronously — surface them now rather than leaving the booking
        // waiting on a callback that will never come.
        if ($status === 'FAILED') {
            $reason = $data['message'] ?? 'Unknown';
            Log::error('Lipila: collection rejected on initiation', ['reference' => $reference, 'reason' => $reason]);
            throw new \RuntimeException("Lipila collection rejected: {$reason}");
        }

        Log::info('Lipila: collection accepted', [
            'reference'   => $reference,
            'identifier'  => $data['identifier'] ?? null,
            'paymentType' => $data['paymentType'] ?? null,
            'status'      => $data['status'] ?? 'unknown',
        ]);

        return $reference;
    }

    /**
     * Pay the provider's share out to their Mobile Money wallet.
     * Returns the disbursement reference to persist (payout_ref), or null on
     * failure so the due-payout batch re-attempts.
     */
    public function releaseFunds(
        string $holdRef,
        string $providerPhone,
        float  $amount,
        string $bookingId,
    ): ?string {
        return $this->disburse(
            reference: $this->reference('pay'),
            phone:     $providerPhone,
            amount:    $amount,
            narration: $this->narration . ' payout',
            context:   ['bookingId' => $bookingId, 'holdRef' => $holdRef, 'kind' => 'payout'],
        );
    }

    /**
     * Refund the customer.
     *
     * Lipila has no refund endpoint — money goes back as a fresh mobile-money
     * disbursement debited from our wallet. $holdRef is therefore only context
     * (the collection being reversed), not something Lipila can reverse for us.
     */
    public function refund(
        string $holdRef,
        string $payerPhone,
        float  $amount,
    ): ?string {
        return $this->disburse(
            reference: $this->reference('ref'),
            phone:     $payerPhone,
            amount:    $amount,
            narration: $this->narration . ' refund',
            context:   ['holdRef' => $holdRef, 'kind' => 'refund'],
        );
    }

    /**
     * Current state of a collection.
     *
     * `created_at` is best-effort: Lipila returns `createdAt` on the initiation
     * response but omits it from check-status, so a read of an existing
     * collection yields an empty string. No caller depends on it.
     *
     * @return array{status: string, amount: float, created_at: string}
     */
    public function status(string $holdRef): array
    {
        $record = $this->fetchRecord('deposit', $holdRef);

        return [
            'status'     => $this->canonical($record['status'] ?? null),
            'amount'     => (float) ($record['amount'] ?? 0),
            'created_at' => (string) ($record['createdAt'] ?? ''),
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PaymentStatusVerifier
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Authoritative status re-fetch. The webhook handler uses THIS, never the
     * status a callback body claims, so even a callback that somehow passes the
     * signature check cannot fake a payment outcome. 'UNKNOWN' on any doubt —
     * the handler then makes no state change.
     */
    public function verifyStatus(string $kind, string $ref): string
    {
        $record = $this->fetchRecord($kind, $ref);

        return $record === [] ? 'UNKNOWN' : $this->canonical($record['status'] ?? null);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Both payouts and refunds are the same Lipila primitive: debit our wallet,
     * credit a mobile-money wallet. Returns the reference on acceptance
     * (`Pending` or `Successful`), null on rejection.
     */
    private function disburse(
        string $reference,
        string $phone,
        float  $amount,
        string $narration,
        array  $context,
    ): ?string {
        if ($this->disbursementApiKey === '') {
            Log::error('Lipila: no API key for disbursements — set LIPILA_API_KEY', $context);
            return null;
        }

        $msisdn = $this->normalizePhone($phone);

        $payload = [
            'referenceId'   => $reference,
            'amount'        => round($amount, 2),
            'narration'     => $narration,
            'accountNumber' => $msisdn,
            'currency'      => $this->currency,
            'referenceData' => (string) ($context['bookingId'] ?? $context['holdRef'] ?? ''),
        ];

        Log::info('Lipila: initiating disbursement', $context + [
            'reference' => $reference,
            'phone'     => $msisdn,
            'amount'    => $amount,
        ]);

        try {
            $response = $this->client('write', $this->disbursementApiKey)
                ->post("{$this->baseUrl}/api/v1/disbursements/mobile-money", $payload);
        } catch (\Throwable $e) {
            Log::error('Lipila: disbursement threw', $context + ['reference' => $reference, 'error' => $e->getMessage()]);
            return null;
        }

        if ($response->failed()) {
            $reason = $this->errorMessage($response);

            // Three operationally distinct failures hide behind "the request
            // failed", and they need different people to act:
            //
            //   401 (bare, no body) — the wallet behind the key is not authorised
            //     to disburse. An integration problem: nothing will ever succeed.
            //   "Insufficient balance" (Lipila returns 500, not 4xx) — a TREASURY
            //     problem. The request was perfectly valid; the float is empty.
            //     Retrying is correct and will work once the wallet is topped up.
            //   anything else — transient or a genuine bug.
            //
            // All three return null so the due-payout batch re-attempts, but only
            // the log tells ops which lever to pull.
            if ($response->status() === 401) {
                Log::error('Lipila: disbursement UNAUTHORISED — the API key\'s wallet is not enabled for '
                    . 'disbursements. Set LIPILA_DISBURSEMENT_API_KEY to a disbursement-wallet key.', $context + [
                        'reference' => $reference,
                    ]);
            } elseif (stripos($reason, 'insufficient balance') !== false) {
                Log::error('Lipila: disbursement blocked — INSUFFICIENT WALLET BALANCE. Top up the Lipila '
                    . 'float; the due-payout batch will re-attempt.', $context + [
                        'reference' => $reference,
                        'amount'    => round($amount, 2),
                    ]);
            } else {
                Log::error('Lipila: disbursement failed', $context + [
                    'reference' => $reference,
                    'http'      => $response->status(),
                    'reason'    => $reason,
                    'body'      => $response->body(),
                ]);
            }
            return null;
        }

        $data   = (array) ($response->json() ?? []);
        $status = $this->canonical($data['status'] ?? null);

        if ($status === 'FAILED') {
            Log::error('Lipila: disbursement rejected', $context + [
                'reference' => $reference,
                'reason'    => $data['message'] ?? null,
            ]);
            return null;
        }

        Log::info('Lipila: disbursement accepted', $context + [
            'reference'  => $reference,
            'identifier' => $data['identifier'] ?? null,
            'status'     => $data['status'] ?? 'unknown',
        ]);

        return $reference;
    }

    /**
     * GET the collection/disbursement record from Lipila by OUR reference, or []
     * on any failure (including the 404 for a reference Lipila has never seen).
     */
    private function fetchRecord(string $kind, string $ref): array
    {
        [$path, $key] = match ($kind) {
            'deposit', 'collection' => ['collections', $this->apiKey],
            // A refund IS a disbursement under Lipila — same read endpoint.
            'payout', 'refund', 'transfer', 'disbursement' => ['disbursements', $this->disbursementApiKey],
            default => [null, null],
        };

        if ($path === null || $ref === '') {
            return [];
        }

        try {
            $response = $this->client('read', $key)
                ->get("{$this->baseUrl}/api/v1/{$path}/check-status", ['referenceId' => $ref]);
        } catch (\Throwable $e) {
            Log::error('Lipila: status re-fetch threw', ['kind' => $kind, 'ref' => $ref, 'error' => $e->getMessage()]);
            return [];
        }

        if ($response->failed()) {
            Log::warning('Lipila: status re-fetch failed', ['kind' => $kind, 'ref' => $ref, 'http' => $response->status()]);
            return [];
        }

        return (array) ($response->json() ?? []);
    }

    /**
     * Lipila authenticates with an `x-api-key` header, not a Bearer token.
     *
     * `callbackUrl` is a per-request HEADER (not a body field and not a
     * dashboard-wide setting), so it goes on every write.
     */
    private function client(string $kind, string $apiKey): \Illuminate\Http\Client\PendingRequest
    {
        $headers = ['x-api-key' => $apiKey];

        if ($kind === 'write' && ($callback = $this->callbackUrl())) {
            $headers['callbackUrl'] = $callback;
        }

        return Http::withHeaders($headers)
            ->acceptJson()
            ->timeout((int) config("lipila.timeout.{$kind}", 30));
    }

    /** Configured callback URL, else this app's own webhook route. */
    private function callbackUrl(): ?string
    {
        if ($this->callbackUrl) {
            return $this->callbackUrl;
        }

        try {
            return route('lipila.webhook');
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * A unique reference. Lipila's only constraint is uniqueness per merchant, so
     * a UUID satisfies it; the `sbz-dep-` style prefix makes references
     * self-describing in Lipila's dashboard and in our own logs.
     */
    private function reference(string $kind): string
    {
        return "{$this->refPrefix}-{$kind}-" . Str::uuid();
    }

    /** Lipila's TitleCase status → our canonical uppercase one. */
    private function canonical(?string $lipilaStatus): string
    {
        return self::STATUS_MAP[strtolower(trim((string) $lipilaStatus))] ?? 'UNKNOWN';
    }

    private function isSandbox(): bool
    {
        return str_contains($this->baseUrl, 'lipila.dev');
    }

    /**
     * Pull a human-readable reason out of a Lipila error body. Validation errors
     * come back as `{statusCode, message, errors: {field: [msg, …]}}`; the field
     * messages are the useful part.
     */
    private function errorMessage(\Illuminate\Http\Client\Response $response): string
    {
        $body = $response->json();

        if (! is_array($body)) {
            return $response->body() !== '' ? substr($response->body(), 0, 200) : 'unknown error';
        }

        $details = [];
        foreach ((array) ($body['errors'] ?? []) as $field => $messages) {
            foreach ((array) $messages as $message) {
                $details[] = is_int($field) ? (string) $message : "{$field}: {$message}";
            }
        }

        if ($details !== []) {
            return implode('; ', $details);
        }

        return (string) ($body['message'] ?? 'unknown error');
    }

    /** Lipila validates narration at 3–200 characters and rejects anything else. */
    private function sanitizeNarration(?string $raw): string
    {
        $clean = trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-zA-Z0-9 ]/', '', (string) $raw)));

        return $clean === '' ? 'Sebenza' : substr($clean, 0, 40);
    }

    /**
     * Lipila expects the INTERNATIONAL form with no plus — `260XXXXXXXXX` (12
     * digits). Anything else is a 400 ("Invalid phone number format"). We store
     * E.164 (+260…), and WhatsApp/legacy rows may hold the local 0-form, so both
     * collapse to the same canonical MSISDN here.
     */
    private function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone);

        // The last 9 digits are the subscriber number in every form we accept
        // (0971234567, 971234567, 260971234567, 00260971234567).
        if (strlen($digits) >= 9) {
            $digits = substr($digits, -9);
        }

        return '260' . $digits;
    }
}
