<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;

class NotFoundException extends ApiException
{
    public function __construct(string $resource = 'Resource')
    {
        parent::__construct(ErrorCode::NOT_FOUND, "{$resource} not found.");
    }
}
