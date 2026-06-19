<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Events\ListingModerated;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\Service;
use App\Models\ServicePhoto;
use App\Services\NotificationDispatcher;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Services moderation module
 * (UI: admin/src/components/services).
 *
 * It reviews provider service listings for quality + policy. It maps `services`
 * (+ categories, provider_profiles, service_photos, listing_review_flags,
 * bookings) into the shapes the panel consumes, and runs EVERY moderation action
 * through AuditedMutationService so each writes an audit entry in one transaction.
 *
 * SCOPE (what this consumes, never invents — v3.1 §5 / impl_v3 §5.3, §8.1, §10.3):
 *   - §5 status lifecycle: DRAFT / ACTIVE / PAUSED / HIDDEN.
 *   - §5.3 image-pipeline RESULTS on service_photos (nsfw_score / phash duplicate
 *     / exif_stripped) — read-only; the pipeline engine itself is out of scope.
 *   - listing_review_flags (v3.2 §1.7) — the canonical flag store written by the
 *     upstream pipeline / report systems (NSFW, duplicate, user reports, lowball,
 *     prohibited content).
 *   - §8.1 commission bands live on the category; a service whose category has no
 *     valid band is a catalogue-integrity flag.
 *   - §10.3 CONTACT-IN-LISTING — phone / external handles in the PUBLIC title or
 *     description. DIRECT mode (§10.3 relaxed): paying directly is the model now;
 *     the concern is publishing direct contact to bypass the recorded booking
 *     flow, so we flag public contact details, not the act of paying directly.
 *
 * Provider-level action (suspend / ban) is NOT duplicated here — the panel links
 * out to the Users module. Hiding a service never touches bookings that reference
 * it (in-flight bookings keep their own snapshot); the panel surfaces an advisory.
 */
class AdminServiceModerationService
{
    /** §8.1 valid commission band keys (mirror of categories.ts COMMISSION_BANDS). */
    private const VALID_BANDS = ['standard', 'micro', 'skilled', 'professional', 'high_risk'];

    /** Audit actions that count as a moderation state change (for "latest reason"). */
    private const MODERATION_ACTIONS = [
        'service.hide', 'service.require_changes', 'service.restore',
        'service.reassign_category', 'service.remove_photo',
    ];

    /** Booking statuses that are still in-flight (must never be orphaned by a hide). */
    private const TERMINAL_BOOKING_STATES = ['COMPLETED', 'DISBURSED', 'CANCELLED'];

