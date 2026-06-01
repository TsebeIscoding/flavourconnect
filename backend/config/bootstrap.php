<?php

declare(strict_types=1);

namespace FlavourConnect\Config;

// ─────────────────────────────────────────────────────────────
// Bootstrap — load .env, configure PHP, set constants
// ─────────────────────────────────────────────────────────────

// Load environment variables from .env file
if (file_exists(FC_ROOT . '/.env')) {
    $lines = file(FC_ROOT . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value, " \t\n\r\0\x0B\"'");
        if (!isset($_ENV[$key])) {
            $_ENV[$key] = $value;
            putenv("{$key}={$value}");
        }
    }
}

// Hard error reporting — internal only, never to client
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', FC_ROOT . '/logs/php_errors.log');

// Timezone
date_default_timezone_set($_ENV['APP_TIMEZONE'] ?? 'UTC');

// Content type default
header('Content-Type: application/json; charset=utf-8');

// Security headers
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

// Remove server signature
header_remove('X-Powered-By');
