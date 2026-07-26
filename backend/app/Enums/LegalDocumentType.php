<?php

namespace App\Enums;

/**
 * The three agreements in the Sebenza legal layer. Values are the stable keys
 * used across the API, both clients and the consent audit — do not rename once
 * a version has been consented to.
 */
enum LegalDocumentType: string
{
    case TERMS_OF_SERVICE = 'terms_of_service';
    case PRIVACY_POLICY   = 'privacy_policy';
    case USER_AGREEMENT   = 'user_agreement';

    /** All three are REQUIRED to use Sebenza at all (brief §A). */
    public static function required(): array
    {
        return [self::TERMS_OF_SERVICE, self::PRIVACY_POLICY, self::USER_AGREEMENT];
    }

    public function label(): string
    {
        return match ($this) {
            self::TERMS_OF_SERVICE => 'Terms of Service',
            self::PRIVACY_POLICY   => 'Privacy Policy',
            self::USER_AGREEMENT   => 'User Agreement',
        };
    }
}
