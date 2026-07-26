<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConversationState;
use App\Models\ProcessedMessage;
use App\Models\User;
use App\Models\WhatsAppWebhookLog;
use App\Services\WhatsApp\ConversationEngine;
use App\Services\WhatsApp\WebhookParser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class WhatsAppWebhookController extends Controller
{
    public function __construct(
        private readonly ConversationEngine $engine,
    ) {}

    /**
     * GET /webhook — Meta verify handshake.
     */
    public function verify(Request $request): Response
    {
        $mode      = $request->query('hub_mode');
        $token     = $request->query('hub_verify_token');
        $challenge = $request->query('hub_challenge');

        if ($mode === 'subscribe' && $token === config('whatsapp.verify_token')) {
            Log::info('WhatsApp webhook verified');
            return response($challenge, 200)->header('Content-Type', 'text/plain');
        }

        Log::warning('WhatsApp webhook verification failed', compact('mode', 'token'));
        return response('Forbidden', 403);
    }

    /**
     * POST /webhook — receive inbound messages.
     * Validates X-Hub-Signature-256, ACKs 200 immediately, processes async.
     */
    public function receive(Request $request): JsonResponse
    {
        if (! $this->validateSignature($request)) {
            Log::warning('WhatsApp webhook: invalid signature');
            return response()->json(['error' => 'Invalid signature'], 403);
        }

        $payload = $request->all();

        // Process synchronously — reliable on all server types.
        // ACK to Meta may be slightly delayed but well within the 20s timeout.
        try {
            $this->processWebhook($payload);
        } catch (\Throwable $e) {
            Log::error('WhatsApp webhook processing failed', ['error' => $e->getMessage()]);
        }

        return response()->json(['status' => 'ok']);
    }

    private function processWebhook(array $payload): void
    {
        $parsed = WebhookParser::parse($payload);

        if (! $parsed) {
            $this->logWebhook(null, null, 'unparseable', null, 'failed', 'Payload did not match a known shape.');
            return;
        }

        if (($parsed['type'] ?? '') === 'status') {
            // Delivery-status callback (sent/delivered/read/failed) — not a
            // conversation event, but worth recording for the Ops "delivery
            // health" view. No behavior change: still returns immediately.
            foreach (($parsed['statuses'] ?? []) as $status) {
                $this->logWebhook(
                    $status['id'] ?? null,
                    $status['recipient_id'] ?? null,
                    'status',
                    $status['status'] ?? null,
                    'processed',
                );
            }
            return;
        }

        $messageId = $parsed['message_id'] ?? null;

        if ($messageId && ! $this->dedup($messageId)) {
            Log::debug('WhatsApp webhook: duplicate message', ['id' => $messageId]);
            $this->logWebhook($messageId, $parsed['from'] ?? null, 'message', $parsed['type'] ?? null, 'duplicate');
            return;
        }

        $from = $parsed['from'] ?? null;
        if (! $from) return;

        $conversation = $this->resolveConversation($from, $parsed);

        $conversation->update(['last_inbound_at' => now()]);

        // ADM-3: a ban/suspension must cover the WhatsApp channel too — the HTTP
        // guard (EnsureAccountActive) doesn't run here. A restricted user's inbound
        // messages are not processed at all (the booking choke-point already
        // blocks the money action; this blocks the whole conversation).
        if ($this->isRestricted($conversation)) {
            Log::info('WhatsApp: dropping inbound from a restricted account', [
                'wa' => $from, 'user_id' => $conversation->user_id,
            ]);
            $this->logWebhook($messageId, $from, 'message', $parsed['type'] ?? null, 'blocked');
            return;
        }

        try {
            if ($conversation->state === 'DISPATCHING' && ($conversation->getContextValue('role') === 'provider')) {
                $this->engine->handleProviderResponse($parsed, $conversation);
            } else {
                $this->engine->handle($parsed, $conversation);
            }
            $this->logWebhook($messageId, $from, 'message', $parsed['type'] ?? null, 'processed');
        } catch (\Throwable $e) {
            Log::error('ConversationEngine error', [
                'wa'    => $from,
                'state' => $conversation->state,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            $this->logWebhook($messageId, $from, 'message', $parsed['type'] ?? null, 'failed', $e->getMessage());
            $this->recordProcessingFailure();
        }
    }

    /**
     * § ERR-3 — a single bad deploy can silently kill the WhatsApp channel because
     * every processing error is (correctly) caught and 200-ACKed to Meta. Count
     * failures in a rolling one-minute window and raise a loud alert log when they
     * cross a threshold, so monitoring can page on it instead of the channel dying
     * quietly.
     */
    private function recordProcessingFailure(): void
    {
        try {
            $window = now()->format('YmdHi'); // per-minute bucket
            $key    = "wa_webhook_failures:{$window}";
            $count  = (int) \Illuminate\Support\Facades\Cache::increment($key);
            if ($count === 1) {
                \Illuminate\Support\Facades\Cache::put($key, 1, now()->addMinutes(2));
            }

            $threshold = (int) config('whatsapp.failure_alert_threshold', 10);
            if ($count === $threshold) {
                Log::critical('WhatsApp webhook: processing failure rate threshold crossed', [
                    'window' => $window, 'failures' => $count, 'threshold' => $threshold,
                ]);
            }
        } catch (\Throwable $e) {
            // Never let the alarm itself break the ACK path.
        }
    }

    /**
     * Passive observability only — never throws, never affects delivery.
     * Backs the admin WhatsApp Ops module's Conversations/Logs tabs.
     */
    private function logWebhook(
        ?string $messageId,
        ?string $fromNumber,
        string $kind,
        ?string $type,
        string $processingStatus,
        ?string $error = null,
    ): void {
        try {
            WhatsAppWebhookLog::create([
                'message_id'        => $messageId,
                'from_number'       => $fromNumber,
                'kind'              => $kind,
                'type'              => $type,
                'processing_status' => $processingStatus,
                'error'             => $error,
                'created_at'        => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('WhatsAppWebhookLog: failed to persist', ['error' => $e->getMessage()]);
        }
    }

    private function validateSignature(Request $request): bool
    {
        $secret = config('whatsapp.app_secret');

        if (! $secret) {
            // Fail CLOSED in production: without the app secret we cannot prove a
            // request came from Meta, and inbound messages drive real bookings.
            // Only skip the check outside production (local/sandbox convenience).
            if (app()->isProduction()) {
                Log::error('WhatsApp webhook: WHATSAPP_APP_SECRET not configured in production — rejecting.');
                return false;
            }
            Log::warning('WhatsApp webhook: WHATSAPP_APP_SECRET not configured, skipping validation (non-production).');
            return true;
        }

        $signature = $request->header('X-Hub-Signature-256');

        if (! $signature) return false;

        $expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), $secret);

        return hash_equals($expected, $signature);
    }

    private function dedup(string $messageId): bool
    {
        return ProcessedMessage::firstOrCreate(
            ['message_id' => $messageId],
            ['processed_at' => now()],
        )->wasRecentlyCreated;
    }

    /**
     * True when the conversation's bound account is banned, or suspended and the
     * suspension has not yet expired. (An expired suspension is treated as active
     * — it will auto-lift on the account's next HTTP request; here we simply let
     * the conversation proceed.)
     */
    private function isRestricted(ConversationState $conversation): bool
    {
        if (! $conversation->user_id) {
            return false;
        }
        $user = User::find($conversation->user_id);
        if (! $user) {
            return false;
        }
        if ($user->account_state === 'BANNED') {
            return true;
        }
        if ($user->account_state === 'SUSPENDED') {
            return $user->suspended_until === null || ! $user->suspended_until->isPast();
        }
        return false;
    }

    private function resolveConversation(string $whatsappId, array $parsed): ConversationState
    {
        $conversation = ConversationState::firstOrCreate(
            ['whatsapp_id' => $whatsappId],
            [
                'state'   => 'MENU',
                'context' => [],
            ],
        );

        if (! $conversation->user_id) {
            // WhatsApp ids are the full international number without '+', so the
            // canonical E.164 is simply '+' prefixed. Match strictly (§ SEC-8):
            // a trailing-digits LIKE could bind this conversation (and its
            // bookings) to a different subscriber sharing the last nine digits.
            $phone = \App\Support\PhoneNumber::normalize($whatsappId) ?? ('+' . $whatsappId);
            $user = User::where('phone', $phone)->first();

            if (! $user) {
                $contactName = $parsed['sender_name'] ?? null;
                $user = User::create([
                    'phone'             => $phone,
                    'email'             => $whatsappId . '@wa.sebenza.zm',
                    'legal_name'        => $contactName ?? 'WhatsApp User',
                    'role'              => 'CUSTOMER',
                    'account_state'     => 'ACTIVE',
                    'password_hash'     => Hash::make(Str::random(32)),
                    'phone_verified_at' => now(),
                ]);
                Log::info('WhatsApp: auto-created user account', ['phone' => $phone, 'user_id' => $user->id]);
            }

            $conversation->user_id = $user->id;
            $conversation->save();
        }

        return $conversation;
    }
}
