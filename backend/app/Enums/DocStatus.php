<?php

namespace App\Enums;

enum DocStatus: string
{
    case SUBMITTED     = 'SUBMITTED';
    case AUTO_APPROVED = 'AUTO_APPROVED';
    case AUTO_REJECTED = 'AUTO_REJECTED';
    case MANUAL_REVIEW = 'MANUAL_REVIEW';
    case APPROVED      = 'APPROVED';
    case REJECTED      = 'REJECTED';
    case EXPIRED       = 'EXPIRED';

    public function isPassed(): bool
    {
        return in_array($this, [self::AUTO_APPROVED, self::APPROVED], true);
    }

    public function isFailed(): bool
    {
        return in_array($this, [self::AUTO_REJECTED, self::REJECTED], true);
    }

    public function isPending(): bool
    {
        return in_array($this, [self::SUBMITTED, self::MANUAL_REVIEW], true);
    }
}
