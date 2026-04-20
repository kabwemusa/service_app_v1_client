<?php

namespace App\Enums;

enum SubscriptionPlan: string
{
    case FREE  = 'FREE';
    case PRO   = 'PRO';
    case ELITE = 'ELITE';

    public function monthlyFeeZmw(): float
    {
        return match($this) {
            self::FREE  => 0.00,
            self::PRO   => 149.00,
            self::ELITE => 449.00,
        };
    }

    public function commissionDiscount(): float
    {
        return match($this) {
            self::FREE  => 0.00,
            self::PRO   => 0.02,
            self::ELITE => 0.04,
        };
    }

    public function promotedSlotsPerMonth(): int
    {
        return match($this) {
            self::FREE  => 0,
            self::PRO   => 1,
            self::ELITE => 3,
        };
    }
}
