<?php

declare(strict_types=1);

namespace FlavourConnect\Middleware;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\JwtService;
use FlavourConnect\Utils\ResponseHelper;
use FlavourConnect\Exceptions\AuthException;

// ─────────────────────────────────────────────────────────────
// Auth Middleware — verifies JWT, loads user context
// Attached to routes that require authentication
// ─────────────────────────────────────────────────────────────

class AuthMiddleware
{
    private ?array $currentUser = null;

    public function __construct(
        private JwtService    $jwt,
        private Database      $db,
        private ResponseHelper $response
    ) {}

    /** Run authentication, set user context, return claims */
    public function authenticate(): array
    {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

        if (!str_starts_with($authHeader, 'Bearer ')) {
            $this->response->error('Authentication required', 401, 'AUTH_REQUIRED');
        }

        $token = substr($authHeader, 7);

        try {
            $claims = $this->jwt->verifyAccessToken($token);
        } catch (AuthException $e) {
            $this->response->error($e->getMessage(), $e->getCode(), $e->getErrorCode());
        }

        // Verify user still exists and is active
        $user = $this->db->queryOne(
            "SELECT id, email, role, full_name, is_active, is_online
             FROM users WHERE id = :id",
            ['id' => $claims['sub']]
        );

        if (!$user) {
            $this->response->error('User not found', 401, 'AUTH_USER_NOT_FOUND');
        }

        if (!$user['is_active']) {
            $this->response->error('Account is deactivated', 403, 'AUTH_ACCOUNT_INACTIVE');
        }

        // Verify role hasn't changed since token was issued
        if ($user['role'] !== $claims['role']) {
            $this->response->error('Token role mismatch', 401, 'AUTH_TOKEN_INVALID');
        }

        $this->currentUser = $user;
        return $claims;
    }

    /** Authenticate and enforce role requirement */
    public function requireRole(string|array $roles): array
    {
        $claims = $this->authenticate();

        $allowedRoles = is_array($roles) ? $roles : [$roles];

        if (!in_array($claims['role'], $allowedRoles, true)) {
            $this->response->error(
                'You do not have permission to perform this action',
                403,
                'FORBIDDEN_ROLE'
            );
        }

        return $claims;
    }

    public function getCurrentUser(): ?array
    {
        return $this->currentUser;
    }

    /** Check object-level ownership — prevents IDOR */
    public function requireOwnership(string $resourceOwnerId, string $currentUserId): void
    {
        if ($resourceOwnerId !== $currentUserId) {
            $this->response->error(
                'You do not have permission to access this resource',
                403,
                'FORBIDDEN_OWNERSHIP'
            );
        }
    }
}
