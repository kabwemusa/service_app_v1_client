<?php

namespace App\Support;

/**
 * One-way hashing for fraud-denylist identifiers (§6.4 / §10.5).
 *
 * The denylist NEVER stores a raw phone/email/momo number — only the SHA-256
 * hash of the normalized value salted with a server-side pepper, so a match can
 * be made at signup/KYC without the platform retaining the plaintext.
 *
 * The pepper convention matches App\Services\KycService::hashDocNumber so a
 * denylist entry added here lines up with the hashes checked elsewhere.
 */
final class IdentifierHash
{
    /** Normalize then hash a value for the given denylist hash_type. */
    public static function for(string $hashType, string $raw): string
    {
        return self::hash(self::normalize($hashType, $raw));
    }

    /** Normalize a raw identifier so equivalent inputs hash identically. */
    public static function normalize(string $hashType, string $raw): string
    {
        $raw = trim($raw);

        return match ($hashType) {
            // Phone / mobile-money numbers: keep digits only so formatting
            // (+260, spaces, leading zero) doesn't change the hash.
            'PHONE_HASH', 'MOMO_NUMBER_HASH' => preg_replace('/\D+/', '', $raw),
            // Emails are case-insensitive.
            'EMAIL_HASH' => strtolower($raw),
            // Document numbers: strip spaces, uppercase.
            'NRC_HASH', 'PASSPORT_HASH' => strtoupper(preg_replace('/\s+/', '', $raw)),
            default => $raw,
        };
    }

    private static function hash(string $normalized): string
    {
        $pepper = config('app.kyc_hash_pepper', 'default-pepper');

        return hash('sha256', $normalized . $pepper);
    }
}
