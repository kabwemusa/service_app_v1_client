<?php

namespace App\Services;

use App\Enums\LegalDocumentType;
use App\Enums\TrustTier;
use App\Events\BookingAgreementReady;
use App\Models\Booking;
use App\Models\BookingAgreement;
use App\Models\ServiceAddon;
use App\Services\Legal\LegalDocumentRepository;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Generates the downloadable Booking Agreement ("Service Confirmation").
 *
 * Built server-side from REAL booking data the moment a booking is confirmed
 * (funds custodied), and RE-generated as a new version on any material change
 * (approved quote, cap extension, reschedule). Prior versions are retained. Each
 * document is immutable and stored on the private disk; both parties download
 * the SAME file.
 *
 * PRIVACY (enforced by buildSnapshot): the snapshot + rendered document contain
 * NO NRC, NO selfie, NO coordinates, NO phone numbers, and NO trust score — only
 * what the brief permits (verified name, tier + verified facts, service, agreed
 * pricing, area label / "Delivered online", escrow terms, ToS reference).
 *
 * ⚠ LEGAL: no unapproved legal claims. The document is named "Booking Agreement"
 * and states what it records — never that it is a "legally binding contract" —
 * pending Zambian counsel sign-off (LEGAL_REVIEW.md).
 */
class BookingAgreementService
{
    public function __construct(
        private readonly LegalDocumentRepository $legal,
        private readonly NotificationDispatcher  $notifications,
    ) {}

    public const REASON_CONFIRMATION  = 'CONFIRMATION';
    public const REASON_QUOTE_APPROVED = 'QUOTE_APPROVED';
    public const REASON_CAP_EXTENSION  = 'CAP_EXTENSION';
    public const REASON_RESCHEDULE      = 'RESCHEDULE';

