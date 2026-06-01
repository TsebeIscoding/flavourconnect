<?php

declare(strict_types=1);

namespace FlavourConnect\Middleware;

use FlavourConnect\Utils\ResponseHelper;

// ─────────────────────────────────────────────────────────────
// CORS Middleware — strict whitelist, no wildcards
// ─────────────────────────────────────────────────────────────

class CorsMiddleware
{
    private array $allowedOrigins;
    private array $allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
    private array $allowedHeaders = [
        'Content-Type',
        'Authorization',
        'X-Request-ID',
        'Accept',
    ];

    public function __construct(private ResponseHelper $response)
    {
        // Load from env — comma-separated list of allowed origins
        $origins = $_ENV['CORS_ALLOWED_ORIGINS'] ?? 'https://flavourconnect.com';
        $this->allowedOrigins = array_map('trim', explode(',', $origins));
    }

    public function handle(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

        // Validate origin against strict whitelist
        if ($origin !== '' && !in_array($origin, $this->allowedOrigins, true)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => ['code' => 'CORS_DENIED', 'message' => 'Origin not allowed']]);
            exit;
        }

        if ($origin !== '') {
            header("Access-Control-Allow-Origin: {$origin}");
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
        }

        header('Access-Control-Allow-Methods: ' . implode(', ', $this->allowedMethods));
        header('Access-Control-Allow-Headers: ' . implode(', ', $this->allowedHeaders));
        header('Access-Control-Max-Age: 86400');

        // Handle preflight
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }
}
