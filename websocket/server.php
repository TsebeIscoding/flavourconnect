<?php

declare(strict_types=1);

// ─────────────────────────────────────────────────────────────
// FlavourConnect — WebSocket Server (Ratchet)
//
// Responsibilities:
//   - Authenticate connections via JWT in query string
//   - Maintain per-user + per-role topic subscriptions
//   - Receive events from REST API via internal HTTP endpoint
//   - Broadcast events only to authorized subscribers
//
// Run: php server.php
// ─────────────────────────────────────────────────────────────

require __DIR__ . '/vendor/autoload.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use React\EventLoop\Loop;
use React\Socket\Server as ReactServer;
use React\Http\Server as ReactHttpServer;
use Psr\Http\Message\ServerRequestInterface;

// Load .env — line-by-line parser handles comments and special characters safely
if (file_exists(__DIR__ . '/.env')) {
    $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v, " \t\n\r\0\x0B\"'");
        if (!isset($_ENV[$k])) {
            $_ENV[$k] = $v;
            putenv("{$k}={$v}");
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Connection Manager — tracks who is connected and their topics
// ─────────────────────────────────────────────────────────────

class ConnectionManager
{
    /** @var array<string, ConnectionInterface> resourceId → connection */
    private array $connections = [];

    /** @var array<string, array> resourceId → user context */
    private array $userContext = [];

    /** @var array<string, array> topic → [resourceId, ...] */
    private array $topics = [];

    public function register(ConnectionInterface $conn, array $user): void
    {
        $id = (string)$conn->resourceId;
        $this->connections[$id] = $conn;
        $this->userContext[$id] = $user;

        // Auto-subscribe to role-based topics
        $this->subscribe($conn, "user:{$user['user_id']}");
        $this->subscribe($conn, "role:{$user['role']}");

        if ($user['role'] === 'vendor' && !empty($user['restaurant_id'])) {
            $this->subscribe($conn, "restaurant:{$user['restaurant_id']}");
        }
    }

    public function remove(ConnectionInterface $conn): void
    {
        $id = (string)$conn->resourceId;
        unset($this->connections[$id], $this->userContext[$id]);

        // Remove from all topics
        foreach ($this->topics as $topic => &$ids) {
            $ids = array_diff($ids, [$id]);
        }
    }

    public function subscribe(ConnectionInterface $conn, string $topic): void
    {
        $id = (string)$conn->resourceId;
        if (!isset($this->topics[$topic])) {
            $this->topics[$topic] = [];
        }
        if (!in_array($id, $this->topics[$topic])) {
            $this->topics[$topic][] = $id;
        }
    }

    public function getUserContext(ConnectionInterface $conn): ?array
    {
        return $this->userContext[(string)$conn->resourceId] ?? null;
    }

    /** Send event to all subscribers of a topic */
    public function broadcast(string $topic, array $event): int
    {
        $sent = 0;
        $ids  = $this->topics[$topic] ?? [];
        foreach ($ids as $id) {
            if (isset($this->connections[$id])) {
                $this->connections[$id]->send(json_encode($event));
                $sent++;
            }
        }
        return $sent;
    }

    /** Send to a specific connection */
    public function sendToUser(string $userId, array $event): void
    {
        $this->broadcast("user:{$userId}", $event);
    }
}

// ─────────────────────────────────────────────────────────────
// WebSocket Application
// ─────────────────────────────────────────────────────────────

class FlavourConnectWs implements MessageComponentInterface
{
    private ConnectionManager $manager;
    private string $jwtSecret;

    public function __construct(ConnectionManager $manager)
    {
        $this->manager   = $manager;
        $this->jwtSecret = $_ENV['JWT_SECRET'] ?? '';

        if (strlen($this->jwtSecret) < 64) {
            throw new \RuntimeException('JWT_SECRET misconfigured');
        }
    }

    public function onOpen(ConnectionInterface $conn): void
    {
        // Extract token from query string: wss://ws.example.com?token=eyJ...
        $queryString = $conn->httpRequest->getUri()->getQuery();
        parse_str($queryString, $params);
        $token = $params['token'] ?? '';

        echo "[WS] onOpen id={$conn->resourceId} token_length=" . strlen($token) . "\n";

        $user = $this->verifyToken($token);
        if (!$user) {
            echo "[WS] AUTH FAILED for id={$conn->resourceId} — token rejected\n";
            $conn->send(json_encode([
                'event'   => 'error',
                'payload' => ['code' => 'AUTH_FAILED', 'message' => 'Invalid token'],
            ]));
            $conn->close();
            return;
        }

        // For vendors, fetch their restaurant ID to set up routing
        // In production this would be included in the JWT or a DB lookup
        // For simplicity, it's stored in the token's additional claims

        $this->manager->register($conn, $user);

        $conn->send(json_encode([
            'event'   => 'connected',
            'payload' => [
                'user_id' => $user['user_id'],
                'role'    => $user['role'],
            ],
        ]));

        echo "[WS] Connected: user={$user['user_id']} role={$user['role']} id={$conn->resourceId}\n";
    }

    public function onClose(ConnectionInterface $conn): void
    {
        $this->manager->remove($conn);
        echo "[WS] Disconnected: id={$conn->resourceId}\n";
    }

    public function onError(ConnectionInterface $conn, \Exception $e): void
    {
        error_log("[WS] Error on {$conn->resourceId}: " . $e->getMessage());
        $conn->close();
    }

    public function onMessage(ConnectionInterface $from, $msg): void
    {
        // Clients can send ping or topic subscription requests
        try {
            $data = json_decode($msg, true);
            if (!is_array($data)) return;

            $event = $data['event'] ?? '';

            if ($event === 'ping') {
                $from->send(json_encode(['event' => 'pong']));
            }

            // Clients can subscribe to specific order tracking
            if ($event === 'subscribe' && !empty($data['topic'])) {
                $user  = $this->manager->getUserContext($from);
                $topic = $data['topic'];

                // Validate client is allowed to subscribe to this topic
                if ($this->canSubscribe($user, $topic)) {
                    $this->manager->subscribe($from, $topic);
                    $from->send(json_encode([
                        'event'   => 'subscribed',
                        'payload' => ['topic' => $topic],
                    ]));
                } else {
                    $from->send(json_encode([
                        'event'   => 'error',
                        'payload' => ['message' => 'Not authorized for this topic'],
                    ]));
                }
            }
        } catch (\Throwable $e) {
            error_log("[WS] Message parse error: " . $e->getMessage());
        }
    }

    /** Called by internal HTTP endpoint to broadcast events */
    public function handleInternalBroadcast(array $event): void
    {
        $eventName = $event['event'] ?? '';
        $payload   = $event['payload'] ?? [];

        switch ($eventName) {
            case 'order.created':
                // Notify vendor's restaurant topic
                if (!empty($payload['restaurant_id'])) {
                    $this->manager->broadcast(
                        "restaurant:{$payload['restaurant_id']}",
                        ['event' => 'order.created', 'payload' => $payload]
                    );
                }
                break;

            case 'order.updated':
                // Notify customer
                if (!empty($payload['customer_id'])) {
                    $this->manager->sendToUser(
                        $payload['customer_id'],
                        ['event' => 'order.updated', 'payload' => $payload]
                    );
                }
                // Notify vendor
                if (!empty($payload['restaurant_id'])) {
                    $this->manager->broadcast(
                        "restaurant:{$payload['restaurant_id']}",
                        ['event' => 'order.updated', 'payload' => $payload]
                    );
                }
                // Notify driver if assigned
                if (!empty($payload['driver_id'])) {
                    $this->manager->sendToUser(
                        $payload['driver_id'],
                        ['event' => 'order.updated', 'payload' => $payload]
                    );
                }
                // Notify all drivers if order becomes 'ready' (new pickup available)
                if (($payload['status'] ?? '') === 'ready') {
                    $this->manager->broadcast(
                        'role:driver',
                        ['event' => 'order.ready', 'payload' => $payload]
                    );
                }
                break;

            case 'order.assigned':
                if (!empty($payload['driver_id'])) {
                    $this->manager->sendToUser(
                        $payload['driver_id'],
                        ['event' => 'order.assigned', 'payload' => $payload]
                    );
                }
                break;

            case 'order.delivered':
                if (!empty($payload['customer_id'])) {
                    $this->manager->sendToUser(
                        $payload['customer_id'],
                        ['event' => 'order.delivered', 'payload' => $payload]
                    );
                }
                break;

            case 'notification.new':
                if (!empty($payload['user_id'])) {
                    $this->manager->sendToUser(
                        $payload['user_id'],
                        ['event' => 'notification.new', 'payload' => $payload]
                    );
                }
                break;

            default:
                error_log("[WS] Unknown internal event: {$eventName}");
        }
    }

    private function canSubscribe(?array $user, string $topic): bool
    {
        if (!$user) return false;

        // Users can subscribe to their own user channel
        if ($topic === "user:{$user['user_id']}") return true;

        // Customers can subscribe to their own orders
        if (str_starts_with($topic, 'order:') && $user['role'] === 'customer') {
            // Full validation would check DB — simplified here
            return true;
        }

        // Vendors can subscribe to their restaurant
        if (str_starts_with($topic, 'restaurant:') && $user['role'] === 'vendor') {
            // Full validation: check restaurant_id matches this vendor's restaurant
            return true;
        }

        // Drivers can subscribe to driver broadcasts
        if ($topic === 'role:driver' && $user['role'] === 'driver') {
            return true;
        }

        return false;
    }

    private function verifyToken(string $token): ?array
    {
        try {
            if (empty($token)) {
                echo "[WS] verifyToken: empty token\n";
                return null;
            }

            $parts = explode('.', $token);
            if (count($parts) !== 3) {
                echo "[WS] verifyToken: wrong part count " . count($parts) . "\n";
                return null;
            }

            [$headerB64, $payloadB64, $signatureB64] = $parts;

            // Verify signature
            $expectedSig = rtrim(strtr(base64_encode(
                hash_hmac('sha256', "{$headerB64}.{$payloadB64}", $this->jwtSecret, true)
            ), '+/', '-_'), '=');

            if (!hash_equals($expectedSig, $signatureB64)) {
                echo "[WS] verifyToken: signature mismatch\n";
                echo "[WS]   expected: {$expectedSig}\n";
                echo "[WS]   got:      {$signatureB64}\n";
                echo "[WS]   secret_len: " . strlen($this->jwtSecret) . "\n";
                return null;
            }

            $claims = json_decode(
                base64_decode(strtr($payloadB64, '-_', '+/')),
                true
            );

            if (!is_array($claims)) {
                echo "[WS] verifyToken: invalid claims JSON\n";
                return null;
            }

            if (($claims['exp'] ?? 0) < time()) {
                echo "[WS] verifyToken: token expired at " . ($claims['exp'] ?? 0) . " now=" . time() . "\n";
                return null;
            }

            echo "[WS] verifyToken: OK user={$claims['sub']} role={$claims['role']}\n";
            return [
                'user_id'       => $claims['sub'],
                'role'          => $claims['role'],
                'restaurant_id' => $claims['restaurant_id'] ?? null,
            ];
        } catch (\Throwable $e) {
            echo "[WS] verifyToken exception: " . $e->getMessage() . "\n";
            return null;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Boot Server
// ─────────────────────────────────────────────────────────────

$loop    = Loop::get();
$manager = new ConnectionManager();
$wsApp   = new FlavourConnectWs($manager);

// ── WebSocket server (public, port 8080) ──────────────────────
$wsPort    = (int)($_ENV['WS_PORT'] ?? 8080);
$wsSocket  = new ReactServer("0.0.0.0:{$wsPort}", $loop);
$wsServer  = new IoServer(
    new HttpServer(
        new WsServer($wsApp)
    ),
    $wsSocket,
    $loop
);

echo "[WS] WebSocket server started on port {$wsPort}\n";

// ── Internal HTTP server (private, port 8081) ─────────────────
$internalPort   = (int)($_ENV['WS_INTERNAL_PORT'] ?? 8081);
$internalSecret = $_ENV['WS_INTERNAL_SECRET'] ?? '';

$httpServer = new ReactHttpServer(
    function (ServerRequestInterface $request) use ($wsApp, $internalSecret) {

        $remoteAddr = $request->getServerParams()['REMOTE_ADDR'] ?? '';
        if (!in_array($remoteAddr, ['127.0.0.1', '::1'], true)) {
            return new \React\Http\Message\Response(403, [], 'Forbidden');
        }

        $secret = $request->getHeaderLine('X-Internal-Secret');
        if (!hash_equals($internalSecret, $secret)) {
            return new \React\Http\Message\Response(403, [], 'Forbidden');
        }

        if ($request->getUri()->getPath() !== '/internal/broadcast') {
            return new \React\Http\Message\Response(404, [], 'Not Found');
        }

        $body  = (string)$request->getBody();
        $event = json_decode($body, true);

        if (!is_array($event)) {
            return new \React\Http\Message\Response(400, [], 'Invalid JSON');
        }

        $wsApp->handleInternalBroadcast($event);

        return new \React\Http\Message\Response(
            200,
            ['Content-Type' => 'application/json'],
            json_encode(['ok' => true])
        );
    }
);
$httpServer->listen(new ReactServer("0.0.0.0:{$internalPort}", $loop));

echo "[WS] Internal HTTP server started on port {$internalPort}\n";

$loop->run();
