<?php

namespace App\Enums;

enum AccountState: string
{
    case ACTIVE          = 'ACTIVE';
    case RESTRICTED      = 'RESTRICTED';
    case SUSPENDED       = 'SUSPENDED';
    case BANNED          = 'BANNED';
    case PENDING_CLOSURE = 'PENDING_CLOSURE';

    public function canBook(): bool
    {
        return $this === self::ACTIVE;
    }

    public function canBrowse(): bool
    {
        return in_array($this, [self::ACTIVE, self::RESTRICTED], true);
    }
}
