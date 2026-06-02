<?php

declare(strict_types=1);

namespace FlavourConnect\Routes;

use FlavourConnect\Config\Container;
use FlavourConnect\Middleware\AuthMiddleware;
use FlavourConnect\Utils\ResponseHelper;
use FlavourConnect\Controllers\AuthController;
use FlavourConnect\Controllers\RestaurantController;
use FlavourConnect\Controllers\MenuController;
use FlavourConnect\Controllers\CartController;
use FlavourConnect\Controllers\OrderController;
use FlavourConnect\Controllers\DriverController;
use FlavourConnect\Controllers\AdminController;

// ─────────────────────────────────────────────────────────────
// Router — maps HTTP method + URI to controller action
// Each route declares: method, pattern, handler, auth, roles
// ─────────────────────────────────────────────────────────────

class Router
{
    private array $routes = [];

    public function __construct(
        private Container      $container,
        private AuthMiddleware $auth,
        private ResponseHelper $response
    ) {
        $this->registerRoutes();
    }

    private function registerRoutes(): void
    {
        // ── Auth ──────────────────────────────────────────────
        $this->add('POST', '/auth/register', [AuthController::class, 'register']);
        $this->add('POST', '/auth/login',    [AuthController::class, 'login']);
        $this->add('POST', '/auth/refresh',  [AuthController::class, 'refresh']);
        $this->add('POST', '/auth/logout',   [AuthController::class, 'logout'],   auth: true);

        // ── Restaurants ───────────────────────────────────────
        $this->add('GET',   '/restaurants/mine',   [RestaurantController::class, 'mine'],     auth: true, roles: ['vendor']);
        $this->add('GET',   '/restaurants',        [RestaurantController::class, 'index']);
        $this->add('GET',   '/restaurants/{id}',   [RestaurantController::class, 'show']);
        $this->add('PATCH', '/restaurants/{id}',   [RestaurantController::class, 'update'],    auth: true, roles: ['vendor', 'admin']);
        $this->add('POST',  '/restaurants/{id}/logo', [RestaurantController::class, 'uploadLogo'], auth: true, roles: ['vendor', 'admin']);

        // ── Menu ──────────────────────────────────────────────
        $this->add('GET',   '/restaurants/{id}/menu', [MenuController::class, 'index']);
        $this->add('POST',  '/menu',           [MenuController::class, 'store'],   auth: true, roles: ['vendor', 'admin']);
        $this->add('PATCH', '/menu/{id}',      [MenuController::class, 'update'],  auth: true, roles: ['vendor', 'admin']);
        $this->add('DELETE','/menu/{id}',      [MenuController::class, 'destroy'], auth: true, roles: ['vendor', 'admin']);

        // ── Cart ──────────────────────────────────────────────
        $this->add('GET',    '/cart',         [CartController::class, 'show'],    auth: true, roles: ['customer']);
        $this->add('POST',   '/cart/add',     [CartController::class, 'add'],     auth: true, roles: ['customer']);
        $this->add('POST',   '/cart/remove',  [CartController::class, 'remove'],  auth: true, roles: ['customer']);
        $this->add('DELETE', '/cart',         [CartController::class, 'clear'],   auth: true, roles: ['customer']);

        // ── Orders ────────────────────────────────────────────
        $this->add('POST',  '/orders',                  [OrderController::class, 'create'],          auth: true, roles: ['customer']);
        $this->add('GET',   '/orders/customer',         [OrderController::class, 'customerOrders'],  auth: true, roles: ['customer']);
        $this->add('GET',   '/orders/vendor',           [OrderController::class, 'vendorOrders'],    auth: true, roles: ['vendor']);
        $this->add('GET',   '/orders/driver',           [OrderController::class, 'driverOrders'],    auth: true, roles: ['driver']);
        $this->add('GET',   '/orders/{id}',             [OrderController::class, 'show'],            auth: true);
        $this->add('PATCH', '/orders/{id}/status',      [OrderController::class, 'updateStatus'],    auth: true, roles: ['vendor', 'driver', 'customer']);

        // ── Driver ────────────────────────────────────────────
        $this->add('PATCH', '/drivers/status', [DriverController::class, 'setOnlineStatus'], auth: true, roles: ['driver']);

        // ── Admin ─────────────────────────────────────────────
        $this->add('GET',   '/admin/users',      [AdminController::class, 'listUsers'],   auth: true, roles: ['admin']);
        $this->add('PATCH', '/admin/users/{id}', [AdminController::class, 'updateUser'],  auth: true, roles: ['admin']);
        $this->add('GET',   '/admin/orders',     [AdminController::class, 'listOrders'],  auth: true, roles: ['admin']);
        $this->add('GET',   '/admin/stats',      [AdminController::class, 'stats'],       auth: true, roles: ['admin']);
    }

    public function dispatch(string $method, string $uri): void
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $method) {
                continue;
            }

            $params = $this->matchUri($route['pattern'], $uri);
            if ($params === false) {
                continue;
            }

            // ── Auth enforcement ───────────────────────────────
            $claims = null;
            if ($route['auth']) {
                if ($route['roles']) {
                    $claims = $this->auth->requireRole($route['roles']);
                } else {
                    $claims = $this->auth->authenticate();
                }
            }

            // ── Dispatch to controller ─────────────────────────
            [$controllerClass, $action] = $route['handler'];
            $controller = $this->container->get($controllerClass);

            $controller->$action($params, $claims);
            return;
        }

        // No route matched
        if ($method === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        // Check if URI exists with different method
        $uriExists = false;
        foreach ($this->routes as $route) {
            if ($this->matchUri($route['pattern'], $uri) !== false) {
                $uriExists = true;
                break;
            }
        }

        if ($uriExists) {
            $this->response->error('Method not allowed', 405, 'METHOD_NOT_ALLOWED');
        }

        $this->response->error('Route not found', 404, 'NOT_FOUND');
    }

    private function add(
        string $method,
        string $pattern,
        array  $handler,
        bool   $auth  = false,
        array  $roles = []
    ): void {
        $this->routes[] = compact('method', 'pattern', 'handler', 'auth', 'roles');
    }

    /** Returns array of named params if matched, false otherwise */
    private function matchUri(string $pattern, string $uri): array|false
    {
        $regex = preg_replace('/\{(\w+)\}/', '(?P<$1>[^/]+)', $pattern);
        $regex = '#^' . $regex . '$#';

        if (!preg_match($regex, $uri, $matches)) {
            return false;
        }

        // Filter to named captures only
        return array_filter($matches, fn($k) => !is_int($k), ARRAY_FILTER_USE_KEY);
    }
}
