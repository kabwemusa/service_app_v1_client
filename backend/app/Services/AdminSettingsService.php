<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\PlatformSetting;
use App\Models\RiskTierConfig;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Platform Settings module (UI: admin/src/components/settings).
 *
 * Scope, deliberately bounded (see the Phase-3 build's scope decision):
 *   - `platform_settings` is a genuine new key-value store + audited override
 *     read path (SETTINGS registry below defines every key, its group, type,
 *     and the config/env value it defaults from).
 *   - risk_tier_configs is an EXISTING table (Phase 1) — the Verification tab
 *     edits it directly, live, no indirection needed.
 *   - What this does NOT do: thread the override values back into the actual
 *     runtime services (RankingService, CommissionService, dispatch config)
 *     — those still read config()/env() at boot. An edit here is recorded,
 *     audited, and displayed as the platform's target configuration; making
 *     it take effect live would mean touching Phase 1 domain services, which
 *     is out of scope for this build. Each setting's `live` flag reflects
 *     this honestly instead of implying every edit takes effect immediately.
 *   - Commission bands are edited in the Finance module (Category.commission_rates)
 *     — shown here read-only with a link, not re-implemented.
 */
class AdminSettingsService
{
    /** key => [group, type, default, label, live] */
    private const SETTINGS = [
        // ── General ──────────────────────────────────────────────────────────
        'payment_mode' => ['general', 'enum:DIRECT,ESCROW', 'ESCROW', 'Platform default payment mode', false],
        'accept_window_default_mins' => ['general', 'int', 15, 'Accept window — standard bookings (mins)', false],
        'accept_window_urgent_mins'  => ['general', 'int', 5, 'Accept window — urgent bookings (mins)', false],
        'autoconfirm_hours'          => ['general', 'int', 24, 'Auto-confirm window after provider marks done (hours)', false],
        'buyer_protection_rate'      => ['general', 'float', 0.02, 'Buyer protection fee rate', false],
        'buyer_protection_max_zmw'   => ['general', 'float', 50.0, 'Buyer protection fee cap (ZMW)', false],

        // ── Dispatch ─────────────────────────────────────────────────────────
        'fairness_shortlist_share' => ['dispatch', 'float', 0.20, 'Fairness floor — % of shortlist reserved for new providers', false],
        'fairness_probation_jobs'  => ['dispatch', 'int', 10, 'Probation window (jobs)', false],
        'geo_ring1_km' => ['dispatch', 'float', 5, 'Ring 1 radius (km)', false],
        'geo_ring2_km' => ['dispatch', 'float', 25, 'Ring 2 radius (km)', false],
        'geo_ring3_km' => ['dispatch', 'float', 100, 'Ring 3 radius (km) — beyond this is nationwide/remote', false],
        'cascade_depth_limit' => ['dispatch', 'int', 3, 'Max candidates before no-provider fallback', false],
        'trust_weight_tier_1' => ['dispatch', 'weights', ['identity' => 0.15, 'reliability' => 0.30, 'financial' => 0.20, 'ratings' => 0.35], 'Trust score weights — Tier 1', false],
        'trust_weight_tier_2' => ['dispatch', 'weights', ['identity' => 0.25, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.30], 'Trust score weights — Tier 2', false],
        'trust_weight_tier_3' => ['dispatch', 'weights', ['identity' => 0.40, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.15], 'Trust score weights — Tier 3', false],
        'trust_weight_tier_4' => ['dispatch', 'weights', ['identity' => 0.40, 'reliability' => 0.25, 'financial' => 0.20, 'ratings' => 0.15], 'Trust score weights — Tier 4', false],

        // ── Verification ─────────────────────────────────────────────────────
        'verification_sla_hours' => ['verification', 'int', 24, 'Verification SLA target (hours)', false],

        // ── Alerts (recorded routing config — no dispatcher reads this yet) ──
        'alert_no_provider_rate_pct' => ['alerts', 'float', 15.0, 'No-provider rate threshold (%)', false],
        'alert_pawapay_mismatch_count' => ['alerts', 'int', 5, 'PawaPay mismatch count threshold', false],
        'alert_cascade_depth_threshold' => ['alerts', 'int', 2, 'Cascade depth threshold', false],
        'alert_emergency_routing' => ['alerts', 'routing', ['roles' => ['trust_safety', 'super_admin'], 'channels' => ['in_app', 'email']], 'Emergency safety alert routing', false],
        'alert_no_provider_routing' => ['alerts', 'routing', ['roles' => ['analyst', 'super_admin'], 'channels' => ['in_app']], 'No-provider rate alert routing', false],
        'alert_pawapay_mismatch_routing' => ['alerts', 'routing', ['roles' => ['finance', 'super_admin'], 'channels' => ['in_app', 'email']], 'PawaPay mismatch alert routing', false],
    ];

    public function __construct(private readonly AuditedMutationService $audit) {}

    public function group(string $group): array
    {
        $keys = collect(self::SETTINGS)->filter(fn ($def) => $def[0] === $group);
        $stored = PlatformSetting::whereIn('key', $keys->keys())->get()->keyBy('key');

        return $keys->map(function ($def, $key) use ($stored) {
            [$g, $type, $default, $label, $live] = $def;
            return [
                'key'     => $key,
                'type'    => $type,
                'label'   => $label,
                'value'   => $stored->get($key)?->value ?? $default,
                'live'    => $live,
                'updated_at' => $stored->get($key)?->updated_at?->toIso8601String(),
            ];
        })->values()->all();
    }

    public function update(string $key, AdminUser $actor, mixed $value, string $reason): array
    {
        $def = self::SETTINGS[$key] ?? null;
        if (!$def) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Unknown setting key.');
        }

        [$group, $type] = $def;
        $this->validateValue($type, $value);

        $existing = PlatformSetting::find($key);
        $before = $existing?->value ?? $def[2];

        $this->audit->perform(
            actor: $actor,
            action: 'settings.update',
            targetType: 'platform_setting',
            targetId: $key,
            reason: $reason,
            metadata: ['before' => $before, 'after' => $value],
            mutation: fn () => PlatformSetting::updateOrCreate(
                ['key' => $key],
                ['group' => $group, 'value' => $value, 'updated_by' => $actor->id, 'updated_at' => now()],
            ),
        );

        return $this->group($group);
    }

    private function validateValue(string $type, mixed $value): void
    {
        $valid = match (true) {
            $type === 'int'   => is_numeric($value),
            $type === 'float' => is_numeric($value),
            str_starts_with($type, 'enum:') => in_array($value, explode(',', substr($type, 5)), true),
            $type === 'weights' => is_array($value)
                && abs(array_sum($value) - 1.0) < 0.01
                && array_diff(['identity', 'reliability', 'financial', 'ratings'], array_keys($value)) === [],
            $type === 'routing' => is_array($value) && isset($value['roles'], $value['channels']),
            default => true,
        };

        if (!$valid) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This value is not valid for the setting type. Weights must sum to 100%.');
        }
    }

    // ── Verification: risk tier requirements (existing table, live edit) ────────

    public function riskTiers(): array
    {
        return RiskTierConfig::orderBy('risk_tier')->get()->map(fn (RiskTierConfig $t) => [
            'risk_tier'    => $t->risk_tier,
            'label'        => $t->label,
            'requirements' => $t->eligibility_requirements,
            'description'  => $t->description,
        ])->all();
    }

    /**
     * @param array $requirements Nested by PROVIDER trust tier, e.g.
     *   ['tier_1' => ['nrc', 'momo_name_match'], 'tier_2' => [...], 'tier_3' => [...]]
     *   — the exact shape RealTrustEngine::checkEligibility() reads via
     *   RiskTierConfig::requirementsForTrustTier(). $riskTier here is the
     *   SERVICE risk category (1=remote, 2=public-venue, 3=in-home), a
     *   different axis from the provider trust tier keys inside the value.
     */
    public function updateRiskTier(int $riskTier, AdminUser $actor, array $requirements, string $reason): array
    {
        $tier = RiskTierConfig::where('risk_tier', $riskTier)->first();
        if (!$tier) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Unknown risk tier.');
        }

        foreach ($requirements as $tierKey => $docs) {
            if (!preg_match('/^tier_[1-4]$/', (string) $tierKey) || !is_array($docs)) {
                throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Requirements must be keyed by provider tier (tier_1..tier_4), each a list of document types.');
            }
        }

        $before = $tier->eligibility_requirements;

        $this->audit->perform(
            actor: $actor,
            action: 'settings.risk_tier_update',
            targetType: 'risk_tier_config',
            targetId: (string) $tier->id,
            reason: $reason,
            metadata: ['before' => $before, 'after' => $requirements],
            mutation: fn () => $tier->forceFill(['eligibility_requirements' => $requirements])->save(),
        );

        return $this->riskTiers();
    }

    // ── Denylist check config (read-only — reflects what's actually wired) ──────

    public function denylistCheckConfig(): array
    {
        return [
            'wired' => [
                ['signal' => 'NRC hash', 'checked_at' => 'KYC document submission'],
                ['signal' => 'Passport hash', 'checked_at' => 'KYC document submission'],
            ],
            'not_wired' => [
                ['signal' => 'Phone hash', 'reason' => 'Not checked at signup — phone is the single account key, so a denylisted phone cannot re-register under current rules.'],
                ['signal' => 'MoMo number hash', 'reason' => 'Not checked at payout setup.'],
                ['signal' => 'Device hash', 'reason' => 'No device fingerprinting is implemented anywhere in the app.'],
            ],
        ];
    }
}
