<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class ConflictException extends ApiException
{
    public function __construct(string $message = 'A conflict occurred.')
    {
        parent::__construct(ErrorCode::CONFLICT, $message);
    }
}
