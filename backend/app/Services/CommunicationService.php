<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Events\BookingStatusUpdatePosted;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Models\Booking;
use App\Models\BookingStatusUpdate;
use App\Models\User;
use App\Support\ContactWindow;
use App\Support\StatusPresetCatalog;

/**
 * Provider ↔ customer communication — the ONE backend implementation behind the
 * app, PWA and WhatsApp (the surfaces are thin). It offers exactly ONE channel:
 * structured, tap-to-send status updates. There is NO chat, NO VoIP and NO
 * masked calling; the parties dial each other directly (the number is released
 * by BookingResource inside the same contact window), and free-form conversation
 * deep-links to WhatsApp on the clients, not here.
 *
 * Everything is gated by ContactWindow (funded + active, closed after the dispute
 * window) and every update is immutable evidence that also surfaces in the admin
 * booking timeline — that evidence trail is the whole reason presets exist rather
 * than leaving coordination entirely off-platform.
 */
class CommunicationService
{
    public function __construct(
        private readonly NotificationDispatcher $notifications,
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

        // Payload validation for the one preset that carries a parameter.
        $body = $preset['body'];

        if (($preset['requires'] ?? null) === 'duration') {
            $mins = (int) ($payload['duration_mins'] ?? 0);
            if (! in_array($mins, config('communication.late_durations', []), true)) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Choose one of the offered delay times.');
            }
            $payload = ['duration_mins' => $mins];
            $body    = str_replace('{mins}', (string) $mins, $body);
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

    // ── Communication timeline (admin + booking detail) ──────────────────────

    /**
     * Chronological, PII-free feed of the booking's status updates, for dispute
     * resolution / the admin view.
     *
     * Calls no longer appear here. The platform stopped proxying voice in favour
     * of direct dialling, so it has no visibility into whether a call happened —
     * and recording a "call" row we cannot verify would be worse than recording
     * nothing. What the parties CLAIM (on my way / arrived) is still evidence.
     */
    public function timeline(Booking $booking): array
    {
        return $booking->statusUpdates()->get()->map(fn (BookingStatusUpdate $u) => [
            'kind'       => 'status_update',
            'type'       => $u->type,
            'actor_role' => $u->actor_role,
            'body'       => $u->body,
            'at'         => $u->created_at?->toIso8601String(),
        ])->sortBy('at')->values()->all();
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
}
