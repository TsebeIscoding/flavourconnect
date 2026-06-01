<?php

declare(strict_types=1);

namespace FlavourConnect\Exceptions;

class AuthException extends \RuntimeException
{
    public function __construct(
        string $message,
        int $code = 401,
        private string $errorCode = 'AUTH_ERROR'
    ) {
        parent::__construct($message, $code);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }
}
