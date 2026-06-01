<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

// ─────────────────────────────────────────────────────────────
// WebSocketNotifier — Sends events to Ratchet WS server
// REST API → POST internal HTTP → WS server → broadcast
// ─────────────────────────────────────────────────────────────

class WebSocketNotifier
{
    private string $wsInternalUrl;
    private string $wsSecret;

    public function __construct()
    {
        $this->wsInternalUrl = $_ENV['WS_INTERNAL_URL'] ?? 'http://localhost:8081/internal';
        $this->wsSecret      = $_ENV['WS_INTERNAL_SECRET'] ?? '';
    }

    public function emit(string $event, array $payload): void
    {
        $body = json_encode([
            'event'   => $event,
            'payload' => $payload,
        ]);

        // Async fire-and-forget via cURL (non-blocking)
        $ch = curl_init($this->wsInternalUrl . '/broadcast');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-Internal-Secret: ' . $this->wsSecret,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 2, // Don't block API response
            CURLOPT_NOSIGNAL       => 1,
        ]);

        // Execute without blocking — log failure but don't fail the request
        $result = curl_exec($ch);
        $error  = curl_error($ch);
        curl_close($ch);

        if ($error) {
            error_log("[WebSocketNotifier] Failed to emit '{$event}': {$error}");
        }
    }
}
