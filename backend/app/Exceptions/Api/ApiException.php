<?php

namespace App\Exceptions\Api;

use App\Enums\ErrorCode;
use RuntimeException;

class ApiException extends RuntimeException
{
    protected ErrorCode $errorCode;
    protected ?array $errors;

    public function __construct(
        ErrorCode $errorCode,
        string $message,
        ?array $errors = null,
    ) {
        parent::__construct($message);
        $this->errorCode = $errorCode;
        $this->errors    = $errors;
    }

    public function getErrorCode(): ErrorCode
    {
        return $this->errorCode;
    }

    public function getErrors(): ?array
    {
        return $this->errors;
    }

    public function getHttpStatus(): int
    {
        return $this->errorCode->httpStatus();
    }
}