    /**
     * Generate (or re-generate) the agreement for a confirmed booking. Idempotent:
     * if the current agreed state hashes identically to the latest version, no new
     * document is created. Returns the agreement, or null if it wasn't generated
     * (rendering failure is logged, never fatal to the booking flow).
     */
    public function generate(Booking $booking, string $reason): ?BookingAgreement
    {
        $booking->loadMissing(['service.category', 'service.inclusions', 'buyer', 'provider.providerProfile']);

        $snapshot = $this->buildSnapshot($booking);
        $hash     = hash('sha256', json_encode($snapshot));

        $latest = $booking->agreements()->first();
        if ($latest && $latest->content_hash === $hash) {
            // Nothing material changed — the existing document still reflects the
            // agreed state. No new version.
            return $latest;
        }

        $version = ($latest?->version ?? 0) + 1;
        $format  = config('agreements.renderer', 'dompdf') === 'html' ? 'html' : 'pdf';

        try {
            $binary = $this->render($snapshot, $format);
        } catch (\Throwable $e) {
            Log::error('BookingAgreementService: render failed', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
            return null;
        }

        $disk = config('agreements.disk', 'local');
        $path = trim(config('agreements.path', 'booking_agreements'), '/')
            . "/{$booking->id}/agreement_v{$version}.{$format}";

        Storage::disk($disk)->put($path, $binary);

        $agreement = BookingAgreement::create([
            'booking_id'           => $booking->id,
            'version'              => $version,
            'content_hash'         => $hash,
            'status_snapshot'      => $booking->status,
            'reason'               => $reason,
            'terms_version'        => $snapshot['terms']['version'] ?? null,
            'terms_effective_date' => $snapshot['terms']['effective_date'] ?? null,
            'format'               => $format,
            'document_path'        => $path,
            // snapshot is NOT NULL — must be part of the insert, not a follow-up update.
            'snapshot'             => $snapshot,
        ]);

        // Tell BOTH parties the (same) document is ready to download.
        foreach ([$booking->buyer_id, $booking->provider_id] as $recipient) {
            try {
                $this->notifications->dispatch(new BookingAgreementReady($booking, $recipient, $version));
            } catch (\Throwable $e) {
                Log::warning('BookingAgreementService: notify failed', ['error' => $e->getMessage()]);
            }
        }

        return $agreement;
    }

    /** The current (latest) agreement for a booking, or null. */
    public function latestFor(Booking $booking): ?BookingAgreement
    {
        return $booking->agreements()->first();
    }

    /** Raw document bytes for a stored agreement (for download / WhatsApp). */
    public function bytes(BookingAgreement $agreement): string
    {
        return Storage::disk(config('agreements.disk', 'local'))->get($agreement->document_path);
    }

    /**
     * A short-lived SIGNED URL to the document (openable without an auth header —
     * used by mobile Linking, WhatsApp/Meta media fetch, etc.). The 'signed'
     * middleware rejects tampered/expired links.
     */
    public function signedUrl(BookingAgreement $agreement): string
    {
        return \Illuminate\Support\Facades\URL::temporarySignedRoute(
            'agreements.download',
            now()->addMinutes((int) config('agreements.whatsapp_link_ttl_minutes', 30)),
            ['agreement' => $agreement->id],
        );
    }

    public function mimeFor(BookingAgreement $agreement): string
    {
        return $agreement->format === 'pdf' ? 'application/pdf' : 'text/html';
    }

    public function filenameFor(BookingAgreement $agreement): string
    {
        $ref = strtoupper(substr($agreement->booking_id, 0, 8));
        return "booking-agreement-{$ref}-v{$agreement->version}.{$agreement->format}";
    }

    // ── Snapshot (real data only, no forbidden PII) ──────────────────────────

    private function buildSnapshot(Booking $booking): array
    {
        $service = $booking->service;
        $profile = $booking->provider?->providerProfile;
        $tier    = TrustTier::from((int) ($profile?->trust_tier ?? 0));
        $terms   = $this->legal->current(LegalDocumentType::TERMS_OF_SERVICE);

        return [
            'reference'    => strtoupper(substr($booking->id, 0, 8)),
            'booking_id'   => $booking->id,
            'generated_at' => now()->toIso8601String(),

            'company'  => config('agreements.brand.company'),
            'product'  => config('agreements.brand.product'),
            'title'    => config('agreements.brand.title'),
            'subtitle' => config('agreements.brand.subtitle'),

            // Parties — verified name + tier + verified facts. NO phone, NO NRC,
            // NO trust score.
            'provider' => [
                'name'          => $profile?->display_name ?? 'Provider',
                'tier_label'    => $tier->label(),
                'identity_verified' => $tier->value >= TrustTier::IDENTIFIED->value,
                'verified_facts'    => $this->verifiedFacts($tier),
            ],
            'customer' => [
                'name' => $booking->buyer?->legal_name ?? 'Customer',
            ],

            // The service — title, scope/inclusions, add-ons, scope brief + quote.
            'service' => [
                'title'      => $service?->title,
                'category'   => $service?->category?->name,
                'is_remote'  => (bool) $service?->isRemote(),
                'inclusions' => $service?->relationLoaded('inclusions')
                    ? $service->inclusions->pluck('text')->filter()->values()->all()
                    : [],
                'addons'     => $this->addons($booking),
                'scope_brief'     => $this->scopeBrief($booking),
                'agreed_scope'    => $this->agreedScope($booking),
            ],

            // Pricing — model + the agreed terms.
            'pricing' => $this->pricing($booking, $service),

            // Schedule + place — date/time; area label OR "Delivered online".
            'schedule' => [
                'start' => $booking->scheduled_start?->toIso8601String(),
                'end'   => $booking->scheduled_end?->toIso8601String(),
                'place' => $service?->isRemote()
                    ? config('catalog.online_location_label', 'Delivered online')
                    : ($booking->delivery_location_label ?: $booking->delivery_location_region ?: 'To be confirmed'),
            ],

            // Payment terms.
            'payment' => [
                'currency'        => 'ZMW',
                'escrow_held'     => $this->escrowHeld($booking),
                'protection_fee'  => (float) ($booking->buyer_protection_fee ?? 0),
                'terms_text'      => str_replace(':product', config('agreements.brand.product'), config('agreements.copy.escrow')),
            ],

            // Reference to the accepted Terms of Service (version + effective date).
            'terms' => [
                'version'        => $terms?->version,
                'effective_date' => $terms?->effective_date?->toDateString(),
            ],

            // Fixed framing copy (config-driven, no unapproved legal claims).
            'copy' => [
                'preamble'  => str_replace(':product', config('agreements.brand.product'), config('agreements.copy.preamble')),
                'terms_ref' => strtr(config('agreements.copy.terms_ref'), [
                    ':product'   => config('agreements.brand.product'),
                    ':version'   => $terms?->version ?? '—',
                    ':effective' => $terms?->effective_date?->toDateString() ?? 'on acceptance',
                ]),
                'footer'    => str_replace(':product', config('agreements.brand.product'), config('agreements.copy.footer')),
            ],
        ];
    }

    private function verifiedFacts(TrustTier $tier): array
    {
        $facts = [];
        if ($tier->value >= TrustTier::IDENTIFIED->value) {
            $facts[] = 'Government ID verified';
        }
        if ($tier->value >= TrustTier::VERIFIED->value) {
            $facts[] = 'Background check completed';
        }
        if ($tier->value >= TrustTier::PROFESSIONAL->value) {
            $facts[] = 'Professional credentials verified';
        }
        return $facts;
    }

    private function addons(Booking $booking): array
    {
        $ids = $booking->selected_addon_ids ?? [];
        if (empty($ids)) {
            return [];
        }
        return ServiceAddon::where('service_id', $booking->service_id)
            ->whereIn('id', $ids)
            ->get(['name', 'price'])
            ->map(fn ($a) => ['name' => $a->name, 'price' => (float) $a->price])
            ->all();
    }

    private function scopeBrief(Booking $booking): array
    {
        // Customer's structured brief answers (quote-first models). Text only —
        // attachments (private property photos) are deliberately NOT embedded.
        $brief = $booking->scope_brief ?? [];
        return is_array($brief) ? array_values($brief) : [];
    }

    private function agreedScope(Booking $booking): ?array
    {
        $quote = $booking->provider_quote ?? null;
        if (! is_array($quote)) {
            return null;
        }
        return [
            'inclusions'    => array_values($quote['inclusions'] ?? []),
            'message'       => $quote['message'] ?? null,
            'duration_mins' => $quote['duration_mins'] ?? null,
        ];
    }

    private function pricing(Booking $booking, $service): array
    {
        $model  = $service?->pricing_model ?? 'OUTCOME_FIXED';
        $agreed = (float) ($booking->agreed_amount ?? $booking->amount ?? 0);

        return match ($model) {
            'HOURLY_CAPPED' => [
                'model'   => $model,
                'label'   => 'Hourly, capped',
                'rate'    => (float) ($service->hourly_rate ?? 0),
                'minimum_hours' => (float) ($service->minimum_hours ?? 0),
                'cap'     => $agreed, // approved cap = held amount (incl. any extension)
                'rule'    => 'Charged for the time actually worked, rounded to the provider\'s billing increment. Any unused amount below the cap is refunded on completion. The cap is never exceeded without your approval.',
            ],
            'PROVIDER_SCOPE' => [
                'model' => $model,
                'label' => 'Agreed quote',
                'quote' => $agreed,
                'rule'  => 'The approved quote is the agreed price for the scope above.',
            ],
            'QUOTE_DEPOSIT' => [
                'model'   => $model,
                'label'   => 'Quote with deposit',
                'quote'   => $agreed,
                'deposit' => (float) ($booking->deposit_amount ?? 0),
                'balance' => (float) ($booking->balance_amount ?? 0),
                'rule'    => 'A deposit is held now; the balance is due and collected on completion.',
            ],
            default => [ // OUTCOME_FIXED
                'model' => 'OUTCOME_FIXED',
                'label' => 'Fixed price',
                'price' => $agreed,
                'rule'  => 'The fixed price for the service outcome above.',
            ],
        };
    }

    private function escrowHeld(Booking $booking): float
    {
        $isDeposit = $booking->escrow_phase === 'DEPOSIT' && $booking->deposit_amount !== null;
        $base = $isDeposit
            ? (float) $booking->deposit_amount
            : (float) ($booking->agreed_amount ?? $booking->amount ?? 0);
        return round($base + (float) ($booking->buyer_protection_fee ?? 0), 2);
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    private function render(array $snapshot, string $format): string
    {
        $html = view('agreements.booking', ['a' => $snapshot])->render();

        if ($format === 'html') {
            return $html;
        }

        $dompdf = new \Dompdf\Dompdf([
            'isRemoteEnabled'      => false, // no external fetches — self-contained
            'defaultFont'          => 'DejaVu Sans',
            'chroot'               => storage_path(),
        ]);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();

        return $dompdf->output();
    }
}
