<?php

namespace App\Services;

use App\Contracts\TrustEngine;
use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\ProviderService;
use App\Models\ProviderVerification;
use App\Models\RiskTierConfig;
use App\Models\Service;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Progressive, resumable provider onboarding (onboarding flow spec).
 *
 * Each step persists immediately so a dropped-off applicant resumes exactly
 * where they left (state() rehydrates the cursor + collected data). The
 * universal base (NRC + selfie + MoMo) is Tier 1; go-live consults the same
 * server-enforced eligibility gate the dispatcher uses, so a sub-tier listing
 * is visible but non-dispatchable until the extra verification lands.
 */
class ProviderOnboardingService
{
    /** Ordered steps after the account (phone+OTP) is created. */
    public const STEPS = ['about', 'offer', 'identity', 'service', 'payout', 'go_live'];

    /** Human-facing labels for each verification the gate can require. */
    private const VERIFICATION_LADDER = [
        'nrc'             => 'Verify your identity (NRC + selfie)',
        'momo_name_match' => 'Confirm your Mobile Money payment identity',
        'portfolio'       => 'Add a portfolio of your work',
        'police_clearance'=> 'Provide a police clearance certificate',
    ];

    public function __construct(
        private readonly ProviderProfileService $profiles,
        private readonly KycService             $kyc,
        private readonly AvailabilityService    $availability,
        private readonly TrustEngine            $trust,
    ) {}

    // ── Resume payload ───────────────────────────────────────────────────────

    public function state(User $user): array
    {
        $profile = $this->profiles->getOrCreate($user);

        $chosenService = $profile->onboarding_service_id
            ? Service::with('category')->find($profile->onboarding_service_id)
            : null;

        $eligibility = $chosenService
            ? $this->trust->checkEligibility($user->id, $chosenService->id)
            : null;

        return [
            'state' => $profile->onboarding_state ?? 'DRAFT',
            'step'  => $profile->onboarding_step ?? 'about',
            'collected' => [
                'name'        => $profile->display_name ?? $user->legal_name,
                'has_avatar'  => ! empty($profile->avatar_url),
                'languages'   => $profile->languages ?? [],
                'area_label'  => $profile->base_location_label,
                'has_area'    => $profile->base_location_lat !== null,
                'category_id' => $profile->onboarding_category_id,
                'service_id'  => $profile->onboarding_service_id,
                'momo_number' => $profile->momo_number,
                'identity_status' => $this->identityStatus($user->id),
            ],
            'chosen_service' => $chosenService ? [
                'id'        => $chosenService->id,
                'title'     => $chosenService->title,
                'risk_tier' => (int) ($chosenService->category->risk_tier ?? 1),
            ] : null,
            'eligibility' => $eligibility,
        ];
    }

    // ── Steps ────────────────────────────────────────────────────────────────

    /** Step 3 — About you: public name, languages, area (no KYC here). */
    public function saveAbout(User $user, array $data): ProviderProfile
    {
        if (! empty($data['name'])) {
            $user->update(['legal_name' => $data['name']]);
        }

        $profile = $this->profiles->upsert($user, array_filter([
            'display_name'        => $data['name'] ?? null,
            'languages'           => $data['languages'] ?? null,
            'base_location_lat'   => $data['latitude'] ?? null,
            'base_location_lng'   => $data['longitude'] ?? null,
            'base_location_label' => $data['area_label'] ?? null,
        ], fn ($v) => $v !== null));

        return $this->advance($profile, 'about');
    }

    /** Step 4 — What you offer: category (→ required risk tier) + optional catalog service. */
    public function saveOffer(User $user, int $categoryId, ?string $serviceId = null): ProviderProfile
    {
        $category = Category::find($categoryId);
        if (! $category) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Category not found.');
        }

        $profile = $this->profiles->getOrCreate($user);
        $profile->onboarding_category_id = $categoryId;
        if ($serviceId && Service::where('id', $serviceId)->where('category_id', $categoryId)->exists()) {
            $profile->onboarding_service_id = $serviceId;
        }
        $profile->save();

