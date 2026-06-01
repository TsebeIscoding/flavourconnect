<?php

declare(strict_types=1);

namespace FlavourConnect\Utils;

use FlavourConnect\Exceptions\ValidationException;

// ─────────────────────────────────────────────────────────────
// Validator — ALL input validated before business logic
// Never trust frontend data
// ─────────────────────────────────────────────────────────────

class Validator
{
    private array $errors = [];
    private array $data   = [];

    public function __construct(array $data)
    {
        // Strip null bytes and control characters from strings
        $this->data = $this->sanitize($data);
    }

    public static function make(array $data, array $rules): self
    {
        $v = new self($data);
        $v->validate($rules);
        return $v;
    }

    public function validate(array $rules): void
    {
        foreach ($rules as $field => $ruleSet) {
            $fieldRules = is_string($ruleSet) ? explode('|', $ruleSet) : $ruleSet;
            $value      = $this->data[$field] ?? null;

            foreach ($fieldRules as $rule) {
                $this->applyRule($field, $value, $rule);
            }
        }

        if (!empty($this->errors)) {
            throw new ValidationException($this->errors);
        }
    }

    public function validated(): array
    {
        return $this->data;
    }

    private function applyRule(string $field, mixed $value, string $rule): void
    {
        if (str_contains($rule, ':')) {
            [$ruleName, $param] = explode(':', $rule, 2);
        } else {
            $ruleName = $rule;
            $param    = null;
        }

        match ($ruleName) {
            'required' => $this->ruleRequired($field, $value),
            'string'   => $this->ruleString($field, $value),
            'email'    => $this->ruleEmail($field, $value),
            'min'      => $this->ruleMin($field, $value, (int)$param),
            'max'      => $this->ruleMax($field, $value, (int)$param),
            'numeric'  => $this->ruleNumeric($field, $value),
            'positive' => $this->rulePositive($field, $value),
            'integer'  => $this->ruleInteger($field, $value),
            'boolean'  => $this->ruleBoolean($field, $value),
            'uuid'     => $this->ruleUuid($field, $value),
            'in'       => $this->ruleIn($field, $value, explode(',', $param ?? '')),
            'nullable' => null, // always passes
            'array'    => $this->ruleArray($field, $value),
            'password' => $this->rulePassword($field, $value),
            default    => null,
        };
    }

    private function ruleRequired(string $field, mixed $value): void
    {
        if ($value === null || $value === '') {
            $this->addError($field, "{$field} is required");
        }
    }

    private function ruleString(string $field, mixed $value): void
    {
        if ($value !== null && !is_string($value)) {
            $this->addError($field, "{$field} must be a string");
        }
    }

    private function ruleEmail(string $field, mixed $value): void
    {
        if ($value !== null && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
            $this->addError($field, "{$field} must be a valid email address");
        }
    }

    private function ruleMin(string $field, mixed $value, int $min): void
    {
        if ($value === null) return;
        if (is_string($value) && mb_strlen($value) < $min) {
            $this->addError($field, "{$field} must be at least {$min} characters");
        } elseif (is_numeric($value) && (float)$value < $min) {
            $this->addError($field, "{$field} must be at least {$min}");
        }
    }

    private function ruleMax(string $field, mixed $value, int $max): void
    {
        if ($value === null) return;
        if (is_string($value) && mb_strlen($value) > $max) {
            $this->addError($field, "{$field} must not exceed {$max} characters");
        } elseif (is_numeric($value) && (float)$value > $max) {
            $this->addError($field, "{$field} must not exceed {$max}");
        }
    }

    private function ruleNumeric(string $field, mixed $value): void
    {
        if ($value !== null && !is_numeric($value)) {
            $this->addError($field, "{$field} must be numeric");
        }
    }

    private function rulePositive(string $field, mixed $value): void
    {
        if ($value !== null && is_numeric($value) && (float)$value <= 0) {
            $this->addError($field, "{$field} must be greater than 0");
        }
    }

    private function ruleInteger(string $field, mixed $value): void
    {
        if ($value !== null && filter_var($value, FILTER_VALIDATE_INT) === false) {
            $this->addError($field, "{$field} must be an integer");
        }
    }

    private function ruleBoolean(string $field, mixed $value): void
    {
        if ($value !== null && !is_bool($value) && !in_array($value, [0, 1, '0', '1'], true)) {
            $this->addError($field, "{$field} must be true or false");
        }
    }

    private function ruleUuid(string $field, mixed $value): void
    {
        $pattern = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
        if ($value !== null && !preg_match($pattern, (string)$value)) {
            $this->addError($field, "{$field} must be a valid UUID");
        }
    }

    private function ruleIn(string $field, mixed $value, array $options): void
    {
        if ($value !== null && !in_array($value, $options, true)) {
            $this->addError($field, "{$field} must be one of: " . implode(', ', $options));
        }
    }

    private function ruleArray(string $field, mixed $value): void
    {
        if ($value !== null && !is_array($value)) {
            $this->addError($field, "{$field} must be an array");
        }
    }

    private function rulePassword(string $field, mixed $value): void
    {
        if ($value === null) return;
        // Minimum 8 chars, at least one uppercase, one lowercase, one number, one special
        if (!preg_match('/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/', (string)$value)) {
            $this->addError($field, "{$field} must be at least 8 characters with uppercase, lowercase, number, and special character");
        }
    }

    private function addError(string $field, string $message): void
    {
        $this->errors[$field][] = $message;
    }

    private function sanitize(array $data): array
    {
        $clean = [];
        foreach ($data as $key => $value) {
            if (is_string($value)) {
                // Remove null bytes and control chars (except tab/newline)
                $clean[$key] = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value);
            } elseif (is_array($value)) {
                $clean[$key] = $this->sanitize($value);
            } else {
                $clean[$key] = $value;
            }
        }
        return $clean;
    }
}
