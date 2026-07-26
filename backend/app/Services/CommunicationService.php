<?php

namespace App\Services;

use App\Contracts\MaskedCallProvider;
use App\Enums\ErrorCode;
use App\Events\BookingStatusUpdatePosted;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Models\Booking;
use App\Models\BookingCallSession;
use App\Models\BookingStatusUpdate;
use App\Models\User;
use App\Services\Communication\CallRequest;
use App\Support\StatusPresetCatalog;
use App\Services\Trust\MessageScreeningService;
use App\Support\ContactWindow;
use Illuminate\Support\Facades\Log;

/**
 * Provider ↔ customer communication — the ONE backend implementation behind the
 * app, PWA and WhatsApp (the surfaces are thin). It offers exactly two channels
 * and nothing else: masked calling and structured (preset) status updates. There
 * is NO chat and NO VoIP; free-form conversation deep-links to WhatsApp on the
 * clients, not here.
 *
 * Everything is gated by ContactWindow (funded + active, closed after the dispute
 * window) and every event is immutable evidence that also surfaces in the admin
 * booking timeline.
 */
class CommunicationService
{
    public function __construct(
        private readonly MaskedCallProvider     $caller,
        private readonly NotificationDispatcher $notifications,
        private readonly MessageScreeningService $screening,
        private readonly BookingService         $bookings,
    ) {}

    // ── Structured status updates ────────────────────────────────────────────

    /**
     * The preset status updates this viewer can send RIGHT NOW (role + state).
     * Drives the thin clients so they don't each hard-code the catalogue.
     */
    public function availableStatusPresets(Booking $booking, User $user): array
    {
        if (! $this->isParty($booking, $user)) {
            return [];
        }

        return StatusPresetCatalog::availableFor($booking, $this->roleOf($booking, $user));
    }

    /**
     * Send one preset status update. Returns the fresh booking + the created
     * update (or the delegated lifecycle result for start/finish).
     */
    public function postStatusUpdate(Booking $booking, User $actor, string $type, array $payload = []): array
    {
        if (! $this->isParty($booking, $actor)) {
            throw new ForbiddenException('You are not party to this booking.');
        }
        if (! ContactWindow::isOpen($booking)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Updates are only available on an active, funded booking.');
        }

        $preset = config("communication.status_presets.{$type}");
        if (! $preset) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Unknown status update.');
        }

