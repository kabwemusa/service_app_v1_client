<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class OtpException extends ApiException
{
    public static function invalid(): static
    {
        return new static(ErrorCode::OTP_INVALID, 'The OTP you entered is incorrect.');
    }

    public static function expired(): static
    {
        return new static(ErrorCode::OTP_EXPIRED, 'Your OTP has expired. Please request a new one.');
    }
}
