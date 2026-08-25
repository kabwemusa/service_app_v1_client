<?php

namespace App\Services;

use App\Exceptions\Api\NotFoundException;
use App\Models\Booking;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Bookings module (UI: admin/src/components/bookings).
 *
 * Read-only for now — a view of escrow state, payment status, and dispute
 * history, matching the module's original stub description. Manual state
 * overrides (force-complete, force-refund, etc.) touch the live booking
 * state machine (BookingService) and are deliberately NOT added here without
 * an explicit ask, same caution applied to the Finance module.
 */
class AdminBookingService
{
    public function list(array $filters): array
    {
        $query = DB::table('bookings as b')
            ->leftJoin('users as buyer', 'buyer.id', '=', 'b.buyer_id')
            ->leftJoin('users as prov', 'prov.id', '=', 'b.provider_id')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'b.provider_id')
            ->leftJoin('services as s', 's.id', '=', 'b.service_id')
            ->leftJoin('disputes as d', 'd.booking_id', '=', 'b.id')
            ->select([
                'b.id', 'b.status', 'b.payment_mode', 'b.payment_status',
                'b.amount', 'b.agreed_amount', 'b.scheduled_start', 'b.created_at',
                's.title as service_title',
                'buyer.legal_name as buyer_name', 'buyer.email as buyer_email',
                'pp.display_name as provider_name', 'prov.legal_name as provider_legal_name',
                'd.status as dispute_status',
            ]);

