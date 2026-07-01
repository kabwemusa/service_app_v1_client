<?php

namespace App\Support;

/**
 * Canonical Zambian phone-number normalizer.
 *
 * Phone is the single identity key across WhatsApp, the PWA, and any future
 * native client (TRANSFORMATION_PLAN — identity rule). Every surface that
 * resolves an account by phone MUST normalize through here first so that
 *   +260 97 123 4567 / 0971234567 / 971234567 / 260971234567
 * all collapse to one canonical E.164 string and therefore one account.
 *
 * Mirrors the digit handling already used in MtnMomoClient / PawapayPaymentGateway,
 * but returns E.164 (+260XXXXXXXXX) which is what we store on users.phone.
 */
final class PhoneNumber
{
    /** Zambian country calling code. */
    private const CC = '260';

    /**
     * Normalize any accepted Zambian input to E.164 (+260XXXXXXXXX), or null
     * when the input cannot be a valid Zambian mobile number.
     *
     *   +260971234567  → +260971234567
     *    260971234567  → +260971234567
     *      0971234567  → +260971234567
     *       971234567  → +260971234567  (bare 9-digit subscriber number)
     */
    public static function normalize(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $raw) ?? '';

        if ($digits === '') {
            return null;
        }

        // Strip a leading 260 country code if present, else a trunk 0.
        if (str_starts_with($digits, self::CC)) {
            $subscriber = substr($digits, strlen(self::CC));
        } elseif (str_starts_with($digits, '0')) {
            $subscriber = substr($digits, 1);
        } else {
            $subscriber = $digits;
        }

        // Zambian mobile subscriber numbers are 9 digits and begin with 7 or 9.
        if (strlen($subscriber) !== 9 || ! in_array($subscriber[0], ['7', '9'], true)) {
            return null;
        }

        return '+' . self::CC . $subscriber;
    }

    /** True when the input normalizes to a valid Zambian E.164 number. */
    public static function isValid(?string $raw): bool
    {
        return self::normalize($raw) !== null;
    }

    /**
     * The trailing 9-digit subscriber number — the stable key for matching a
     * WhatsApp wa_id (which arrives without a + and may carry extra prefixing)
     * against a stored phone. Falls back to the last 9 raw digits when the
     * input isn't a clean Zambian number, mirroring the existing WhatsApp
     * `substr($wa_id, -9)` lookup. Returns null when there are no digits.
     */
    public static function subscriber(?string $raw): ?string
    {
        $e164 = self::normalize($raw);
        if ($e164 !== null) {
            return substr($e164, -9);
        }

        $digits = preg_replace('/\D+/', '', (string) $raw) ?? '';

        return $digits === '' ? null : substr($digits, -9);
    }
}
