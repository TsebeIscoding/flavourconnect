<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\JwtService;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\AuthException;
use FlavourConnect\Exceptions\BusinessException;

// ─────────────────────────────────────────────────────────────
// AuthService — All authentication business logic
// Passwords: Argon2id only
// Tokens: JWT access + hashed refresh with rotation
// ─────────────────────────────────────────────────────────────

class AuthService
{
    public function __construct(
        private Database   $db,
        private JwtService $jwt
    ) {}

    // ── REGISTER ───────────────────────────────────────────────

    public function register(array $data): array
    {
        Validator::make($data, [
            'email'     => 'required|email|max:255',
            'password'  => 'required|password',
            'full_name' => 'required|string|min:2|max:255',
            'role'      => 'required|in:customer,vendor,driver',
            'phone'     => 'nullable|string|max:30',
        ]);

        // Drivers must provide phone
        if ($data['role'] === 'driver' && empty($data['phone'])) {
            throw new BusinessException('Phone number is required for drivers', 422, 'VALIDATION_FAILED');
        }

        // Check email uniqueness
        $existing = $this->db->queryOne(
            "SELECT id FROM users WHERE email = :email",
            ['email' => strtolower(trim($data['email']))]
        );

        if ($existing) {
            throw new BusinessException('An account with this email already exists', 409, 'CONFLICT_EMAIL_EXISTS');
        }

        // Hash password with Argon2id (PHP uses unique salt automatically)
        $passwordHash = password_hash($data['password'], PASSWORD_ARGON2ID, [
            'memory_cost' => 65536, // 64 MB
            'time_cost'   => 4,
            'threads'     => 2,
        ]);

        $this->db->beginTransaction();
        try {
            $user = $this->db->insert(
                "INSERT INTO users (email, password_hash, role, full_name, phone)
                 VALUES (:email, :hash, :role, :name, :phone)",
                [
                    'email' => strtolower(trim($data['email'])),
                    'hash'  => $passwordHash,
                    'role'  => $data['role'],
                    'name'  => trim($data['full_name']),
                    'phone' => $data['phone'] ?? null,
                ]
            );

            // If vendor, create restaurant placeholder
            if ($data['role'] === 'vendor') {
                $this->db->insert(
                    "INSERT INTO restaurants (vendor_id, name, address, phone)
                     VALUES (:vendor_id, :name, :address, :phone)",
                    [
                        'vendor_id' => $user['id'],
                        'name'      => trim($data['full_name']) . "'s Restaurant",
                        'address'   => 'To be configured',
                        'phone'     => $data['phone'] ?? 'To be configured',
                    ]
                );
            }

            $tokens = $this->issueTokens($user);
            $this->db->commit();

            return ['user' => $this->safeUser($user)] + $tokens;
        } catch (\Throwable $e) {
            $this->db->rollback();
            throw $e;
        }
    }

    // ── LOGIN ──────────────────────────────────────────────────

    public function login(array $data): array
    {
        Validator::make($data, [
            'email'    => 'required|email',
            'password' => 'required|string',
        ]);

        $user = $this->db->queryOne(
            "SELECT id, email, password_hash, role, full_name, is_active
             FROM users WHERE email = :email",
            ['email' => strtolower(trim($data['email']))]
        );

        // Use constant-time comparison to prevent timing attacks
        // Always run password_verify even if user not found
        $hash = $user['password_hash'] ?? '$argon2id$v=19$m=65536,t=4,p=2$dummy$dummy';
        $valid = password_verify($data['password'], $hash);

        if (!$user || !$valid) {
            throw new AuthException('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
        }

        if (!$user['is_active']) {
            throw new AuthException('Your account has been deactivated', 403, 'AUTH_ACCOUNT_INACTIVE');
        }

        $tokens = $this->issueTokens($user);

        return ['user' => $this->safeUser($user)] + $tokens;
    }

    // ── REFRESH ────────────────────────────────────────────────

    public function refresh(array $data): array
    {
        Validator::make($data, [
            'refresh_token' => 'required|string',
        ]);

        $rawToken  = $data['refresh_token'];
        $tokenHash = $this->jwt->hashRefreshToken($rawToken);

        // Find valid, non-revoked refresh token
        $record = $this->db->queryOne(
            "SELECT rt.id, rt.user_id, rt.revoked, rt.expires_at, u.role, u.is_active, u.email, u.full_name
             FROM refresh_tokens rt
             JOIN users u ON u.id = rt.user_id
             WHERE rt.token_hash = :hash",
            ['hash' => $tokenHash]
        );

        if (!$record) {
            throw new AuthException('Invalid refresh token', 401, 'AUTH_TOKEN_INVALID');
        }

        if ($record['revoked']) {
            // Token reuse detected — revoke all tokens for this user (security response)
            $this->db->execute(
                "UPDATE refresh_tokens SET revoked = true WHERE user_id = :uid",
                ['uid' => $record['user_id']]
            );
            throw new AuthException('Refresh token reuse detected. Please log in again.', 401, 'AUTH_REFRESH_REVOKED');
        }

        if (new \DateTime($record['expires_at']) < new \DateTime()) {
            throw new AuthException('Refresh token expired', 401, 'AUTH_TOKEN_EXPIRED');
        }

        if (!$record['is_active']) {
            throw new AuthException('Account deactivated', 403, 'AUTH_ACCOUNT_INACTIVE');
        }

        $this->db->beginTransaction();
        try {
            // Rotate: revoke old, issue new
            $this->db->execute(
                "UPDATE refresh_tokens SET revoked = true WHERE id = :id",
                ['id' => $record['id']]
            );

            $user = [
                'id'        => $record['user_id'],
                'role'      => $record['role'],
                'email'     => $record['email'],
                'full_name' => $record['full_name'],
            ];

            $tokens = $this->issueTokens($user);
            $this->db->commit();

            return $tokens;
        } catch (\Throwable $e) {
            $this->db->rollback();
            throw $e;
        }
    }

    // ── LOGOUT ─────────────────────────────────────────────────

    public function logout(array $data, string $userId): void
    {
        Validator::make($data, [
            'refresh_token' => 'required|string',
        ]);

        $tokenHash = $this->jwt->hashRefreshToken($data['refresh_token']);

        // Revoke only if token belongs to this user (ownership check)
        $this->db->execute(
            "UPDATE refresh_tokens
             SET revoked = true
             WHERE token_hash = :hash AND user_id = :uid",
            ['hash' => $tokenHash, 'uid' => $userId]
        );
    }

    // ── HELPERS ────────────────────────────────────────────────

    private function issueTokens(array $user): array
    {
        $accessToken  = $this->jwt->createAccessToken([
            'user_id' => $user['id'],
            'role'    => $user['role'],
        ]);

        $rawRefresh  = $this->jwt->createRefreshToken();
        $refreshHash = $this->jwt->hashRefreshToken($rawRefresh);
        $expiresAt   = date('Y-m-d H:i:s', time() + $this->jwt->getRefreshTtl());

        $this->db->execute(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
             VALUES (:uid, :hash, :exp, :ip, :ua)",
            [
                'uid'  => $user['id'],
                'hash' => $refreshHash,
                'exp'  => $expiresAt,
                'ip'   => $_SERVER['REMOTE_ADDR'] ?? null,
                'ua'   => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 500),
            ]
        );

        return [
            'access_token'  => $accessToken,
            'refresh_token' => $rawRefresh,
        ];
    }

    private function safeUser(array $user): array
    {
        return [
            'id'        => $user['id'],
            'email'     => $user['email'],
            'role'      => $user['role'],
            'full_name' => $user['full_name'],
        ];
    }
}
