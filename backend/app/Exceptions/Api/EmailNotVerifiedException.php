<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class EmailNotVerifiedException extends ApiException
{
    public function __construct(string $userId)
    {
        parent::__construct(
            ErrorCode::EMAIL_NOT_VERIFIED,
            'Your email address has not been verified. A new OTP has been sent.',
            ['user_id' => $userId],
        );
    }
}
