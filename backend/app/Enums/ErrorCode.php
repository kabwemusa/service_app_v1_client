<?php

namespace App\Enums;

enum ErrorCode: string
{
    // Auth
    case VALIDATION_ERROR      = 'VALIDATION_ERROR';
    case INVALID_CREDENTIALS   = 'INVALID_CREDENTIALS';
    case EMAIL_NOT_VERIFIED    = 'EMAIL_NOT_VERIFIED';
    case OTP_INVALID           = 'OTP_INVALID';
    case OTP_EXPIRED           = 'OTP_EXPIRED';
    case UNAUTHENTICATED       = 'UNAUTHENTICATED';
    case FORBIDDEN             = 'FORBIDDEN';
    case NOT_FOUND             = 'NOT_FOUND';
    case CONFLICT              = 'CONFLICT';
    case PASSWORD_COMPROMISED  = 'PASSWORD_COMPROMISED';  // v3: HIBP check failed
    case STEP_UP_REQUIRED      = 'STEP_UP_REQUIRED';      // v3: action needs fresh OTP

    // Booking & scheduling
    case BOOKING_CONFLICT      = 'BOOKING_CONFLICT';

    // Payment
    case PAYMENT_FAILED        = 'PAYMENT_FAILED';

    // KYC & identity
    case KYC_LOW_QUALITY       = 'KYC_LOW_QUALITY';       // v3: image too blurry/dark
    case KYC_LIVENESS_FAILED   = 'KYC_LIVENESS_FAILED';   // v3: face match < threshold
    case DUPLICATE_IDENTITY    = 'DUPLICATE_IDENTITY';    // v3: NRC/passport already on another account
    case DENYLIST_MATCH        = 'DENYLIST_MATCH';        // v3: hash in fraud_denylist

    // Trust tiers
    case TIER_EXCEEDED         = 'TIER_EXCEEDED';         // v3: booking value above tier cap

    // Account state
    case ACCOUNT_RESTRICTED    = 'ACCOUNT_RESTRICTED';    // v3: account in RESTRICTED state
    case ACCOUNT_SUSPENDED     = 'ACCOUNT_SUSPENDED';     // v3: account in SUSPENDED state

    // Server
    case SERVER_ERROR          = 'SERVER_ERROR';

    public function httpStatus(): int
    {
        return match($this) {
            self::VALIDATION_ERROR    => 422,
            self::INVALID_CREDENTIALS => 401,
            self::EMAIL_NOT_VERIFIED  => 403,
            self::OTP_INVALID         => 422,
            self::OTP_EXPIRED         => 422,
            self::UNAUTHENTICATED     => 401,
            self::FORBIDDEN           => 403,
            self::NOT_FOUND           => 404,
            self::CONFLICT            => 409,
            self::PASSWORD_COMPROMISED => 422,
            self::STEP_UP_REQUIRED    => 403,
            self::BOOKING_CONFLICT    => 409,
            self::PAYMENT_FAILED      => 402,
            self::KYC_LOW_QUALITY     => 422,
            self::KYC_LIVENESS_FAILED => 422,
            self::DUPLICATE_IDENTITY  => 409,
            self::DENYLIST_MATCH      => 403,
            self::TIER_EXCEEDED       => 403,
            self::ACCOUNT_RESTRICTED  => 403,
            self::ACCOUNT_SUSPENDED   => 403,
            self::SERVER_ERROR        => 500,
        };
    }
}
