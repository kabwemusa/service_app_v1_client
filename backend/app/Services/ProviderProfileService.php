<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Enums\TrustTier;
use App\Exceptions\Api\ApiException;
use App\Models\Booking;
use App\Models\Commission;
use App\Models\Dispute;
use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class ProviderProfileService
{
    /** v3.1 §6.6 — portfolio manager limits. */
    private const MAX_PORTFOLIO_IMAGES = 12;
    private const MAX_PORTFOLIO_BYTES  = 5 * 1024 * 1024;

    /** v3 §9.1 — exact checklist tasks + point values for the profile-strength meter. */
    private const CHECKLIST_ITEMS = [
        ['key' => 'profile_photo',       'label' => 'Upload profile photo',             'points' => 5],
        ['key' => 'bio',                 'label' => 'Write bio (≥ 80 chars)',           'points' => 5],
        ['key' => 'portfolio_image',     'label' => 'Add at least one portfolio image', 'points' => 10],
        ['key' => 'kyc_tier_2',          'label' => 'Complete KYC Tier 2',              'points' => 20],
        ['key' => 'tier_3',              'label' => 'Reach Tier 3',                     'points' => 15],
        ['key' => 'three_services',      'label' => 'List at least 3 services',         'points' => 10],
        ['key' => 'weekly_availability', 'label' => 'Set weekly availability',          'points' => 10],
        ['key' => 'push_notifications',  'label' => 'Enable push notifications',        'points' => 5],
        ['key' => 'first_booking',       'label' => 'Complete first booking',           'points' => 10],
        ['key' => 'first_review',        'label' => 'Get first review',                 'points' => 10],
    ];

    /**
     * Return the provider's profile, creating a blank record if none exists.
     */
    public function getOrCreate(User $user): ProviderProfile
    {
        return ProviderProfile::firstOrCreate(
            ['user_id' => $user->id],
            ['profile_completeness' => 0],
        );
    }

    /**
     * Create or update the provider profile with the given fields.
     */
    public function upsert(User $user, array $data): ProviderProfile
    {
        $profile = $this->getOrCreate($user);
        $profile->fill($data);
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    /**
     * Recompute and persist `profile_completeness` from current facts.
     *
     * Call this whenever something that feeds the §9.1 checklist changes
     * outside the profile-edit flow itself — e.g. publishing a service to
     * `ACTIVE` (v3.1 §6.7 AC: "publishing a 3rd ACTIVE service awards the
     * §9.1 points").
     */
    public function recalculateCompleteness(User $user): void
    {
        $profile = $this->getOrCreate($user);
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();
    }

    /**
     * Store the uploaded student-ID document and update the profile.
     *
     * In production: swap Storage::disk('local') for Storage::disk('s3').
     */
    public function uploadKyc(User $user, UploadedFile $file): ProviderProfile
    {
        $profile = $this->getOrCreate($user);

        $path = $file->store("kyc/{$user->id}", 'local');

        $profile->student_id_url = $path;
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    /**
     * §6.5 Hub aggregate — the single "manage my business" payload: tier +
     * next-tier requirements (v3 §4.1/§4.5), the §9.1 checklist with exact
     * point values and the next unchecked task, weekly earnings vs cap,
     * next-payout countdown (v3 §12.2), and instant-payout eligibility (§8.6).
     */
    public function dashboard(User $user): array
    {
        $profile = $this->getOrCreate($user);
        $tier    = $profile->tier();

        $thisWeekNet = (float) Commission::where('provider_id', $user->id)
            ->where('calculated_at', '>=', now()->subDays(7))
            ->sum('net_to_provider');

        $lastWeekNet = (float) Commission::where('provider_id', $user->id)
            ->whereBetween('calculated_at', [now()->subDays(14), now()->subDays(7)])
            ->sum('net_to_provider');

        $nextPayoutBooking = Booking::with('commission')
            ->where('provider_id', $user->id)
            ->where('status', 'COMPLETED')
            ->whereNull('disbursed_at')
            ->whereNotNull('payout_eligible_at')
            ->orderBy('payout_eligible_at')
            ->first();

        $completedJobs = $user->bookingsAsProvider()->where('status', 'COMPLETED')->count();

        $mode = config('booking.payment_mode', 'DIRECT');

        // TODAY aggregate — new requests = bookings awaiting a reply.
        // DIRECT: REQUESTED/QUOTED awaiting the provider · ESCROW: FUNDS_HELD (same
        // population as the §6.8 Requests tab "New" section).
        $newRequestStatuses = $mode === 'DIRECT' ? ['REQUESTED', 'QUOTED'] : ['FUNDS_HELD'];
        $nextJobStatuses    = $mode === 'DIRECT' ? ['ACCEPTED', 'IN_PROGRESS'] : ['FUNDS_HELD', 'IN_PROGRESS'];

        $newRequests = Booking::where('provider_id', $user->id)
            ->whereIn('status', $newRequestStatuses)
            ->count();

        $nextJob = Booking::with('service')
            ->where('provider_id', $user->id)
            ->whereIn('status', $nextJobStatuses)
            ->whereNotNull('scheduled_start')
            ->where('scheduled_start', '>=', now()->startOfDay())
            ->orderBy('scheduled_start')
            ->first();

        return [
            'tier' => [
                'value'             => $tier->value,
                'label'             => $tier->label(),
                'job_cap_zmw'       => $tier->jobCapZmw(),
                'weekly_cap_zmw'    => $tier->weeklyCapZmw(),
                'payout_hold_hours' => $tier->payoutHoldHours(),
            ],
            'payment_mode'         => $mode,
            'next_tier'            => $this->nextTierSummary($tier, $profile, $completedJobs, $user),
            'profile_completeness' => $profile->profile_completeness,
            'checklist'            => $this->checklist($user, $profile),
            'earned_badges'        => $this->earnedBadges($user, $profile),
            // Ordered path to being visible in search — mirrors the SearchService
            // hard gates (tier ≥ 1, completeness ≥ 40, ≥ 1 ACTIVE service).
            'listing'              => $this->listingStatus($profile),
            'earnings' => [
                'this_week_zmw'  => round($thisWeekNet, 2),
                'weekly_cap_zmw' => $tier->weeklyCapZmw(),
                'trend'          => $thisWeekNet > $lastWeekNet ? 'up' : ($thisWeekNet < $lastWeekNet ? 'down' : 'flat'),
            ],
            'next_payout' => $nextPayoutBooking ? [
                'booking_id'  => $nextPayoutBooking->id,
                'amount_zmw'  => round((float) ($nextPayoutBooking->commission?->net_to_provider ?? 0), 2),
                'eligible_at' => $nextPayoutBooking->payout_eligible_at?->toIso8601String(),
            ] : null,
            'instant_payout' => [
                'eligible' => $tier->hasInstantPayout(),
                'fee_rate' => 0.01,
            ],
            'accepting_bookings'  => (bool) ($profile->accepting_bookings ?? true),
            // Public profile photo — never the KYC selfie.
            'profile_photo_url'   => $profile->avatar_url ?? $profile->cover_image_url,
            'display_name'        => $profile->display_name ?? $user->legal_name,
            'notifications_count' => $newRequests,
            'today' => [
                'new_requests' => $newRequests,
                'next_job'     => $nextJob ? [
                    'service_title'  => $nextJob->service?->title ?? 'Booking',
                    'scheduled_at'   => $nextJob->scheduled_start->toIso8601String(),
                    'location_label' => $nextJob->delivery_location_label ?? '',
                ] : null,
            ],
            'stats' => [
                'rating'                 => ((int) $user->v_reviews) > 0 ? round((float) $user->r_raw, 2) : null,
                'response_time_p50_mins' => $profile->response_time_p50_mins,
                'repeat_client_rate'     => $profile->repeat_client_rate,
                'jobs_done'              => $completedJobs,
            ],
        ];
    }

    /** Persist the Hub Available/Away toggle. */
    public function setAcceptingBookings(User $user, bool $accepting): ProviderProfile
    {
        $profile = $this->getOrCreate($user);
        $profile->accepting_bookings = $accepting;
        $profile->save();

        return $profile->fresh();
    }

    /**
     * The ordered "get listed" path. A provider appears in search only when
     * every gate the SearchService applies is met — surface each gate as an
     * explicit, ordered step so the provider always knows what comes next.
     */
    private function listingStatus(ProviderProfile $profile): array
    {
        $minCompleteness = (int) config('search.search.min_profile_completeness', 40);

        $steps = [
            [
                'key'   => 'verify_identity',
                'label' => 'Verify your identity (Tier 1)',
                'done'  => ($profile->trust_tier ?? 0) >= TrustTier::BASIC->value,
            ],
            [
                'key'   => 'profile_strength',
                'label' => "Build your profile to {$minCompleteness}+ strength",
                'done'  => ($profile->profile_completeness ?? 0) >= $minCompleteness,
            ],
            [
                'key'   => 'active_service',
                'label' => 'Publish at least one service',
                'done'  => $profile->services()->where('status', 'ACTIVE')->exists(),
            ],
        ];

        return [
            'listed' => collect($steps)->every(fn ($s) => $s['done']),
            'steps'  => $steps,
        ];
    }

    /**
     * §6.5/§9.3 — Earnings tab aggregate: weekly/monthly/lifetime totals,
     * payout countdown, instant-payout eligibility, and recent commission entries.
     */
    public function earnings(User $user): array
    {
        $profile = $this->getOrCreate($user);
        $tier    = $profile->tier();
        $now     = now();

        $thisWeekNet = (float) Commission::where('provider_id', $user->id)
            ->where('calculated_at', '>=', $now->copy()->subDays(7))
            ->sum('net_to_provider');

        $thisMonthNet = (float) Commission::where('provider_id', $user->id)
            ->where('calculated_at', '>=', $now->copy()->startOfMonth())
            ->sum('net_to_provider');

        $lifetimeNet = (float) Commission::where('provider_id', $user->id)
            ->sum('net_to_provider');

        $nextPayoutBooking = Booking::with('commission')
            ->where('provider_id', $user->id)
            ->where('status', 'COMPLETED')
            ->whereNull('disbursed_at')
            ->whereNotNull('payout_eligible_at')
            ->orderBy('payout_eligible_at')
            ->first();

        $recent = Commission::with('booking.service')
            ->where('provider_id', $user->id)
            ->orderByDesc('calculated_at')
            ->limit(20)
            ->get()
            ->map(fn (Commission $commission) => [
                'booking_id'      => $commission->booking_id,
                'service_title'   => $commission->booking?->service?->title,
                'gross_zmw'       => round((float) $commission->gross_amount, 2),
                'commission_rate' => (float) $commission->commission_rate,
                // v3.2 §5 — "Repeat-client discount", its own statement line
                'repeat_discount_rate' => (float) ($commission->repeat_discount_rate ?? 0),
                'net_zmw'         => round((float) $commission->net_to_provider, 2),
                'calculated_at'   => $commission->calculated_at?->toIso8601String(),
                'paid'            => $commission->booking?->disbursed_at !== null,
                'eligible_at'     => $commission->booking?->payout_eligible_at?->toIso8601String(),
            ])
            ->all();

        return [
            'payment_mode' => config('booking.payment_mode', 'DIRECT'),
            'tier' => [
                'value'             => $tier->value,
                'label'             => $tier->label(),
                'job_cap_zmw'       => $tier->jobCapZmw(),
                'weekly_cap_zmw'    => $tier->weeklyCapZmw(),
                'payout_hold_hours' => $tier->payoutHoldHours(),
            ],
            'summary' => [
                'this_week_zmw'  => round($thisWeekNet, 2),
                'this_month_zmw' => round($thisMonthNet, 2),
                'lifetime_zmw'   => round($lifetimeNet, 2),
                'weekly_cap_zmw' => $tier->weeklyCapZmw(),
            ],
            'next_payout' => $nextPayoutBooking ? [
                'booking_id'  => $nextPayoutBooking->id,
                'amount_zmw'  => round((float) ($nextPayoutBooking->commission?->net_to_provider ?? 0), 2),
                'eligible_at' => $nextPayoutBooking->payout_eligible_at?->toIso8601String(),
            ] : null,
            'instant_payout' => [
                'eligible' => $tier->hasInstantPayout(),
                'fee_rate' => 0.01,
            ],
            'recent' => $recent,
        ];
    }

    /**
     * §6.6 portfolio manager — append an image (cap: 12 images / 5MB each).
     * Mirrors the `ServiceController::uploadPhoto` storage pattern but keeps
     * the result as a JSONB array of storage paths on the profile itself.
     */
    public function addPortfolioImage(User $user, UploadedFile $file): ProviderProfile
    {
        $profile = $this->getOrCreate($user);
        $images  = (array) ($profile->portfolio_images ?? []);

        if (count($images) >= self::MAX_PORTFOLIO_IMAGES) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'A portfolio may have at most 12 images.');
        }

        if ($file->getSize() > self::MAX_PORTFOLIO_BYTES) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Portfolio images must be 5MB or smaller.');
        }

        $images[] = $file->store('portfolio_images', 'public');

        $profile->portfolio_images     = array_values($images);
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    /** §6.6 portfolio manager — remove an image by its storage path. */
    public function removePortfolioImage(User $user, string $path): ProviderProfile
    {
        $profile = $this->getOrCreate($user);
        $images  = (array) ($profile->portfolio_images ?? []);

        if (! in_array($path, $images, true)) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'That image is not part of your portfolio.');
        }

        Storage::disk('public')->delete($path);

        $profile->portfolio_images     = array_values(array_diff($images, [$path]));
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    /** Upload (or replace) the provider's profile cover photo. */
    public function uploadCoverPhoto(User $user, UploadedFile $file): ProviderProfile
    {
        $profile = $this->getOrCreate($user);

        if (! empty($profile->cover_image_url)) {
            Storage::disk('public')->delete($profile->cover_image_url);
        }

        $profile->cover_image_url      = $file->store('cover_photos', 'public');
        $profile->profile_completeness = $this->calculateCompleteness($profile);
        $profile->save();

        return $profile->fresh();
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /** v3 §4.1 — the next tier above the provider's current one (null at the top). */
    private function nextTierSummary(TrustTier $tier, ProviderProfile $profile, int $completedJobs, User $user): ?array
    {
        $next = match ($tier) {
            TrustTier::UNVERIFIED   => TrustTier::BASIC,
            TrustTier::BASIC        => TrustTier::IDENTIFIED,
            TrustTier::IDENTIFIED   => TrustTier::VERIFIED,
            TrustTier::VERIFIED     => TrustTier::PROFESSIONAL,
            TrustTier::PROFESSIONAL => null,
        };

        if ($next === null) {
            return null;
        }

        return [
            'value'        => $next->value,
            'label'        => $next->label(),
            'requirements' => $this->tierRequirements($next),
            'progress'     => $this->tierProgress($next, $profile, $completedJobs, $user),
            'unlocks'      => $this->tierUnlocks($next),
        ];
    }

    /**
     * Coarse 0–1 progress toward the next tier, from signals we already hold.
     * KYC document review is external, so a submitted-but-pending document
     * counts as half-way rather than pretending to know the outcome.
     */
    private function tierProgress(TrustTier $next, ProviderProfile $profile, int $completedJobs, User $user): float
    {
        $progress = match ($next) {
            TrustTier::BASIC        => in_array($profile->kyc_status, ['SUBMITTED', 'MANUAL_REVIEW'], true) ? 0.5 : 0.0,
            TrustTier::IDENTIFIED   => in_array($profile->kyc_status, ['SUBMITTED', 'MANUAL_REVIEW'], true) ? 0.5 : 0.0,
            TrustTier::VERIFIED     => (! empty($profile->momo_provider) && ! empty($profile->momo_number)) ? 0.5 : 0.0,
            TrustTier::PROFESSIONAL => 0.5 * min(1.0, $completedJobs / 20)
                                     + (((float) $user->r_raw >= 4.5 && (int) $user->v_reviews > 0) ? 0.25 : 0.0),
            default                 => 0.0,
        };

        return round(min(1.0, $progress), 2);
    }

    /** v3 §4.1 — what each tier unlocks, shown on the "unlock next tier" card. */
    private function tierUnlocks(TrustTier $tier): array
    {
        return match ($tier) {
            TrustTier::BASIC        => ['List services', 'Jobs up to ZMW 300'],
            TrustTier::IDENTIFIED   => ['Jobs up to ZMW 2,000', '48h payout hold'],
            TrustTier::VERIFIED     => ['Instant payout', 'Promoted slots', 'Jobs up to ZMW 10,000'],
            TrustTier::PROFESSIONAL => ['No job caps', '12h payout hold', 'Professional badge'],
            default                 => [],
        };
    }

    /** v3 §4.1/§4.5 — the concrete unlock requirements shown on the "unlock next tier" card. */
    private function tierRequirements(TrustTier $tier): array
    {
        return match ($tier) {
            TrustTier::BASIC      => [
                'Verify your email and phone number',
                'Add your legal name and a profile selfie',
            ],
            TrustTier::IDENTIFIED => [
                "Scan a government ID (NRC, passport, or driver's licence)",
                'Pass an automated liveness check',
                // v3.2 §4.3 — pulled forward from Tier 3
                'Your mobile money account name must match your ID',
            ],
            TrustTier::VERIFIED   => [
                'Submit proof of address (utility bill, lease, or bank statement, ≤ 3 months old)',
            ],
            TrustTier::PROFESSIONAL => [
                'Provide a skill proof (trade certificate, diploma, professional licence, or portfolio review)',
                'Complete 20 jobs on the platform with an average rating of 4.5 or higher',
            ],
            default => [],
        };
    }

    /**
     * v3 §9.1 — every checklist item resolved against real, current state
     * (not the `profile_completeness` cache, which has its own pre-existing
     * scoring gaps). `push_notifications` and `first_review` have no backing
     * platform infrastructure yet, so they are honestly reported as not done.
     */
    private function checklist(User $user, ProviderProfile $profile): array
    {
        $done = [
            'profile_photo'       => ! empty($profile->cover_image_url),
            'bio'                 => ! empty($profile->bio) && mb_strlen($profile->bio) >= 80,
            'portfolio_image'     => count((array) ($profile->portfolio_images ?? [])) >= 1,
            'kyc_tier_2'          => ($profile->trust_tier ?? 0) >= TrustTier::IDENTIFIED->value,
            'tier_3'              => ($profile->trust_tier ?? 0) >= TrustTier::VERIFIED->value,
            'three_services'      => $profile->services()->where('status', 'ACTIVE')->count() >= 3,
            'weekly_availability' => ! empty($profile->availability_matrix) && count((array) $profile->availability_matrix) > 0,
            'push_notifications'  => false,
            'first_booking'       => $user->bookingsAsProvider()->where('status', 'COMPLETED')->exists(),
            'first_review'        => (int) $user->v_reviews > 0,
        ];

        $items = [];
        $next  = null;

        foreach (self::CHECKLIST_ITEMS as $item) {
            $isDone    = $done[$item['key']];
            $items[]   = array_merge($item, ['done' => $isDone]);

            if (! $isDone && $next === null) {
                $next = $item;
            }
        }

        return ['items' => $items, 'next' => $next];
    }

    /**
     * v3 §9.2 — badges earned from real, current metrics. This is the pool
     * the highlights editor lets a provider choose from for `featured_badges`;
     * a provider can only feature what they've actually earned.
     */
    public function earnedBadges(User $user, ProviderProfile $profile): array
    {
        $badges = [];
        $rating = (float) ($user->r_raw ?? 0);
        $reviews = (int) ($user->v_reviews ?? 0);

        if (($profile->trust_tier ?? 0) >= TrustTier::VERIFIED->value)      $badges[] = 'VERIFIED';
        if (($profile->trust_tier ?? 0) === TrustTier::PROFESSIONAL->value) $badges[] = 'PROFESSIONAL';
        if (($profile->response_time_p50_mins ?? 9999) < 10)                $badges[] = 'QUICK_RESPONDER';
        if ($rating >= 4.8 && $reviews >= 25)                                $badges[] = 'TOP_RATED';
        if ($rating >= 4.7 && $reviews >= 5 && $user->created_at?->diffInDays(now()) < 90) $badges[] = 'RISING_STAR';
        if (($profile->repeat_client_rate ?? 0) >= 0.30)                    $badges[] = 'REPEAT_LOVED';

        $completedJobs = $user->bookingsAsProvider()->where('status', 'COMPLETED')->count();
        if ($completedJobs >= 50) {
            $upheld = Dispute::where('against', $user->id)
                ->whereIn('status', ['RESOLVED_BUYER', 'RESOLVED_PARTIAL'])
                ->exists();

            if (! $upheld) $badges[] = 'DISPUTE_FREE';
        }

        return $badges;
    }

    /**
     * v3 profile completeness scoring (0–100).
     * Mirrors the §9.1 profile strength meter tasks.
     */
    private function calculateCompleteness(ProviderProfile $profile): int
    {
        $score = 0;

        if (! empty($profile->cover_image_url))                                                 $score += 5;
        if (! empty($profile->bio) && mb_strlen($profile->bio) >= 80)                          $score += 5;
        if (! empty($profile->portfolio_images) && count((array) $profile->portfolio_images) >= 1) $score += 10;
        if (($profile->trust_tier ?? 0) >= 2)                                                  $score += 20;  // KYC Tier 2
        if (($profile->trust_tier ?? 0) >= 3)                                                  $score += 15;  // Tier 3
        if (! empty($profile->momo_provider) && ! empty($profile->momo_number))                $score += 10;  // proxy for "set payment"
        if (! empty($profile->availability_matrix) && count((array) $profile->availability_matrix) > 0) $score += 10;
        // v3.1 §6.7 AC — "publishing a 3rd ACTIVE service awards the §9.1 points"
        if ($profile->services()->where('status', 'ACTIVE')->count() >= 3)                    $score += 10;  // "List at least 3 services"

        return min(100, $score);
    }
}