        if (!empty($filters['search'])) {
            $search = $filters['search'];
            $term   = '%' . $search . '%';
            // b.id is a UUID column — comparing it against a non-UUID string
            // throws in Postgres (unlike the ILIKE text columns above), so
            // only add that clause when the search term is actually shaped
            // like a UUID.
            $isUuid = (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $search);

            $query->where(function ($w) use ($term, $search, $isUuid) {
                $w->where('buyer.legal_name', 'ilike', $term)
                  ->orWhere('buyer.email', 'ilike', $term)
                  ->orWhere('pp.display_name', 'ilike', $term)
                  ->orWhere('prov.legal_name', 'ilike', $term)
                  ->orWhere('s.title', 'ilike', $term);
                if ($isUuid) {
                    $w->orWhere('b.id', '=', $search);
                }
            });
        }
        if (!empty($filters['status'])) {
            $query->where('b.status', $filters['status']);
        }
        if (!empty($filters['payment_mode'])) {
            $query->where('b.payment_mode', $filters['payment_mode']);
        }
        if (!empty($filters['disputed'])) {
            $query->whereIn('d.status', ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE']);
        }
        if (!empty($filters['date_from'])) {
            $query->where('b.created_at', '>=', $filters['date_from']);
        }

        $query->orderByDesc('b.created_at');

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn ($r) => [
                'id'              => $r->id,
                'service_title'   => $r->service_title ?? 'Service',
                'buyer_name'      => $r->buyer_name ?? $r->buyer_email ?? 'Customer',
                'provider_name'   => $r->provider_name ?? $r->provider_legal_name ?? 'Provider',
                'status'          => $r->status,
                'payment_mode'    => $r->payment_mode,
                'payment_status'  => $r->payment_status,
                'amount'          => (float) ($r->agreed_amount ?? $r->amount ?? 0),
                'scheduled_start' => $this->iso($r->scheduled_start),
                'disputed'        => in_array($r->dispute_status, ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'], true),
                'created_at'      => $this->iso($r->created_at),
            ])->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    public function detail(string $bookingId): array
    {
        $booking = Booking::with([
            'buyer', 'provider.providerProfile', 'service.category', 'commission', 'dispute', 'review',
            'statusUpdates', 'agreements',
        ])->find($bookingId);

        if (!$booking) {
            throw new NotFoundException('Booking');
        }

        $paymentEvents = DB::table('payment_events')
            ->where('booking_id', $booking->id)
            ->orderByDesc('created_at')
            ->get(['id', 'external_ref', 'type', 'provider_status', 'mno', 'amount', 'created_at']);

        return [
            'id'             => $booking->id,
            'status'         => $booking->status,
            'payment_mode'   => $booking->payment_mode,
            'payment_status' => $booking->payment_status,
            'amount'         => (float) ($booking->agreed_amount ?? $booking->amount ?? 0),
            'quoted_amount'  => $booking->quoted_amount !== null ? (float) $booking->quoted_amount : null,
            'buyer_protection_fee' => (float) ($booking->buyer_protection_fee ?? 0),

            'buyer' => $booking->buyer ? [
                'id'    => $booking->buyer->id,
                'name'  => $booking->buyer->legal_name ?? $booking->buyer->email,
                'phone_masked' => $this->maskPhone($booking->buyer->phone),
            ] : null,
            'provider' => $booking->provider ? [
                'id'    => $booking->provider->id,
                'name'  => $booking->provider->providerProfile?->display_name ?? $booking->provider->legal_name,
                'momo_masked' => $this->maskMomo($booking->provider->providerProfile?->momo_number),
            ] : null,
            'service' => $booking->service ? [
                'id'            => $booking->service->id,
                'title'         => $booking->service->title,
                'category_name' => $booking->service->category?->name,
            ] : null,

            'delivery_location_label' => $booking->delivery_location_label,
            'delivery_location_region' => $booking->delivery_location_region,
            // Remote (online) services carry no location — show "Online" in the panel.
            'is_remote'               => (bool) $booking->service?->isRemote(),

            'timeline' => [
                'created_at'               => $this->iso($booking->created_at),
                'scheduled_start'          => $this->iso($booking->scheduled_start),
                'scheduled_end'            => $this->iso($booking->scheduled_end),
                'payment_marked_at'        => $this->iso($booking->payment_marked_at),
                'provider_marked_paid_at'  => $this->iso($booking->provider_marked_paid_at),
                'customer_marked_paid_at'  => $this->iso($booking->customer_marked_paid_at),
                'payout_eligible_at'       => $this->iso($booking->payout_eligible_at),
                'completed_at'             => $this->iso($booking->completed_at),
                'disbursed_at'             => $this->iso($booking->disbursed_at),
                'expires_at'               => $this->iso($booking->expires_at),
            ],

            // HOURLY_CAPPED observed timer — an auditable record for disputes:
            // the actual server start/finish timestamps and any pauses, not
            // conflicting claims about how long the job took.
            'observed_timer' => $booking->service?->pricing_model === 'HOURLY_CAPPED' ? [
                'job_started_at'   => $this->iso($booking->job_started_at),
                'job_ended_at'     => $this->iso($booking->job_ended_at),
                'observed_minutes' => $booking->observed_minutes !== null ? (int) $booking->observed_minutes : null,
                'final_charge_zmw' => $booking->final_charge_zmw !== null ? (float) $booking->final_charge_zmw : null,
                'approved_cap_zmw' => (float) ($booking->agreed_amount ?? $booking->amount ?? 0),
                'cap_extension_zmw' => $booking->cap_extension_zmw !== null ? (float) $booking->cap_extension_zmw : null,
                'pause_events'     => $booking->pause_events ?? [],
            ] : null,

            'commission' => $booking->commission ? [
                'gross_amount'      => (float) $booking->commission->gross_amount,
                'commission_rate'   => (float) $booking->commission->commission_rate,
                'commission_amount' => (float) $booking->commission->commission_amount,
                'net_to_provider'   => (float) $booking->commission->net_to_provider,
                'collection_status' => $booking->commission->collection_status,
            ] : null,

            'dispute' => $booking->dispute ? [
                'id'               => $booking->dispute->id,
                'status'           => $booking->dispute->status,
                'reason_category'  => $booking->dispute->reason_category,
                'refund_amount'    => $booking->dispute->refund_amount,
                'opened_at'        => $this->iso($booking->dispute->opened_at),
                'resolved_at'      => $this->iso($booking->dispute->resolved_at),
            ] : null,

            'review' => $booking->review ? [
                'rating'  => (float) $booking->review->rating,
                'removed' => $booking->review->removed_at !== null,
            ] : null,

            // Communication layer — masked calls + structured status updates, in
            // one chronological feed for dispute resolution. PII-free: no phone
            // numbers, no call content (calls log metadata only).
            'communication_timeline' => $booking->statusUpdates->map(fn ($u) => [
                'kind'       => 'status_update',
                'type'       => $u->type,
                'actor_role' => $u->actor_role,
                'body'       => $u->body,
                'at'         => $this->iso($u->created_at),
            ])->sortBy('at')->values()->all(),

            // Booking Agreement versions (metadata only — the document itself is
            // party-only, downloaded via the authenticated booking routes).
            'agreements' => $booking->agreements->map(fn ($a) => [
                'version'      => $a->version,
                'reason'       => $a->reason,
                'format'       => $a->format,
                'generated_at' => $this->iso($a->generated_at),
                'terms_version' => $a->terms_version,
            ])->values()->all(),

            'escrow_events' => $paymentEvents->map(fn ($e) => [
                'id'             => $e->id,
                'external_ref'   => $e->external_ref,
                'type'           => $e->type,
                'provider_status' => $e->provider_status,
                'mno'            => $e->mno,
                'amount'         => $e->amount !== null ? (float) $e->amount : null,
                'created_at'     => $this->iso($e->created_at),
            ])->all(),
        ];
    }

    private function maskPhone(?string $phone): ?string
    {
        if (!$phone) return null;
        return '••• ••• ' . mb_substr($phone, -3);
    }

    private function maskMomo(?string $momo): ?string
    {
        if (!$momo) return null;
        return '••• ••• ' . mb_substr($momo, -3);
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : Carbon::parse($value)->toIso8601String();
    }
}
