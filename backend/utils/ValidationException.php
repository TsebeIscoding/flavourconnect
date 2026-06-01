<?php

declare(strict_types=1);

namespace FlavourConnect\Exceptions;

class ValidationException extends \RuntimeException
{
    public function __construct(private array $errors)
    {
        parent::__construct('Validation failed', 400);
    }

    public function getErrors(): array
    {
        return $this->errors;
    }
}
