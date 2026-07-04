<?php

namespace App\Support;

/**
 * Resolves a Zambian mobile number to its network operator using the same
 * prefix map PawapayPaymentGateway uses to pick a MoMo correspondent
 * (config/pawapay.php). Used for admin-facing MNO grouping only (Finance
 * escrow reconciliation, WhatsApp Ops delivery health) — never for payment
 * routing, which stays inside the gateway.
 */
final class MnoResolver
{
    /** @return 'MTN'|'AIRTEL'|'ZAMTEL'|'UNKNOWN' */
    public static function forPhone(?string $phone): string
    {
        if (! $phone) {
            return 'UNKNOWN';
        }

        $digits = preg_replace('/\D/', '', $phone);
        if (strlen($digits) < 9) {
            return 'UNKNOWN';
        }

        // Last 9 digits are the local subscriber number regardless of prefix
        // (260, +260, or a bare 0-leading local number).
        $local  = substr($digits, -9);
        $prefix = '0' . substr($local, 0, 2);

        $map = config('pawapay.prefix_map', []);
        $correspondent = $map[$prefix] ?? null;

        return match (true) {
            $correspondent === null => 'UNKNOWN',
            str_starts_with($correspondent, 'MTN')    => 'MTN',
            str_starts_with($correspondent, 'AIRTEL') => 'AIRTEL',
            str_starts_with($correspondent, 'ZAMTEL')  => 'ZAMTEL',
            default => 'UNKNOWN',
        };
    }
}
