<?php

namespace App\Enums;

enum UserRole: string
{
    case CUSTOMER  = 'CUSTOMER';
    case PROVIDER  = 'PROVIDER';
    case ADMIN     = 'ADMIN';
    case MODERATOR = 'MODERATOR';

    public function isStaff(): bool
    {
        return in_array($this, [self::ADMIN, self::MODERATOR], true);
    }

    public function canResolveDisputes(): bool
    {
        return in_array($this, [self::ADMIN, self::MODERATOR], true);
    }

    public function canIssuePayout(): bool
    {
        return $this === self::ADMIN;
    }
}
