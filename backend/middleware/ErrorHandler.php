<?php

declare(strict_types=1);

namespace FlavourConnect\Middleware;

use FlavourConnect\Utils\ResponseHelper;
use FlavourConnect\Exceptions\AuthException;
use FlavourConnect\Exceptions\ValidationException;
use FlavourConnect\Exceptions\BusinessException;

// ─────────────────────────────────────────────────────────────
// ErrorHandler — Global exception/error catcher
// NEVER exposes stack traces to the client
// All internal details go to error_log only
// ─────────────────────────────────────────────────────────────

class ErrorHandler
{
    public function __construct(private ResponseHelper $response) {}

    public function handleException(\Throwable $e): never
    {
        // Log full detail internally
        $this->logException($e);

        // Map to safe client response
        if ($e instanceof ValidationException) {
            $this->response->validationError($e->getErrors());
        }

        if ($e instanceof AuthException) {
            $this->response->error($e->getMessage(), $e->getCode(), $e->getErrorCode());
        }

        if ($e instanceof BusinessException) {
            $this->response->error($e->getMessage(), $e->getCode(), $e->getErrorCode());
        }

        // PDO / Database errors
        if ($e instanceof \PDOException) {
            // Check for constraint violations and return meaningful errors
            $code = $e->getCode();
            if ($code === '23505') { // unique violation
                $this->response->error('A record with this value already exists', 409, 'CONFLICT');
            }
            if ($code === '23503') { // foreign key violation
                $this->response->error('Referenced resource does not exist', 422, 'INVALID_REFERENCE');
            }
            // Generic DB error — never expose query details
            $this->response->error('A database error occurred', 500, 'DB_ERROR');
        }

        // State machine violation from DB trigger
        if (str_contains($e->getMessage(), 'Invalid order status transition')) {
            $this->response->error('Invalid status transition', 422, 'ORDER_INVALID_TRANSITION');
        }

        // Generic runtime errors
        $statusCode = ($e->getCode() >= 400 && $e->getCode() < 600) ? $e->getCode() : 500;
        if ($statusCode === 503) {
            $this->response->error('Service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE');
        }

        // Catch-all — 500, never expose internal message
        $this->response->error('An internal error occurred', 500, 'INTERNAL_ERROR');
    }

    public function handleError(int $errno, string $errstr, string $errfile, int $errline): bool
    {
        if (!(error_reporting() & $errno)) {
            return false;
        }
        $this->logRaw("PHP Error [{$errno}]: {$errstr} in {$errfile}:{$errline}");
        return true;
    }

    private function logException(\Throwable $e): void
    {
        $context = [
            'exception' => get_class($e),
            'message'   => $e->getMessage(),
            'code'      => $e->getCode(),
            'file'      => $e->getFile(),
            'line'      => $e->getLine(),
            'trace'     => $e->getTraceAsString(),
            'url'       => $_SERVER['REQUEST_URI'] ?? '',
            'method'    => $_SERVER['REQUEST_METHOD'] ?? '',
            'ip'        => $_SERVER['REMOTE_ADDR'] ?? '',
        ];

        error_log('[FlavourConnect] ' . json_encode($context));
    }

    private function logRaw(string $message): void
    {
        error_log('[FlavourConnect] ' . $message);
    }
}
