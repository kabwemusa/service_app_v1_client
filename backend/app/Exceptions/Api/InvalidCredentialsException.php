<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class InvalidCredentialsException extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::INVALID_CREDENTIALS, 'The provided credentials are incorrect.');
    }
}