        return $this->advance($profile, 'offer');
    }

    /**
     * Step 5 — Identity (universal base = Tier 1): NRC front + selfie + MoMo.
     * Runs the §4.3/§5.3 KYC pipeline. Sets MoMo first so the NRC-anchored
     * wallet-name match can run inside the pipeline. Mismatches (name or MoMo)
     * route to manual review inside the pipeline — never silently guessed.
     */
    public function submitIdentity(
        User         $user,
        UploadedFile $nrcFront,
        UploadedFile $selfie,
        string       $momoNumber,
        string       $momoProvider = 'MTN',
    ): ProviderProfile {
        $profile = $this->profiles->getOrCreate($user);

        // Payout/identity wallet on file before the pipeline runs its match.
        $profile->momo_provider = $momoProvider;
        $profile->momo_number   = $momoNumber;
        $profile->save();

        // Tier 1 base: selfie + legal name (BASIC), then the NRC document
        // pipeline (→ IDENTIFIED, writes the provider_verifications the gate reads).
        $this->kyc->submitTier1($user, $user->legal_name ?? $profile->display_name ?? '', $selfie);
        $this->kyc->submitDocument($user, $nrcFront, $selfie, \App\Enums\DocType::NRC->value);

        return $this->advance($profile->fresh(), 'identity');
    }

    /**
     * Step 6 — Your service: title, price, quick weekly availability.
     * Creates the catalog Service (owned by the provider) + the provider_services
     * join the dispatcher reads, in the category chosen at the offer step.
     */
    public function saveService(User $user, array $data): Service
    {
        $profile = $this->profiles->getOrCreate($user);

        $categoryId = $profile->onboarding_category_id;
        if (! $categoryId) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Choose what you offer before adding a service.');
        }

        $pricingModel = $data['pricing_model'] ?? 'OUTCOME_FIXED';

        $service = DB::transaction(function () use ($user, $profile, $categoryId, $data, $pricingModel) {
            $price = $data['price'] ?? null;

            // Outcome-based pricing fields. The quick onboarding listing keeps
            // it minimal: HOURLY_CAPPED gets the standard 1-hr min / 4-hr cap
            // defaults and is flagged so the provider reviews the cap in the
            // full editor; quote-first models carry no upfront price.
            $pricing = match ($pricingModel) {
                'HOURLY_CAPPED' => [
                    'base_price'           => $price !== null ? round($price * 4, 2) : null,
                    'hourly_rate'          => $price,
                    'minimum_hours'        => 1,
                    'cap_hours'            => 4,
                    'cap_amount'           => $price !== null ? round($price * 4, 2) : null,
                    'needs_pricing_review' => true,
                ],
                'PROVIDER_SCOPE' => ['base_price' => null, 'hourly_rate' => $price],
                'QUOTE_DEPOSIT'  => ['base_price' => null, 'deposit_percent' => 30],
                default          => ['base_price' => $price],
            };

            $service = Service::create(array_merge([
                'provider_id'   => $user->id,
                'category_id'   => $categoryId,
                'title'         => $data['title'],
                'description'   => $data['description'] ?? null,
                'pricing_model' => $pricingModel,
                'status'        => 'ACTIVE',
            ], $pricing));

            ProviderService::create([
                'provider_id'   => $user->id,
                'service_id'    => $service->id,
                'price'         => $service->base_price,
                'pricing_model' => $pricingModel,
                'status'        => 'ACTIVE',
            ]);

            $profile->onboarding_service_id = $service->id;
            $profile->save();

            return $service;
        });

        if (! empty($data['availability']) && is_array($data['availability'])) {
            $this->availability->setSchedule($user->id, $data['availability']);
        }

        $this->advance($profile->fresh(), 'service');

        return $service;
    }

    /** Step 7 — Payout: MoMo number (defaults to the identity number; never public). */
    public function savePayout(User $user, ?string $momoNumber = null, ?string $momoProvider = null): ProviderProfile
    {
        $profile = $this->profiles->getOrCreate($user);

        if ($momoNumber) {
            $profile->momo_number = $momoNumber;
        }
        if ($momoProvider) {
            $profile->momo_provider = $momoProvider;
        }
        $profile->save();

        return $this->advance($profile, 'payout');
    }

    /**
     * Step 8 — Go-live: consult the eligibility gate for the chosen service's
     * risk tier. Eligible (e.g. a Tier-1 remote category) → LIVE now. Otherwise
     * the account is SET_UP and the listing exists but is non-dispatchable until
     * the missing verification (portfolio / police clearance) is added.
     */
    public function goLive(User $user): array
    {
        $profile = $this->profiles->getOrCreate($user);

        if (! $profile->onboarding_service_id) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Add a service before going live.');
        }

        $eligibility = $this->trust->checkEligibility($user->id, $profile->onboarding_service_id);

        $profile->onboarding_state = $eligibility['eligible'] ? 'LIVE' : 'SET_UP';
        $profile->onboarding_step  = 'go_live';
        $profile->save();

        $service = Service::with('category')->find($profile->onboarding_service_id);
        $riskTier = (int) ($service?->category->risk_tier ?? 1);

        return [
            'state'       => $profile->onboarding_state,
            'is_live'     => $eligibility['eligible'],
            'eligibility' => $eligibility,
            'tier_ladder' => $this->tierLadder($user->id, $riskTier, $eligibility['missing']),
        ];
    }

    // ── Tier ladder (current / unlocks / required) ──────────────────────────

    /**
     * The capability ladder for the chosen category's risk tier: every rung
     * (verification), whether the provider already has it, and which rungs are
     * the immediate blockers returned by the gate. Trust scores are NEVER
     * included — only tier + verified facts (TrustEngine contract).
     */
    public function tierLadder(string $providerId, int $riskTier, array $missing = []): array
    {
        $have = ProviderVerification::where('provider_id', $providerId)
            ->where('status', 'VERIFIED')
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->pluck('verification_type')
            ->all();

        $config = RiskTierConfig::where('risk_tier', $riskTier)->first();
        // The fullest requirement set names every rung in order for this tier.
        $allRequired = $config?->eligibility_requirements['tier_3']
            ?? array_keys(self::VERIFICATION_LADDER);

        $rungs = [];
        foreach ($allRequired as $type) {
            $rungs[] = [
                'type'    => $type,
                'label'   => self::VERIFICATION_LADDER[$type] ?? ucfirst(str_replace('_', ' ', $type)),
                'done'    => in_array($type, $have, true),
                'blocking'=> in_array($type, $missing, true),
            ];
        }

        return [
            'risk_tier'  => $riskTier,
            'risk_label' => $config?->label,
            'rungs'      => $rungs,
            'missing'    => array_values($missing),
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function identityStatus(string $providerId): string
    {
        $hasNrc = ProviderVerification::where('provider_id', $providerId)
            ->where('verification_type', 'nrc')
            ->where('status', 'VERIFIED')
            ->exists();

        return $hasNrc ? 'VERIFIED' : 'PENDING';
    }

    /** Advance the resume cursor to the step after the one just completed. */
    private function advance(ProviderProfile $profile, string $completed): ProviderProfile
    {
        $idx  = array_search($completed, self::STEPS, true);
        $next = $idx === false ? $completed : (self::STEPS[$idx + 1] ?? 'go_live');

        // Only move the cursor forward — never drag a returning user backwards.
        $currentIdx = array_search($profile->onboarding_step, self::STEPS, true);
        $nextIdx    = array_search($next, self::STEPS, true);
        if ($currentIdx === false || $nextIdx > $currentIdx) {
            $profile->onboarding_step = $next;
            $profile->save();
        }

        return $profile->fresh();
    }
}
