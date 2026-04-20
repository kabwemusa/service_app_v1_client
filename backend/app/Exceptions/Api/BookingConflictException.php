<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class BookingConflictException extends ApiException
{
    public function __construct(string $reason = 'The requested time slot is not available.')
    {
        parent::__construct(ErrorCode::BOOKING_CONFLICT, $reason);
    }
}
