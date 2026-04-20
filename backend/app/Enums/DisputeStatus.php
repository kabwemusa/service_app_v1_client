<?php

namespace App\Enums;

enum DisputeStatus: string
{
    case OPEN               = 'OPEN';
    case UNDER_REVIEW       = 'UNDER_REVIEW';
    case AWAITING_EVIDENCE  = 'AWAITING_EVIDENCE';
    case RESOLVED_BUYER     = 'RESOLVED_BUYER';
    case RESOLVED_PROVIDER  = 'RESOLVED_PROVIDER';
    case RESOLVED_PARTIAL   = 'RESOLVED_PARTIAL';
    case WITHDRAWN          = 'WITHDRAWN';

    public function isResolved(): bool
    {
        return in_array($this, [
            self::RESOLVED_BUYER,
            self::RESOLVED_PROVIDER,
            self::RESOLVED_PARTIAL,
            self::WITHDRAWN,
        ], true);
    }

    public function isOpen(): bool
    {
        return in_array($this, [self::OPEN, self::UNDER_REVIEW, self::AWAITING_EVIDENCE], true);
    }
}
