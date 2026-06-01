<?php

declare(strict_types=1);

namespace FlavourConnect\Exceptions;

class BusinessException extends \RuntimeException
{
    public function __construct(
        string $message,
        int $code = 422,
        private string $errorCode = 'BUSINESS_ERROR'
    ) {
        parent::__construct($message, $code);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }
}