    /** NSFW classifier confidence at/above which a photo is treated as flagged. */
    private const NSFW_THRESHOLD = 0.70;

    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly NotificationDispatcher $notifications,
    ) {}

    // ── List ─────────────────────────────────────────────────────────────────────

    public function list(array $filters): array
    {
        $tab = $filters['tab'] ?? 'needs_review';

        $query = DB::table('services as s')
            ->leftJoin('categories as c', 'c.id', '=', 's.category_id')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 's.provider_id')
            ->leftJoin('users as u', 'u.id', '=', 's.provider_id')
            ->select([
                's.id', 's.title', 's.description', 's.status', 's.pricing_model',
                's.base_price', 's.category_id', 's.provider_id', 's.created_at',
                'c.name as category_name', 'c.commission_band',
                'pp.display_name as provider_name', 'u.legal_name as provider_legal_name',
                'u.email as provider_email',
            ])
            // Cast EXISTS to int (PDO_pgsql may return booleans as 't'/'f' strings).
            ->selectRaw('(' . $this->openFlagExists() . ')::int as has_open_flag')
            ->selectRaw('(' . $this->flaggedPhotoExists() . ')::int as has_flagged_photo');

        // ── Search (title / provider name) ──
        if (!empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function ($w) use ($term) {
                $w->where('s.title', 'ilike', $term)
                  ->orWhere('pp.display_name', 'ilike', $term)
                  ->orWhere('u.legal_name', 'ilike', $term);
            });
        }

        // ── Spot-check filters (mostly the "All services" tab) ──
        if (!empty($filters['status'])) {
            $query->where('s.status', $filters['status']);
        }
        if (!empty($filters['category_id'])) {
            $query->where('s.category_id', (int) $filters['category_id']);
        }
        if (!empty($filters['provider'])) {
            $query->where('s.provider_id', $filters['provider']);
        }
        if (($filters['price_min'] ?? '') !== '') {
            $query->where('s.base_price', '>=', (float) $filters['price_min']);
        }
        if (($filters['price_max'] ?? '') !== '') {
            $query->where('s.base_price', '<=', (float) $filters['price_max']);
        }

        // ── "Needs review" gate: any flag source fires ──
        if ($tab === 'needs_review') {
            $query->where(function ($w) {
                // EXISTS(...) and the predicates are already boolean expressions.
                $w->whereRaw($this->openFlagExists())
                  ->orWhereRaw($this->flaggedPhotoExists())
                  ->orWhereRaw($this->bandlessPredicate())
                  ->orWhereRaw($this->contactPredicate('s'));
            });
            // Oldest-flagged first — longest-waiting listings surface at the top.
            $query->orderBy('s.created_at');
        } else {
            $query->orderByDesc('s.created_at');
        }

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn ($row) => $this->presentRow($row))->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    private function presentRow(object $row): array
    {
        $flags = $this->rowFlags($row);

        return [
            'id'             => $row->id,
            'title'          => $row->title,
            'status'         => $row->status,
            'pricing_model'  => $row->pricing_model,
            'base_price'     => $row->base_price !== null ? (float) $row->base_price : null,
            'category'       => $row->category_id ? [
                'id'             => (int) $row->category_id,
                'name'           => $row->category_name,
                'commission_band'=> $row->commission_band,
            ] : null,
            'provider'       => [
                'id'   => $row->provider_id,
                'name' => $this->providerName($row->provider_name, $row->provider_legal_name, $row->provider_email),
            ],
            'flags'          => $flags,
            'created_at'     => $this->iso($row->created_at),
        ];
    }

    // ── Detail ───────────────────────────────────────────────────────────────────

    public function detail(Service $service): array
    {
        $service->loadMissing(['category', 'provider.providerProfile', 'inclusions', 'addons', 'photos']);

        $category = $service->category;
        $bandValid = $category && in_array($category->commission_band, self::VALID_BANDS, true);

        $inFlight = (int) DB::table('bookings')
            ->where('service_id', $service->id)
            ->whereNotIn('status', self::TERMINAL_BOOKING_STATES)
            ->count();

        $flags = $this->serviceFlags($service, $category);

        return [
            'id'             => $service->id,
            'title'          => $service->title,
            'description'    => $service->description,
            'status'         => $service->status,
            'pricing_model'  => $service->pricing_model,
            'base_price'     => $service->base_price !== null ? (float) $service->base_price : null,
            'duration_estimate_mins' => $service->duration_estimate_mins,
            'created_at'     => $this->iso($service->created_at),

            // Reason for the current taken-down / require-changes state (audit log
            // is the source of truth — mirrors the Users module pattern).
            'moderation_reason' => in_array($service->status, ['HIDDEN', 'DRAFT'], true)
                ? $this->latestModerationReason($service->id)
                : null,

            // ── Listing as customers see it ──
            'inclusions' => $service->inclusions->pluck('text')->values()->all(),
            'addons'     => $service->addons->map(fn ($a) => [
                'id' => $a->id, 'name' => $a->name, 'price' => (float) $a->price,
            ])->values()->all(),
            'photos'     => $service->photos->map(fn ($p) => $this->presentPhoto($p))->all(),

            // ── Owner (links to the Users record) ──
            'provider' => $this->providerSummary($service),

            // ── Category + §8.1 commission-band status ──
            'category' => $category ? [
                'id'              => (int) $category->id,
                'name'            => $category->name,
                'commission_band' => $category->commission_band,
                'band_valid'      => $bandValid,
            ] : null,

            // ── Policy + flag surfacing ──
            'flags' => $flags,

            // ── Bookings advisory (hiding must never orphan in-flight bookings) ──
            'in_flight_bookings' => $inFlight,
        ];
    }

    private function providerSummary(Service $service): array
    {
        $provider = $service->provider;
        $profile  = $provider?->providerProfile;

        return [
            'id'            => $service->provider_id,
            'name'          => $this->providerName($profile?->display_name, $provider?->legal_name, $provider?->email),
            'avatar_url'    => $profile?->avatar_url,
            'trust_tier'    => (int) ($profile?->trust_tier ?? 0),
            'account_state' => $provider?->account_state ?? 'ACTIVE',
            'rating'        => $provider && $provider->v_reviews > 0 ? round((float) $provider->r_raw, 2) : null,
            'reviews_count' => (int) ($provider?->v_reviews ?? 0),
            // open safety reports against the OWNER — repeated/severe violations
            // escalate to the Users module, not here.
            'open_reports'  => (int) DB::table('safety_reports')
                ->where('reported_id', $service->provider_id)
                ->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
                ->count(),
        ];
    }

    private function presentPhoto(ServicePhoto $photo): array
    {
        // Per-photo §5.3 pipeline verdict (read-only — system advises, moderator decides).
        $issues = [];
        if ($photo->nsfw_score !== null && (float) $photo->nsfw_score >= self::NSFW_THRESHOLD) {
            $issues[] = 'NSFW';
        }
        if (!empty($photo->duplicate_of_service_id)) {
            $issues[] = 'DUPLICATE';
        }
        if ($photo->exif_stripped === false) {
            $issues[] = 'EXIF';
        }

        return [
            'id'              => $photo->id,
            'path'            => $photo->path,
            'pipeline_status' => $photo->pipeline_status ?? 'PENDING',
            'nsfw_score'      => $photo->nsfw_score !== null ? round((float) $photo->nsfw_score, 3) : null,
            'duplicate_of'    => $photo->duplicate_of_service_id,
            'exif_stripped'   => $photo->exif_stripped !== false,
            'issues'          => $issues,
        ];
    }

    // ── Flag derivation ──────────────────────────────────────────────────────────

    /** Compose the flag list for a fully-loaded detail Service. */
    private function serviceFlags(Service $service, $category): array
    {
        $flags = [];

        // Upstream-written flags (pipeline / reports / lowball / prohibited).
        foreach (DB::table('listing_review_flags')->where('service_id', $service->id)->where('status', 'OPEN')->get() as $f) {
            $flags[] = ['reason' => $f->reason, 'source' => 'flag', 'detail' => $this->flagDetail($f)];
        }

        // §5.3 pipeline verdicts derived from this service's photos.
        foreach ($service->photos as $p) {
            if ($p->nsfw_score !== null && (float) $p->nsfw_score >= self::NSFW_THRESHOLD) {
                $flags[] = ['reason' => 'NSFW_IMAGE', 'source' => 'pipeline', 'detail' => 'Photo #' . $p->id . ' scored ' . round((float) $p->nsfw_score, 2)];
            }
            if (!empty($p->duplicate_of_service_id)) {
                $flags[] = ['reason' => 'DUPLICATE_IMAGE', 'source' => 'pipeline', 'detail' => 'Photo #' . $p->id . ' matches another listing'];
            }
            if ($p->exif_stripped === false) {
                $flags[] = ['reason' => 'EXIF_SUSPICIOUS', 'source' => 'pipeline', 'detail' => 'Photo #' . $p->id . ' retained EXIF metadata'];
            }
        }

        // Computed: §10.3 contact-in-listing.
        $contact = $this->detectContact($service->title . ' ' . ($service->description ?? ''));
        if ($contact !== null) {
            $flags[] = ['reason' => 'CONTACT_IN_LISTING', 'source' => 'policy', 'detail' => $contact];
        }

        // Computed: §8.1 catalogue integrity.
        if (!$category || !in_array($category->commission_band, self::VALID_BANDS, true)) {
            $flags[] = ['reason' => 'BANDLESS_CATEGORY', 'source' => 'catalogue', 'detail' => $category ? 'Category has no valid §8.1 commission band' : 'Service has no category'];
        }

        return $flags;
    }

    /** Lightweight flag list for a list row (uses pre-selected boolean columns). */
    private function rowFlags(object $row): array
    {
        $flags = [];

        if ((int) $row->has_open_flag === 1) {
            // Surface the most relevant open-flag reason(s) for the row.
            foreach (DB::table('listing_review_flags')->where('service_id', $row->id)->where('status', 'OPEN')->pluck('reason') as $reason) {
                $flags[] = ['reason' => $reason, 'source' => 'flag', 'detail' => null];
            }
        }
        if ((int) $row->has_flagged_photo === 1) {
            $flags[] = ['reason' => 'IMAGE_PIPELINE', 'source' => 'pipeline', 'detail' => null];
        }
        if ($this->detectContact($row->title . ' ' . ($row->description ?? '')) !== null) {
            $flags[] = ['reason' => 'CONTACT_IN_LISTING', 'source' => 'policy', 'detail' => null];
        }
        if (!in_array($row->commission_band, self::VALID_BANDS, true)) {
            $flags[] = ['reason' => 'BANDLESS_CATEGORY', 'source' => 'catalogue', 'detail' => null];
        }

        return $flags;
    }

    private function flagDetail(object $flag): ?string
    {
        $details = $flag->details ? json_decode($flag->details, true) : null;
        if (is_array($details) && isset($details['note'])) {
            return (string) $details['note'];
        }
        return null;
    }

    // ── §10.3 contact detection (consume the defined detector patterns) ──────────

    /**
     * Detect a phone number / email / external handle in public listing text.
     * Returns a short human description of the FIRST hit, or null. Mirrors the
     * §10.3 message-channel detectors applied to title+description.
     */
    private function detectContact(string $text): ?string
    {
        // Phone: 7+ digit runs allowing separators / country code.
        if (preg_match('/(\+?\d[\d\s().\-]{6,}\d)/', $text)) {
            return 'Possible phone number in public text';
        }
        // Email (incl. lightly obfuscated "foo at gmail dot com").
        if (preg_match('/[\w.+-]+@[\w-]+\.[\w.-]+/i', $text)
            || preg_match('/\b\w+\s+at\s+\w+\s+dot\s+\w+/i', $text)) {
            return 'Possible email address in public text';
        }
        // Social handles / off-platform links.
        if (preg_match('#(@[A-Za-z0-9_]{3,}|t\.me/|wa\.me/|whatsapp|instagram\.com/|fb\.me/|facebook\.com/)#i', $text)) {
            return 'Possible external handle / off-platform link in public text';
        }
        return null;
    }

    // ── Moderation actions (all audited) ─────────────────────────────────────────

    public function hide(Service $service, AdminUser $actor, string $reason): array
    {
        if ($service->status === 'HIDDEN') {
            throw new ApiException(ErrorCode::CONFLICT, 'This listing is already hidden.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'service.hide',
            targetType: 'service',
            targetId: $service->id,
            reason: $reason,
            metadata: ['before' => ['status' => $service->status], 'after' => ['status' => 'HIDDEN']],
            mutation: fn () => $service->forceFill(['status' => 'HIDDEN'])->save(),
        );

        $fresh = $service->fresh();
        $this->notifications->dispatch(new ListingModerated($fresh, 'hidden', $reason));
        return $this->detail($fresh);
    }

    public function requireChanges(Service $service, AdminUser $actor, string $reason): array
    {
        if ($service->status === 'DRAFT') {
            throw new ApiException(ErrorCode::CONFLICT, 'This listing is already back with the provider as a draft.');
        }

        // Back to the provider as a DRAFT — they edit and re-publish. The reason
        // (the change notes shown to the provider) lives in the audit log.
        $this->audit->perform(
            actor: $actor,
            action: 'service.require_changes',
            targetType: 'service',
            targetId: $service->id,
            reason: $reason,
            metadata: ['before' => ['status' => $service->status], 'after' => ['status' => 'DRAFT']],
            mutation: fn () => $service->forceFill(['status' => 'DRAFT'])->save(),
        );

        $fresh = $service->fresh();
        $this->notifications->dispatch(new ListingModerated($fresh, 'requires_changes', $reason));
        return $this->detail($fresh);
    }

    public function restore(Service $service, AdminUser $actor, string $reason): array
    {
        if ($service->status === 'ACTIVE') {
            throw new ApiException(ErrorCode::CONFLICT, 'This listing is already active.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'service.restore',
            targetType: 'service',
            targetId: $service->id,
            reason: $reason,
            metadata: ['before' => ['status' => $service->status], 'after' => ['status' => 'ACTIVE']],
            mutation: fn () => $service->forceFill(['status' => 'ACTIVE'])->save(),
        );

        $fresh = $service->fresh();
        $this->notifications->dispatch(new ListingModerated($fresh, 'restored', $reason));
        return $this->detail($fresh);
    }

    public function reassignCategory(Service $service, AdminUser $actor, int $categoryId, string $reason): array
    {
        $category = DB::table('categories')->where('id', $categoryId)->first(['id', 'name', 'commission_band']);
        if (!$category) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Target category not found.');
        }
        if (!in_array($category->commission_band, self::VALID_BANDS, true)) {
            throw new ApiException(ErrorCode::CONFLICT, 'Target category has no valid §8.1 commission band. Pick a banded category.');
        }
        if ((int) $service->category_id === $categoryId) {
            throw new ApiException(ErrorCode::CONFLICT, 'The listing is already in that category.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'service.reassign_category',
            targetType: 'service',
            targetId: $service->id,
            reason: $reason,
            metadata: [
                'before' => ['category_id' => (int) $service->category_id],
                'after'  => ['category_id' => $categoryId, 'commission_band' => $category->commission_band],
            ],
            mutation: fn () => $service->forceFill(['category_id' => $categoryId])->save(),
        );

        return $this->detail($service->fresh());
    }

    public function removePhoto(Service $service, ServicePhoto $photo, AdminUser $actor, string $reason): array
    {
        if ($photo->service_id !== $service->id) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'That photo does not belong to this listing.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'service.remove_photo',
            targetType: 'service',
            targetId: $service->id,
            reason: $reason,
            metadata: ['after' => ['removed_photo_id' => $photo->id, 'path' => $photo->path]],
            mutation: fn () => $photo->delete(),
        );

        return $this->detail($service->fresh());
    }

    // ── SQL predicates ───────────────────────────────────────────────────────────

    private function openFlagExists(): string
    {
        return "EXISTS (SELECT 1 FROM listing_review_flags lrf WHERE lrf.service_id = s.id AND lrf.status = 'OPEN')";
    }

    private function flaggedPhotoExists(): string
    {
        $nsfw = self::NSFW_THRESHOLD;
        return "EXISTS (SELECT 1 FROM service_photos sp WHERE sp.service_id = s.id AND (
            sp.pipeline_status = 'FLAGGED'
            OR (sp.nsfw_score IS NOT NULL AND sp.nsfw_score >= $nsfw)
            OR sp.duplicate_of_service_id IS NOT NULL
            OR sp.exif_stripped = false))";
    }

    private function bandlessPredicate(): string
    {
        $bands = "'" . implode("','", self::VALID_BANDS) . "'";
        return "(c.commission_band IS NULL OR c.commission_band NOT IN ($bands))";
    }

    /** Postgres POSIX regex gate for contact-in-listing (mirrors detectContact). */
    private function contactPredicate(string $alias): string
    {
        $text = "($alias.title || ' ' || COALESCE($alias.description, ''))";
        // phone | email | obfuscated email | social handles / off-platform links
        $phone  = "$text ~ '(\\+?[0-9][0-9 ().\\-]{6,}[0-9])'";
        $email  = "$text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'";
        $obfusc = "$text ~* '[A-Za-z0-9]+ at [A-Za-z0-9]+ dot [A-Za-z]+'";
        $social = "$text ~* '(@[A-Za-z0-9_]{3,}|t\\.me/|wa\\.me/|whatsapp|instagram\\.com/|fb\\.me/|facebook\\.com/)'";

        return "($phone OR $email OR $obfusc OR $social)";
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function latestModerationReason(string $serviceId): ?string
    {
        $row = DB::table('admin_audit_log')
            ->where('target_type', 'service')
            ->where('target_id', $serviceId)
            ->whereIn('action', self::MODERATION_ACTIONS)
            ->orderByDesc('created_at')
            ->first(['reason']);

        return $row?->reason;
    }

    private function providerName(?string $displayName, ?string $legalName, ?string $email): string
    {
        if ($displayName) return $displayName;
        if ($legalName)   return $legalName;
        if ($email)       return explode('@', $email)[0];
        return 'Provider';
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : \Illuminate\Support\Carbon::parse($value)->toIso8601String();
    }
}
