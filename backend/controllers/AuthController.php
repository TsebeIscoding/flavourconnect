<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Services\AuthService;
use FlavourConnect\Utils\ResponseHelper;

// ─────────────────────────────────────────────────────────────
// AuthController — HTTP layer only
// No business logic here — delegates entirely to AuthService
// ─────────────────────────────────────────────────────────────

class AuthController
{
    public function __construct(
        private AuthService    $authService,
        private ResponseHelper $response
    ) {}

    public function register(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->authService->register($data);
        $this->response->success($result, 201);
    }

    public function login(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->authService->login($data);
        $this->response->success($result, 200);
    }

    public function refresh(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->authService->refresh($data);
        $this->response->success($result, 200);
    }

    public function logout(array $params, ?array $claims): never
    {
        $data = $this->parseBody();
        $this->authService->logout($data, $claims['sub']);
        $this->response->success(['message' => 'Logged out successfully']);
    }

    private function parseBody(): array
    {
        $raw = file_get_contents('php://input');
        if (empty($raw)) {
            return [];
        }

        $data = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->response->error('Invalid JSON body', 400, 'INVALID_JSON');
        }

        return $data ?? [];
    }
}
