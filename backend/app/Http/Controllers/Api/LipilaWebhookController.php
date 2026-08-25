<?php

namespace App\Http\Controllers\Api;

use App\Contracts\PaymentGateway;
use App\Contracts\PaymentStatusVerifier;
use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Services\Payments\PaymentEventProcessor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * POST /api/webhooks/lipila
 *
 * Lipila posts one callback per terminal state change to the URL we supply as the
 * `callbackUrl` header on each collection/disbursement. Unlike Lenco there is no
 * `event` name — the payload's own `type` field discriminates:
 *
 *   {"referenceId": "...", "type": "Collection"|"Disbursement",
 *    "status": "Successful"|"Failed", "amount": …, "accountNumber": "260…",
 *    "paymentType": "MtnMoney"|"AirtelMoney"|"ZamtelKwacha"|"Card"|"Bank",
 *    "identifier": "LPLXC-…", "externalId": "…", "message": "…"}
 *
 * SECURITY — this endpoint is public, so its input is untrusted. Four
 * independent defences, in order:
 *
 *   1. SIGNATURE. Lipila signs per the Standard Webhooks spec: HMAC-SHA256 over
 *      `{webhook-id}.{webhook-timestamp}.{raw_body}` under the base64-DECODED
 *      signing secret, base64-encoded and prefixed `v1,`. We verify against the
 *      RAW body — re-encoding the parsed JSON would change key order/escaping and
 *      break an otherwise-valid signature. The header may carry several
 *      space-delimited signatures during key rotation; any match is accepted.
 *
 *   2. TIMESTAMP. A signature stays valid forever, so a captured callback could
 *      be replayed. `webhook-timestamp` is inside the signed payload and must be
 *      within `lipila.webhook.tolerance` seconds of now.
 *
 *   3. STATUS RE-FETCH. The status a callback claims is NEVER used to move money.
 *      Before acting we re-fetch the authoritative status from Lipila's read API
 *      (PaymentStatusVerifier). The posted status is used only for logging and
 *      non-authoritative context (e.g. the failure reason shown to a customer).
 *
 *   4. REFERENCE OWNERSHIP. Bookings are resolved by the reference WE minted and
 *      persisted, never by anything the payload asserts about a booking.
 *
 * We acknowledge fast and unconditionally: a non-2xx invites a redelivery storm,
 * and every handler downstream is idempotent anyway.
 */
class LipilaWebhookController extends Controller
{
    /** How long a processed `webhook-id` is remembered for de-duplication. */
    private const IDEMPOTENCY_TTL = 86400;

    public function __construct(
        private readonly PaymentEventProcessor $processor,
    ) {}

