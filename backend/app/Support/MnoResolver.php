<?php

namespace App\Support;

/**
 * Resolves a Zambian mobile number to its network operator from the prefix map
 * in config/lipila.php. Used for admin-facing MNO grouping only (Finance escrow
 * reconciliation, WhatsApp Ops delivery health) — never for payment routing:
 * Lipila derives the operator from the MSISDN itself and reports it back as
 * `paymentType`, so the gateway never consults this.
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

        $operator = config('lipila.prefix_map', [])[$prefix] ?? null;

        return match (strtolower((string) $operator)) {
            'mtn'    => 'MTN',
            'airtel' => 'AIRTEL',
            'zamtel' => 'ZAMTEL',
            default  => 'UNKNOWN',
        };
    }
}
