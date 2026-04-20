<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class ForbiddenException extends ApiException
{
    public function __construct(string $message = 'You are not authorized to perform this action.')
    {
        parent::__construct(ErrorCode::FORBIDDEN, $message);
    }
}