    public function handle(Request $request): JsonResponse
    {
        if (! $this->signatureOk($request)) {
            Log::warning('Lipila webhook: rejected — bad, missing or stale signature', ['ip' => $request->ip()]);
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        // `webhook-id` is stable across Lipila's retries of the same event, so it
        // is the natural de-dup key. Best-effort only — every downstream handler
        // is independently idempotent, so a cache miss costs nothing but work.
        $webhookId = (string) $request->header('webhook-id', '');
        if ($webhookId !== '' && ! Cache::add("lipila:webhook:{$webhookId}", 1, self::IDEMPOTENCY_TTL)) {
            Log::info('Lipila webhook: duplicate delivery ignored', ['webhookId' => $webhookId]);
            return $this->ack();
        }

        $data = (array) $request->json()->all();

        // Our reference. `identifier` is Lipila's own transaction id — useful in
        // logs and for support tickets, but it is not what we persisted.
        $reference = (string) ($data['referenceId'] ?? '');
        $type      = strtolower(trim((string) ($data['type'] ?? '')));

        Log::info('Lipila webhook received', [
            'type'         => $data['type'] ?? null,
            'reference'    => $reference,
            'identifier'   => $data['identifier'] ?? null,
            'postedStatus' => $data['status'] ?? null,
        ]);

        if ($reference === '') {
            // Transactions initiated from Lipila's own dashboard carry no
            // merchant reference. Nothing to reconcile.
            Log::info('Lipila webhook: no merchant reference — informational only', ['type' => $type]);
            return $this->ack();
        }

        $context = [
            'provider'   => 'lipila',
            'reason'     => $data['message'] ?? null,
            'amount'     => isset($data['amount']) ? (float) $data['amount'] : null,
            'identifier' => $data['identifier'] ?? null,
            'externalId' => $data['externalId'] ?? null,
            'phone'      => $data['accountNumber'] ?? null,
            // Untrusted — carried only so a stub gateway (tests/local, never
            // production) has something to fall back on. See authoritativeStatus.
            'postedStatus' => self::canonical($data['status'] ?? null),
        ];

        match ($type) {
            'collection'   => $this->onCollection($reference, $context),
            'disbursement' => $this->onDisbursement($reference, $context),
            default        => Log::info('Lipila webhook: unknown transaction type ignored', [
                'type' => $data['type'] ?? null, 'reference' => $reference,
            ]),
        };

        return $this->ack();
    }

    /** Lipila's TitleCase status → the canonical lifecycle vocabulary. */
    private static function canonical(?string $lipilaStatus): string
    {
        return match (strtolower(trim((string) $lipilaStatus))) {
            'successful', 'success', 'completed' => 'COMPLETED',
            'failed', 'cancelled'                => 'FAILED',
            'pending', 'processing'              => 'PENDING',
            default                              => 'UNKNOWN',
        };
    }

    private function onCollection(string $reference, array $context): void
    {
        $status = $this->authoritativeStatus('deposit', $reference, $context);

        $this->processor->record($reference, 'collection', $status, $context);
        $this->processor->collection($reference, $status, $context);
    }

    /**
     * Payouts and refunds are the same Lipila primitive (an outbound
     * disbursement) and arrive on the same callback shape, so the reference
     * decides which it is — that's exactly why refund references are persisted on
     * the booking.
     */
    private function onDisbursement(string $reference, array $context): void
    {
        $status = $this->authoritativeStatus('payout', $reference, $context);
        $kind   = Booking::where('refund_ref', $reference)->exists() ? 'refund' : 'payout';

        $this->processor->record($reference, $kind, $status, $context);

        if ($kind === 'refund') {
            $this->processor->refund($reference, $status, $context);
        } else {
            $this->processor->payout($reference, $status, $context);
        }
    }

    /**
     * Re-fetch the true status from Lipila when the bound gateway supports it
     * (the real, money-moving gateway does). Stub/test gateways — bound only when
     * no real funds move — fall back to trusting the request, which is why they
     * are never bound in production.
     */
    private function authoritativeStatus(string $kind, string $reference, array $context): string
    {
        $gateway = app(PaymentGateway::class);

        if (! $gateway instanceof PaymentStatusVerifier) {
            return $context['postedStatus'] ?? 'UNKNOWN';
        }

        $verified = $gateway->verifyStatus($kind, $reference);

        if ($verified !== ($context['postedStatus'] ?? null)) {
            Log::info('Lipila webhook: status re-fetched', [
                'kind'     => $kind,
                'ref'      => $reference,
                'posted'   => $context['postedStatus'] ?? null,
                'verified' => $verified,
            ]);
        }

        return $verified;
    }

    /**
     * Standard Webhooks verification over the RAW request body.
     *
     * signedPayload = "{webhook-id}.{webhook-timestamp}.{raw_body}"
     * expected      = "v1," . base64(hmac_sha256(signedPayload, base64_decode(secret)))
     */
    private function signatureOk(Request $request): bool
    {
        if (! config('lipila.webhook.verify_signature', true)) {
            if (app()->isProduction()) {
                Log::error('Lipila webhook: signature verification is DISABLED in production.');
            }
            return true;
        }

        $secret = (string) config('lipila.webhook.secret', '');
        if ($secret === '') {
            Log::error('Lipila webhook: LIPILA_WEBHOOK_SECRET is not set — cannot verify, rejecting.');
            return false;
        }

        // The dashboard shows the secret base64-encoded; the StandardWebhooks
        // libraries take it with a `whsec_` prefix. Accept either spelling so a
        // copy-paste from the docs works.
        $key = base64_decode(preg_replace('/^whsec_/', '', $secret), true);
        if ($key === false || $key === '') {
            Log::error('Lipila webhook: signing secret is not valid base64 — rejecting.');
            return false;
        }

        $id        = (string) $request->header('webhook-id', '');
        $timestamp = (string) $request->header('webhook-timestamp', '');
        $provided  = (string) $request->header('webhook-signature', '');

        if ($id === '' || $timestamp === '' || $provided === '') {
            return false;
        }

        // Replay window. The timestamp is inside the signed payload, so an
        // attacker cannot move it without invalidating the signature — but a
        // captured-and-replayed callback would still verify without this check.
        if (! ctype_digit(ltrim($timestamp, '-'))) {
            return false;
        }
        $tolerance = (int) config('lipila.webhook.tolerance', 300);
        if (abs(time() - (int) $timestamp) > $tolerance) {
            Log::warning('Lipila webhook: timestamp outside tolerance', [
                'timestamp' => $timestamp, 'tolerance' => $tolerance,
            ]);
            return false;
        }

        $expected = 'v1,' . base64_encode(
            hash_hmac('sha256', "{$id}.{$timestamp}.{$request->getContent()}", $key, true)
        );

        // During key rotation Lipila sends both signatures, space-delimited.
        // Compare every candidate in constant time and never short-circuit on the
        // first mismatch in a way that leaks position.
        $matched = false;
        foreach (explode(' ', $provided) as $candidate) {
            if (hash_equals($expected, trim($candidate))) {
                $matched = true;
            }
        }

        return $matched;
    }

    private function ack(): JsonResponse
    {
        return response()->json(['received' => true]);
    }
}