        $role = $this->roleOf($booking, $actor);
        if (($preset['role'] ?? null) !== $role) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'That update isn\'t available to you.');
        }

        // "Job started" / "Job finished" delegate to the existing lifecycle so the
        // HOURLY_CAPPED observed timer + notifications stay a SINGLE implementation.
        $drives = $preset['drives'] ?? null;
        if ($drives === 'start' || $drives === 'finish') {
            $fresh = $drives === 'start'
                ? $this->bookings->markInProgress($booking->id, $actor)
                : $this->bookings->markDelivered($booking->id, $actor);

            // Record the timeline entry (evidence). The delegated method already
            // notified the other party, so we do NOT send a second ping.
            $update = $this->record($booking, $actor, $role, $type, $payload, $preset['body']);

            return ['booking' => $fresh, 'update' => $update];
        }

        // Payload validation for the free-input presets.
        $body = $preset['body'];

        if (($preset['requires'] ?? null) === 'duration') {
            $mins = (int) ($payload['duration_mins'] ?? 0);
            if (! in_array($mins, config('communication.late_durations', []), true)) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Choose one of the offered delay times.');
            }
            $payload = ['duration_mins' => $mins];
            $body    = str_replace('{mins}', (string) $mins, $body);
        }

        if (($preset['requires'] ?? null) === 'note') {
            $note = trim((string) ($payload['note'] ?? ''));
            $max  = (int) config('communication.note_max_length', 200);
            if ($note === '' || mb_strlen($note) > $max) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, "Add a short note (up to {$max} characters).");
            }

            // Anti-circumvention: this is the ONLY free-text that passes through
            // the platform. Best-effort screen for off-platform contact / MoMo
            // solicitation and flag for the Fraud module. We do NOT block it (we
            // don't claim to prevent circumvention) — we flag and still deliver.
            $signals = $this->screening->screen($note);
            if (! empty($signals)) {
                $this->screening->flag(
                    userId:          $actor->id,
                    counterpartyId:  $this->counterpartyId($booking, $actor),
                    bookingId:       $booking->id,
                    signals:         $signals,
                    redactedContext: 'location_note',
                );
            }

            $payload = ['note' => $note];
            $body    = str_replace('{note}', $note, $body);
        }

        $update = $this->record($booking, $actor, $role, $type, $payload, $body);

        // Real-time ping to the OTHER party across surfaces (app/PWA push + WhatsApp).
        $this->notifications->dispatch(new BookingStatusUpdatePosted(
            booking:  $booking,
            recipient: $this->counterpartyId($booking, $actor),
            updateType: $type,
            bodyText:  $body,
            critical:  (bool) ($preset['time_critical'] ?? false),
        ));

        return ['booking' => $booking->fresh(), 'update' => $update];
    }

    private function record(Booking $booking, User $actor, string $role, string $type, array $payload, string $body): BookingStatusUpdate
    {
        return BookingStatusUpdate::create([
            'booking_id' => $booking->id,
            'actor_id'   => $actor->id,
            'actor_role' => $role,
            'type'       => $type,
            'payload'    => $payload ?: null,
            'body'       => $body,
        ]);
    }

    // ── Masked calling ───────────────────────────────────────────────────────

    /**
     * Place a masked call from the caller to the other party. Returns a
     * client-safe payload — NO real number is ever included in bridge mode
     * (only in the flagged reveal fallback, with an expiry).
     */
    public function initiateCall(Booking $booking, User $caller): array
    {
        if (! $this->isParty($booking, $caller)) {
            throw new ForbiddenException('You are not party to this booking.');
        }
        if (! ContactWindow::isOpen($booking)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Calling is only available on an active, funded booking.');
        }

        $booking->loadMissing(['buyer', 'provider']);
        $role         = $this->roleOf($booking, $caller);
        $counterparty = $role === 'provider' ? $booking->buyer : $booking->provider;

        $callerPhone       = $caller->phone;
        $counterpartyPhone = $counterparty?->phone;
        if (! $callerPhone || ! $counterpartyPhone) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'We can\'t place the call — a phone number is missing on one account.');
        }

        // Double-submit guard: a fresh, non-terminal session by the same caller
        // within a short window is returned as-is instead of dialling again.
        $recent = BookingCallSession::where('booking_id', $booking->id)
            ->where('initiator_id', $caller->id)
            ->whereIn('status', ['INITIATED', 'RINGING', 'IN_PROGRESS'])
            ->where('created_at', '>=', now()->subSeconds(20))
            ->latest()->first();
        if ($recent) {
            return $this->callPayload($recent, null);
        }

        try {
            $result = $this->caller->initiate(new CallRequest(
                bookingId:         $booking->id,
                initiatorRole:     $role,
                initiatorPhone:    $callerPhone,
                counterpartyPhone: $counterpartyPhone,
                ttlMinutes:        (int) config('communication.calling.session_ttl_minutes', 30),
            ));
        } catch (\Throwable $e) {
            Log::warning('CommunicationService: call initiation failed', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'We couldn\'t start the call right now. Please try again shortly.');
        }

        // Persist METADATA only — never the real numbers, never content.
        $session = BookingCallSession::create([
            'booking_id'        => $booking->id,
            'initiator_id'      => $caller->id,
            'initiator_role'    => $role,
            'provider'          => $result->provider,
            'session_ref'       => $result->sessionRef,
            'masked_number'     => $result->maskedNumber,
            'status'            => $result->status,
            'reveal_expires_at' => $result->revealExpiresAt,
            'started_at'        => now(),
            'metadata'          => $result->metadata ?: null,
        ]);

        return $this->callPayload($session, $result->mode === 'reveal' ? $result : null);
    }

    /**
     * Update a call session from the provider's voice webhook (duration/outcome).
     * Metadata only. Unknown sessions are ignored.
     */
    public function recordCallEvent(string $sessionRef, string $status, ?int $durationSeconds = null): void
    {
        $session = BookingCallSession::where('session_ref', $sessionRef)->first();
        if (! $session) {
            return;
        }

        $fields = ['status' => $status];
        if ($durationSeconds !== null) {
            $fields['duration_seconds'] = $durationSeconds;
        }
        if ($status === 'IN_PROGRESS' && ! $session->answered_at) {
            $fields['answered_at'] = now();
        }
        if (in_array($status, ['COMPLETED', 'NO_ANSWER', 'FAILED', 'CANCELLED'], true) && ! $session->ended_at) {
            $fields['ended_at'] = now();
        }

        $session->update($fields);
    }

    // ── Merged communication timeline (admin + booking detail) ───────────────

    /**
     * Chronological, PII-free feed of every communication event on the booking —
     * status updates + masked calls — for dispute resolution / the admin view.
     */
    public function timeline(Booking $booking): array
    {
        $updates = $booking->statusUpdates()->get()->map(fn (BookingStatusUpdate $u) => [
            'kind'       => 'status_update',
            'type'       => $u->type,
            'actor_role' => $u->actor_role,
            'body'       => $u->body,
            'at'         => $u->created_at?->toIso8601String(),
        ]);

        $calls = $booking->callSessions()->get()->map(fn (BookingCallSession $c) => [
            'kind'             => 'call',
            'initiator_role'   => $c->initiator_role,
            'provider'         => $c->provider,
            'status'           => $c->status,
            'duration_seconds' => $c->duration_seconds,
            'at'               => $c->created_at?->toIso8601String(),
            'answered_at'      => $c->answered_at?->toIso8601String(),
            'ended_at'         => $c->ended_at?->toIso8601String(),
        ]);

        return $updates->concat($calls)
            ->sortBy('at')->values()->all();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function isParty(Booking $booking, User $user): bool
    {
        return $booking->buyer_id === $user->id || $booking->provider_id === $user->id;
    }

    private function roleOf(Booking $booking, User $user): string
    {
        return $booking->provider_id === $user->id ? 'provider' : 'customer';
    }

    private function counterpartyId(Booking $booking, User $user): string
    {
        return $booking->provider_id === $user->id ? $booking->buyer_id : $booking->provider_id;
    }

    private function callPayload(BookingCallSession $session, ?\App\Services\Communication\CallResult $reveal): array
    {
        $payload = [
            'session_id'    => $session->id,
            'mode'          => $reveal ? 'reveal' : 'bridge',
            'status'        => $session->status,
            'masked_number' => $session->masked_number, // proxy number only (bridge)
            'message'       => $reveal?->clientMessage ?? 'Connecting your call — you\'ll only ever see our number.',
        ];

        // Flagged fallback ONLY: a real number is exposed for a limited window.
        if ($reveal) {
            $payload['revealed_number']   = $reveal->revealedNumber;
            $payload['reveal_expires_at'] = $reveal->revealExpiresAt?->format(\DateTimeInterface::ATOM);
        }

        return $payload;
    }
}
