<?php

namespace Tests\Feature\Settings;

use App\Models\PlatformSetting;
use App\Services\CommissionService;
use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * § ADM-1 / CFG — an admin settings override must actually change runtime
 * behavior (buyer-protection fee), and the read-through cache must reflect the
 * new value after a flush. Also proves commission reads config, not env-at-runtime.
 */
class SettingsPropagationTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_protection_rate_override_changes_the_fee(): void
    {
        $commission = app(CommissionService::class);

        // Default 2% of 1000 = 20.
        $this->assertSame(20.0, $commission->buyerProtectionFee(1000.0));

        // Admin raises the rate to 5% → fee becomes 50 (still under the 50 cap).
        PlatformSetting::updateOrCreate(['key' => 'buyer_protection_rate'], ['group' => 'general', 'value' => 0.05]);
        Settings::flush();

        $this->assertSame(50.0, $commission->buyerProtectionFee(1000.0));
    }

    public function test_buyer_protection_cap_override_is_honoured(): void
    {
        $commission = app(CommissionService::class);

        // 2% of 10000 = 200, capped at the default 50.
        $this->assertSame(50.0, $commission->buyerProtectionFee(10000.0));

        PlatformSetting::updateOrCreate(['key' => 'buyer_protection_max_zmw'], ['group' => 'general', 'value' => 120]);
        Settings::flush();

        // Now capped at 120.
        $this->assertSame(120.0, $commission->buyerProtectionFee(10000.0));
    }

    public function test_commission_reads_config_defaults(): void
    {
        // Sanity: with no overrides, the config-driven defaults are in effect.
        $this->assertSame(0.02, (float) config('commission.buyer_protection_rate'));
        $this->assertSame(0.16, (float) config('commission.vat_rate'));
        $this->assertSame(0.18, (float) config('commission.tier_rates.1'));
    }
}
