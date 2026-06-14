<?php

namespace App\Contracts;

/**
 * v3.2 §4.3 — registered mobile-money wallet name lookup.
 *
 * Zambian MNOs perform NRC-backed KYC for SIM/wallet registration under
 * ZICTA/BoZ rules, so the registered wallet name is a second, independent,
 * government-ID-anchored identity signal — one API field, no document scan.
 */
interface WalletNameLookupInterface
{
    /**
     * The account-holder name registered with the aggregator, or null when
     * the lookup is unavailable (absence of data must never block KYC).
     *
     * @param string $momoProvider MTN | AIRTEL | ZAMTEL
     */
    public function lookupName(string $momoProvider, string $momoNumber): ?string;
}
