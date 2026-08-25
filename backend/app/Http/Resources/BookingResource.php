<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'              => $this->id,
            'payment_mode'    => $this->payment_mode ?? 'ESCROW',
            'status'          => $this->status,
            // § CTR-2 — one backend-published customer label; clients render this
            // instead of each maintaining their own status→text map.
            'status_label'    => \App\Support\BookingStatusLabel::for($this->status),
            'payment_status'  => $this->payment_status,
            // Two-party DIRECT settlement — each side independently (null = not yet).
            'provider_marked_paid_at' => $this->provider_marked_paid_at?->toISOString(),
            'customer_marked_paid_at' => $this->customer_marked_paid_at?->toISOString(),
            'agreed_amount'   => $this->agreed_amount !== null ? (float) $this->agreed_amount : null,
            'amount'          => $this->amount !== null ? (float) $this->amount : null,
            'buyer_protection_fee' => (float) ($this->buyer_protection_fee ?? 0),
            // Growth & Promotions: the ZMW the customer saved on this booking.
            // Sebenza absorbed it — the provider payout below is UNAFFECTED.
            'campaign_discount_zmw' => (float) ($this->campaign_discount_zmw ?? 0),
            'promo_code'            => $this->promo_code,
            // ── Outcome-based pricing ────────────────────────────────────────
            // Customer's structured brief + the provider's scoped quote
            // (PROVIDER_SCOPE / QUOTE_DEPOSIT).
            'scope_brief'         => $this->scope_brief,
            // Customer-attached photos/short video for pricing context. Stored on
            // the PRIVATE disk (§ SEC-4) — the client is handed an authorized URL
            // to the party-only streaming route, never a public path.
            'scope_brief_attachments' => collect($this->scope_brief_attachments ?? [])
                ->values()
                ->map(fn ($att, $i) => [
                    'type' => $att['type'] ?? 'image',
                    'url'  => url("/api/bookings/{$this->id}/scope-attachments/{$i}"),
                ])->all(),
            'provider_quote'      => $this->provider_quote,
            // HOURLY_CAPPED — observed timer settlement (server timestamps; the
            // customer sees start + live elapsed + charge, never a self-report).
            'actual_hours_logged' => $this->actual_hours_logged !== null ? (float) $this->actual_hours_logged : null,
            'actual_charge_zmw'   => $this->actual_charge_zmw !== null ? (float) $this->actual_charge_zmw : null,
            'job_started_at'      => $this->job_started_at?->toISOString(),
            'job_ended_at'        => $this->job_ended_at?->toISOString(),
            'observed_minutes'    => $this->observed_minutes !== null ? (int) $this->observed_minutes : null,
            'final_charge_zmw'    => $this->final_charge_zmw !== null ? (float) $this->final_charge_zmw : null,
            'pause_events'        => $this->pause_events ?? [],
            // The cap the customer has approved (original cap + any approved extension)
            // = the held amount. Charge can never exceed this without re-approval.
            'approved_cap_zmw'    => $this->agreed_amount !== null ? (float) $this->agreed_amount : ($this->amount !== null ? (float) $this->amount : null),
            'cap_extension_zmw'   => $this->cap_extension_zmw !== null ? (float) $this->cap_extension_zmw : null,
            'cap_extension_requested_at' => $this->cap_extension_requested_at?->toISOString(),
            'cap_warn_ratio'      => (float) config('booking.hourly.cap_warn_ratio', 0.8),
            // Billing increment observed time rounds UP to (client renders a live
            // estimate that matches the server's settlement; charge stays server-computed).
            'hourly_rounding_mins' => (int) config('booking.hourly.rounding_increment_mins', 30),
            // QUOTE_DEPOSIT two-phase escrow.
            'deposit_amount'      => $this->deposit_amount !== null ? (float) $this->deposit_amount : null,
            'balance_amount'      => $this->balance_amount !== null ? (float) $this->balance_amount : null,
            'escrow_phase'        => $this->escrow_phase,
            'scheduled_start' => $this->scheduled_start?->toISOString(),
            'scheduled_end'   => $this->scheduled_end?->toISOString(),
            'expires_at'      => $this->expires_at?->toISOString(),
            'completed_at'    => $this->completed_at?->toISOString(),
            'payout_eligible_at' => $this->payout_eligible_at?->toISOString(),
            // Auto-confirm deadline while DELIVERED (set by BookingService::findOrFail).
            'auto_release_at' => $this->auto_release_at ?? null,
            // ── Delivery location (privacy-gated) ────────────────────────────
            // Coordinates are used ONLY to launch device maps and are handed out
            // to the PROVIDER, and only once the booking is funded (they must
            // physically arrive). Never to the customer (they placed the pin) —
            // this keeps the "coordinates never shown to the customer" invariant
            // true at the payload level, not just in the client render.
            'delivery_lat'    => $this->coordsVisibleTo($request) ? $this->delivery_lat : null,
            'delivery_lng'    => $this->coordsVisibleTo($request) ? $this->delivery_lng : null,
            // Human-readable label = the fullest delivery address on file. The
            // provider sees it only once funded (§ address-gate); before that,
            // and for the wider region field, only the area/region is exposed.
            'delivery_location_label'  => $this->addressVisibleTo($request)
                ? $this->delivery_location_label
                : null,
            'delivery_location_region' => $this->delivery_location_region,
            // Most recent structured status update — drives the live status banner
            // ("{Provider} is on the way", "…running ~15 min late"). Only present
            // when statusUpdates is eager-loaded (detail view), never an N+1 on
            // list rows. Taken from the ordered collection's tail (no MAX(uuid),
            // which Postgres can't do — hence not a latestOfMany relation).
            'last_update'     => $this->lastUpdateBlock(),
            'notes'           => $this->notes,
            'dispute_reason'  => $this->dispute_reason,
            // Remote (online) service → clients show "Online" instead of an area/distance.
            'is_remote'       => $this->relationLoaded('service') ? (bool) $this->service?->isRemote() : null,
            'service'         => $this->whenLoaded('service', fn () => [
                'id'            => $this->service->id,
                'title'         => $this->service->title,
                'delivery_type' => $this->service->delivery_type ?? 'IN_PERSON',
                'is_remote'     => $this->service->isRemote(),
                'pricing_model' => $this->service->pricing_model,
                'base_price'    => $this->service->base_price,
                'hourly_rate'   => $this->service->hourly_rate !== null ? (float) $this->service->hourly_rate : null,
                'minimum_hours' => $this->service->minimum_hours !== null ? (float) $this->service->minimum_hours : null,
                'cap_hours'     => $this->service->cap_hours !== null ? (float) $this->service->cap_hours : null,
                'cap_amount'    => $this->service->cap_amount !== null ? (float) $this->service->cap_amount : null,
                'deposit_percent' => $this->service->deposit_percent,
                'category_name' => $this->service->category?->name,
                'category_icon' => $this->service->category?->icon_url,
            ]),
            'buyer'           => $this->whenLoaded('buyer', fn () => [
                'id'    => $this->buyer->id,
                // Counterparty email/phone are NOT exposed (§ SEC-5): the provider
                // sees a privacy-safe label + qualitative trust hint only. Direct
                // contact (for DIRECT MoMo) is surfaced elsewhere at the right state.
                'name'       => $this->buyer_label ?? null,
                'trust_hint' => $this->buyer_trust_hint ?? null,
            ]),
            'provider'        => $this->whenLoaded('provider', fn () => [
                'id'           => $this->provider->id,
                'display_name' => $this->provider->providerProfile?->display_name,
                // Public profile photo — never the KYC selfie.
                'avatar_url'   => $this->provider->providerProfile?->avatar_url,
                'trust_tier'   => (int) ($this->provider->providerProfile?->trust_tier ?? 0),
                // Bayesian rating (§7.1) — null until first review; never expose trust_score.
                'rating'       => (int) $this->provider->v_reviews > 0 ? round((float) $this->provider->r_raw, 2) : null,
                'reviews'      => (int) $this->provider->v_reviews,
                // DIRECT mobile-money details — shown ONLY to the buyer on an active,
                // payable booking (never public, never to other parties).
                'payment'      => (
                    $request->user()?->getKey() === $this->buyer_id
                    && ($this->payment_mode ?? 'ESCROW') === 'DIRECT'
                    && in_array($this->status, ['ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED'], true)
                    && $this->provider->providerProfile?->momo_number
                ) ? [
                    'momo_provider' => $this->provider->providerProfile?->momo_provider,
                    'momo_number'   => $this->provider->providerProfile?->momo_number,
                ] : null,
            ]),
            'transactions'    => $this->whenLoaded('transactions', fn () =>
                TransactionResource::collection($this->transactions)
            ),
            // v3 §7.1 — true once the buyer has left a review for this booking.
            'has_review'      => $this->relationLoaded('review')
                ? $this->review !== null
                : $this->review()->exists(),
            'created_at'      => $this->created_at?->toISOString(),
            'updated_at'      => $this->updated_at?->toISOString(),

            // Provider-only earnings breakdown (price − platform fee = net payout).
            // Server-computed from the SAME CommissionService the payout uses, so
            // the figure the provider sees is the figure they'll be paid. Null for
            // the customer and whenever the price/relations aren't available.
            'earnings'        => $this->earningsBlock($request),

            // ── Communication layer + Booking Agreement (drives the thin clients) ─
            // Present only to a party of the booking, and only inside the contact
            // window. Since masked calling was removed this DOES release the
            // counterparty's real number — see commsBlock for the exact gate.
            'comms'           => $this->commsBlock($request),
        ];
    }

    /**
     * Client-facing comms + agreement summary for a booking party. Cheap enough
     * for list rows (no heavy service graph): the preset catalogue and contact
     * window are stateless helpers, and the agreement is a single relation read.
     */
    private function commsBlock(Request $request): ?array
    {
        $user = $request->user();
        if (! $user) {
            return null;
        }

        $uid = $user->getKey();
        if ($uid !== $this->buyer_id && $uid !== $this->provider_id) {
            return null;
        }

        $role = $uid === $this->provider_id ? 'provider' : 'customer';
        $open = \App\Support\ContactWindow::isOpen($this->resource);

        // Latest agreement (versioned document). Loaded eagerly where available,
        // else a single scoped query — never exposes any PII.
        $agreement = $this->relationLoaded('latestAgreement')
            ? $this->latestAgreement
            : $this->agreements()->first();

        return [
            // The counterparty's REAL number, for the client to hand to the OS
            // dialler. Released only inside the funded/active + dispute window;
            // null everywhere else, including to non-parties (guarded above).
            'contact' => $open ? $this->contactBlock($role) : null,
            // Tap-to-send presets for THIS viewer + state (empty when closed).
            'status_update_options' => $open
                ? \App\Support\StatusPresetCatalog::availableFor($this->resource, $role)
                : [],
            'agreement' => $agreement ? [
                'version'      => $agreement->version,
                'generated_at' => $agreement->generated_at?->toISOString(),
                'format'       => $agreement->format,
                'title'        => config('agreements.brand.title'),
                'download_url' => url("/api/bookings/{$this->id}/agreement"),
            ] : null,
        ];
    }

    /**
     * The counterparty's dialable number.
     *
     * This is a DELIBERATE, narrow exception to § SEC-5 ("counterparty phone is
     * not exposed"), introduced when masked calling was removed: a call from an
     * unfamiliar proxy number goes unanswered, so the number has to be real for
     * the call to be answered at all. The exception is bounded three ways —
     * caller must be a party (checked by commsBlock), the booking must be inside
     * the contact window (funded + active, closed after the dispute window), and
     * only the OTHER party's number is ever returned.
     *
     * Returns null unless the relation is already loaded: commsBlock runs on list
     * rows too, and a lazy load here would be an N+1 across the whole list. Detail
     * endpoints load buyer/provider, which is where the number is actually used.
     */
    private function contactBlock(string $role): ?array
    {
        $counterparty = $role === 'provider'
            ? ($this->relationLoaded('buyer')    ? $this->buyer    : null)
            : ($this->relationLoaded('provider') ? $this->provider : null);

        $phone = $counterparty?->phone;
        if (! $phone) {
            return null;
        }

        return [
            'name' => $role === 'provider'
                ? ($this->buyer_label ?? 'Customer')
                : ($counterparty->providerProfile?->display_name ?? 'Provider'),
            'phone' => $phone,
            'role'  => $role === 'provider' ? 'customer' : 'provider',
        ];
    }

    /**
     * The most recent structured status update, from the eager-loaded
     * `statusUpdates` collection (ordered by created_at asc → tail is latest).
     * Null on list rows where the relation isn't loaded.
     */
    private function lastUpdateBlock(): ?array
    {
        if (! $this->relationLoaded('statusUpdates')) {
            return null;
        }

        $u = $this->statusUpdates->last();
        if (! $u) {
            return null;
        }

        return [
            'type'        => $u->type,
            'actor_role'  => $u->actor_role,
            'body'        => $u->body,
            'eta_minutes' => $u->payload['duration_mins'] ?? null,
            'at'          => $u->created_at?->toISOString(),
        ];
    }

    /** Statuses at/after which the customer's payment is custodied. */
    private const FUNDED_STATUSES = [
        'FUNDS_HELD', 'DEPOSIT_HELD', 'IN_PROGRESS', 'DELIVERED',
        'COMPLETED', 'DISBURSED', 'DISPUTED', 'CHARGEBACK_PENDING',
    ];

    /** True when the viewer is the provider on this booking. */
    private function viewerIsProvider(Request $request): bool
    {
        return $request->user()?->getKey() === $this->provider_id;
    }

    /** Coordinates go ONLY to the provider, and only once funded. */
    private function coordsVisibleTo(Request $request): bool
    {
        return $this->viewerIsProvider($request)
            && in_array($this->status, self::FUNDED_STATUSES, true);
    }

    /**
     * The full address label is visible to the customer (their own booking) at
     * all times, and to the provider only once funded (they must arrive). Before
     * funding the provider sees the region field only.
     */
    private function addressVisibleTo(Request $request): bool
    {
        if (! $this->viewerIsProvider($request)) {
            return true; // customer sees the label they placed
        }
        return in_array($this->status, self::FUNDED_STATUSES, true);
    }

    /**
     * Provider-only net-payout preview. Uses CommissionService::calculate — the
     * exact engine the real payout runs through — so "you'll get ZMW X" matches
     * the eventual disbursement. Returns null for the customer, and whenever the
     * price or the relations needed to price it aren't loaded.
     */
    private function earningsBlock(Request $request): ?array
    {
        if (! $this->viewerIsProvider($request)) {
            return null;
        }

        $gross = $this->agreed_amount ?? $this->amount;
        if ($gross === null || (float) $gross <= 0) {
            return null;
        }
        $gross = (float) $gross;

        // Need the service (category) + provider tier to price it. Guard against
        // list rows that didn't eager-load the full graph.
        if (! $this->relationLoaded('service') || $this->service?->category_id === null) {
            return null;
        }

        $isDirect = ($this->payment_mode ?? 'ESCROW') === 'DIRECT';
        $tier     = (int) ($this->provider?->providerProfile?->trust_tier ?? 1);

        try {
            $b = app(\App\Services\CommissionService::class)->calculate(
                gross:      $gross,
                categoryId: (int) $this->service->category_id,
                tier:       $tier,
                providerId: (string) $this->provider_id,
                buyerId:    (string) $this->buyer_id,
            );
        } catch (\Throwable) {
            return null;
        }

        // DIRECT: the provider collects the full amount directly (commission is
        // recorded UNCOLLECTED), so there is no platform deduction shown here.
        $net = $isDirect ? $gross : (float) $b['net_to_provider'];
        $fee = round($gross - $net, 2);

        return [
            'gross'          => round($gross, 2),
            // Everything the platform deducts, as one number the provider can trust.
            'platform_fee'   => max(0.0, $fee),
            'net_payout'     => round($net, 2),
            'commission_rate' => (float) $b['effective_rate'],
            'is_direct'      => $isDirect,
        ];
    }
}
