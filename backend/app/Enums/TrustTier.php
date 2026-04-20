<?php

namespace App\Enums;

enum TrustTier: int
{
    case UNVERIFIED   = 0;
    case BASIC        = 1;
    case IDENTIFIED   = 2;
    case VERIFIED     = 3;
    case PROFESSIONAL = 4;

    public function jobCapZmw(): ?float
    {
        return match($this) {
            self::UNVERIFIED   => null,
            self::BASIC        => 300.00,
            self::IDENTIFIED   => 2000.00,
            self::VERIFIED     => 10000.00,
            self::PROFESSIONAL => null,  // no cap
        };
    }

    public function weeklyCapZmw(): ?float
    {
        return match($this) {
            self::UNVERIFIED   => null,
            self::BASIC        => 1500.00,
            self::IDENTIFIED   => 10000.00,
            self::VERIFIED     => 50000.00,
            self::PROFESSIONAL => null,
        };
    }

    public function payoutHoldHours(): int
    {
        return match($this) {
            self::UNVERIFIED   => 72,
            self::BASIC        => 72,
            self::IDENTIFIED   => 48,
            self::VERIFIED     => 24,
            self::PROFESSIONAL => 12,
        };
    }

    public function canSell(): bool
    {
        return $this->value >= self::BASIC->value;
    }

    public function hasInstantPayout(): bool
    {
        return $this->value >= self::VERIFIED->value;
    }

    public function canPromote(): bool
    {
        return $this->value >= self::VERIFIED->value;
    }

    public function label(): string
    {
        return match($this) {
            self::UNVERIFIED   => 'Unverified',
            self::BASIC        => 'Basic',
            self::IDENTIFIED   => 'Identified',
            self::VERIFIED     => 'Verified',
            self::PROFESSIONAL => 'Professional',
        };
    }
}
