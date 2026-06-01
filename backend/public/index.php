<?php

declare(strict_types=1);

// ─────────────────────────────────────────────────────────────
// FlavourConnect — Backend Entry Point
// Every request flows through this file
// ─────────────────────────────────────────────────────────────

// FC_ROOT is the backend directory (one level up from public/)
define('FC_ROOT', dirname(__DIR__));
define('FC_START', microtime(true));

require_once FC_ROOT . '/vendor/autoload.php';
require_once FC_ROOT . '/config/bootstrap.php';

use FlavourConnect\Config\Container;
use FlavourConnect\Middleware\CorsMiddleware;
use FlavourConnect\Middleware\RateLimiter;
use FlavourConnect\Middleware\AuthMiddleware;
use FlavourConnect\Middleware\ErrorHandler;
use FlavourConnect\Routes\Router;

// Instantiate DI container
$container = Container::getInstance();

// ── Global error handler (must be first) ──────────────────────
$errorHandler = $container->get(ErrorHandler::class);
set_exception_handler([$errorHandler, 'handleException']);
set_error_handler([$errorHandler, 'handleError']);

// ── CORS (must run before any output) ─────────────────────────
$cors = $container->get(CorsMiddleware::class);
$cors->handle();

// ── Rate limiting ──────────────────────────────────────────────
$rateLimiter = $container->get(RateLimiter::class);
$rateLimiter->check();

// ── Parse request ──────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri    = rtrim($uri, '/') ?: '/';

// Strip base path if deployed in subdirectory
$basePath = '/v1';
if (str_starts_with($uri, $basePath)) {
    $uri = substr($uri, strlen($basePath)) ?: '/';
}

// ── Router dispatch ────────────────────────────────────────────
$router = $container->get(Router::class);
$router->dispatch($method, $uri);
