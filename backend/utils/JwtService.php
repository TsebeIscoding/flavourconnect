<?php

declare(strict_types=1);

namespace FlavourConnect\Utils;

use FlavourConnect\Exceptions\AuthException;

// ─────────────────────────────────────────────────────────────
// JwtService — Access + Refresh Token System
//
// Access token:  HS256, 15 min expiry, in Authorization header
// Refresh token: cryptographically random, hashed in DB, rotated
// ─────────────────────────────────────────────────────────────

class JwtService
{
    private string $secret;
    private int $accessTtl;
    private int $refreshTtl;

    public function __construct()
    {
        $secret = $_ENV['JWT_SECRET'] ?? '';
        if (strlen($secret) < 64) {
            throw new \RuntimeException('JWT_SECRET must be at least 64 characters');
        }
        $this->secret     = $secret;
        $this->accessTtl  = (int)($_ENV['JWT_ACCESS_TTL']  ?? 900);    // 15 min
        $this->refreshTtl = (int)($_ENV['JWT_REFRESH_TTL'] ?? 1209600); // 14 days
    }

    // ─── ACCESS TOKEN ──────────────────────────────────────────

    public function createAccessToken(array $payload): string
    {
        $now = time();
        $claims = [
            'iss' => $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com',
            'iat' => $now,
            'exp' => $now + $this->accessTtl,
            'jti' => bin2hex(random_bytes(16)),
            'sub' => $payload['user_id'],
            'role' => $payload['role'],
        ];

        return $this->encode($claims);
    }

    public function verifyAccessToken(string $token): array
    {
        try {
            $parts = explode('.', $token);
            if (count($parts) !== 3) {
                throw new AuthException('Malformed token', 401, 'AUTH_TOKEN_INVALID');
            }

            [$headerB64, $payloadB64, $signatureB64] = $parts;

            // Verify signature
            $expectedSig = $this->sign("{$headerB64}.{$payloadB64}");
            if (!hash_equals($expectedSig, $signatureB64)) {
                throw new AuthException('Invalid token signature', 401, 'AUTH_TOKEN_INVALID');
            }

            $claims = json_decode($this->base64UrlDecode($payloadB64), true);

            if (!is_array($claims)) {
                throw new AuthException('Invalid token payload', 401, 'AUTH_TOKEN_INVALID');
            }

            // Check expiry
            if (($claims['exp'] ?? 0) < time()) {
                throw new AuthException('Token expired', 401, 'AUTH_TOKEN_EXPIRED');
            }

            return $claims;
        } catch (AuthException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new AuthException('Invalid token', 401, 'AUTH_TOKEN_INVALID');
        }
    }

    // ─── REFRESH TOKEN ─────────────────────────────────────────

    public function createRefreshToken(): string
    {
        // 256 bits of cryptographic randomness
        return bin2hex(random_bytes(32));
    }

    public function hashRefreshToken(string $rawToken): string
    {
        // SHA-256 of the raw token for DB storage
        return hash('sha256', $rawToken);
    }

    public function getRefreshTtl(): int
    {
        return $this->refreshTtl;
    }

    // ─── INTERNAL ──────────────────────────────────────────────

    private function encode(array $claims): string
    {
        $header  = $this->base64UrlEncode(json_encode([
            'alg' => 'HS256',
            'typ' => 'JWT',
        ]));
        $payload = $this->base64UrlEncode(json_encode($claims));
        $sig     = $this->sign("{$header}.{$payload}");

        return "{$header}.{$payload}.{$sig}";
    }

    private function sign(string $data): string
    {
        return $this->base64UrlEncode(
            hash_hmac('sha256', $data, $this->secret, true)
        );
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
    }
}
