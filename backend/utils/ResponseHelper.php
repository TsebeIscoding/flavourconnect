<?php

declare(strict_types=1);

namespace FlavourConnect\Utils;

// ─────────────────────────────────────────────────────────────
// ResponseHelper — All JSON responses go through here
// Ensures consistent envelope, proper HTTP codes
// NEVER exposes stack traces or internal errors
// ─────────────────────────────────────────────────────────────

class ResponseHelper
{
    public function success(mixed $data, int $status = 200, array $meta = []): never
    {
        $this->send([
            'success' => true,
            'data'    => $data,
            'error'   => null,
            'meta'    => array_merge($this->defaultMeta(), $meta),
        ], $status);
    }

    public function error(string $message, int $status = 400, string $code = 'ERROR', array $meta = []): never
    {
        $this->send([
            'success' => false,
            'data'    => null,
            'error'   => [
                'code'    => $code,
                'message' => $message,
            ],
            'meta'    => array_merge($this->defaultMeta(), $meta),
        ], $status);
    }

    public function validationError(array $errors): never
    {
        $this->send([
            'success' => false,
            'data'    => null,
            'error'   => [
                'code'    => 'VALIDATION_FAILED',
                'message' => 'The provided data is invalid',
                'fields'  => $errors,
            ],
            'meta'    => $this->defaultMeta(),
        ], 400);
    }

    private function defaultMeta(): array
    {
        return [
            'timestamp'  => date('c'),
            'request_id' => $_SERVER['HTTP_X_REQUEST_ID'] ?? bin2hex(random_bytes(8)),
        ];
    }

    private function send(array $body, int $status): never
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }
}
