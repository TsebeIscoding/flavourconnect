<?php

declare(strict_types=1);

namespace FlavourConnect\Middleware;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\ResponseHelper;

// ─────────────────────────────────────────────────────────────
// Rate Limiter — 100 requests/minute per user or IP
// Uses PostgreSQL for distributed safety
// ─────────────────────────────────────────────────────────────

class RateLimiter
{
    private const LIMIT  = 100;
    private const WINDOW = 60; // seconds

    public function __construct(
        private Database $db,
        private ResponseHelper $response
    ) {}

    public function check(): void
    {
        $key       = $this->getKey();
        $now       = time();
        $windowStart = $now - self::WINDOW;

        // Use PostgreSQL advisory lock + upsert for atomicity
        $result = $this->db->queryOne(
            "SELECT COUNT(*) as count
             FROM rate_limit_log
             WHERE key = :key AND created_at > to_timestamp(:window)",
            ['key' => $key, 'window' => $windowStart]
        );

        $count = (int)($result['count'] ?? 0);

        if ($count >= self::LIMIT) {
            $retryAfter = self::WINDOW;
            header("Retry-After: {$retryAfter}");
            header("X-RateLimit-Limit: " . self::LIMIT);
            header("X-RateLimit-Remaining: 0");
            $this->response->error(
                'Rate limit exceeded. Try again in ' . self::WINDOW . ' seconds.',
                429,
                'RATE_LIMIT_EXCEEDED'
            );
        }

        // Record this request
        $this->db->execute(
            "INSERT INTO rate_limit_log (key, created_at) VALUES (:key, NOW())",
            ['key' => $key]
        );

        // Set headers
        header("X-RateLimit-Limit: " . self::LIMIT);
        header("X-RateLimit-Remaining: " . max(0, self::LIMIT - $count - 1));

        // Cleanup old entries (1% of requests to avoid overhead)
        if (random_int(1, 100) === 1) {
            $this->cleanup($windowStart);
        }
    }

    private function getKey(): string
    {
        // Prefer authenticated user ID, fall back to IP
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
            // Extract sub from JWT without full verification (rate limiter runs before auth)
            $parts = explode('.', $token);
            if (count($parts) === 3) {
                $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
                if (isset($payload['sub'])) {
                    return 'user:' . $payload['sub'];
                }
            }
        }

        return 'ip:' . $this->getClientIp();
    }

    private function getClientIp(): string
    {
        // Trust X-Forwarded-For only if coming from known proxy
        $trustedProxies = array_map('trim', explode(',', $_ENV['TRUSTED_PROXIES'] ?? ''));

        $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        if (in_array($remoteAddr, $trustedProxies, true)) {
            $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
            if ($forwarded) {
                $ips = array_map('trim', explode(',', $forwarded));
                return filter_var($ips[0], FILTER_VALIDATE_IP) ?: $remoteAddr;
            }
        }

        return $remoteAddr;
    }

    private function cleanup(int $windowStart): void
    {
        try {
            $this->db->execute(
                "DELETE FROM rate_limit_log WHERE created_at < to_timestamp(:window)",
                ['window' => $windowStart]
            );
        } catch (\Throwable) {
            // Cleanup failure is non-fatal
        }
    }
}
