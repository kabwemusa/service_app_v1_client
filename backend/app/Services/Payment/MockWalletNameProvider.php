<?php

namespace App\Services\Payment;

use App\Contracts\WalletNameLookupInterface;
use Illuminate\Support\Facades\DB;

/**
 * Development stand-in for the aggregator's wallet-name API: resolves the
 * registered name as the legal name of whichever user owns that MoMo number
 * on the platform, so dev KYC flows pass naturally. Swap for the real
 * aggregator client in production (MTN MoMo `accountholder` basic-info API).
 */
class MockWalletNameProvider implements WalletNameLookupInterface
{
    public function lookupName(string $momoProvider, string $momoNumber): ?string
    {
        try {
            $row = DB::selectOne("
                SELECT u.legal_name
                FROM   provider_profiles pp
                JOIN   users u ON u.id = pp.user_id
                WHERE  pp.momo_number = ?
                LIMIT  1
            ", [$momoNumber]);

            return $row?->legal_name;
        } catch (\Throwable) {
            return null;
        }
    }
}
