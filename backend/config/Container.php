<?php

declare(strict_types=1);

namespace FlavourConnect\Config;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\JwtService;
use FlavourConnect\Utils\ResponseHelper;
use FlavourConnect\Middleware\CorsMiddleware;
use FlavourConnect\Middleware\RateLimiter;
use FlavourConnect\Middleware\AuthMiddleware;
use FlavourConnect\Middleware\ErrorHandler;
use FlavourConnect\Controllers\AuthController;
use FlavourConnect\Controllers\RestaurantController;
use FlavourConnect\Controllers\MenuController;
use FlavourConnect\Controllers\CartController;
use FlavourConnect\Controllers\OrderController;
use FlavourConnect\Controllers\DriverController;
use FlavourConnect\Controllers\AdminController;
use FlavourConnect\Services\AuthService;
use FlavourConnect\Services\RestaurantService;
use FlavourConnect\Services\MenuService;
use FlavourConnect\Services\CartService;
use FlavourConnect\Services\OrderService;
use FlavourConnect\Services\WebSocketNotifier;
use FlavourConnect\Routes\Router;

// ─────────────────────────────────────────────────────────────
// Simple DI Container
// ─────────────────────────────────────────────────────────────

class Container
{
    private static ?self $instance = null;
    private array $bindings = [];
    private array $singletons = [];

    private function __construct()
    {
        $this->registerBindings();
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function registerBindings(): void
    {
        // Infrastructure
        $this->singleton(Database::class, fn() => new Database());
        $this->singleton(JwtService::class, fn() => new JwtService());
        $this->singleton(ResponseHelper::class, fn() => new ResponseHelper());
        $this->singleton(WebSocketNotifier::class, fn() => new WebSocketNotifier());

        // Middleware
        $this->singleton(CorsMiddleware::class, fn() => new CorsMiddleware(
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(RateLimiter::class, fn() => new RateLimiter(
            $this->get(Database::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(AuthMiddleware::class, fn() => new AuthMiddleware(
            $this->get(JwtService::class),
            $this->get(Database::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(ErrorHandler::class, fn() => new ErrorHandler(
            $this->get(ResponseHelper::class)
        ));

        // Services
        $this->singleton(AuthService::class, fn() => new AuthService(
            $this->get(Database::class),
            $this->get(JwtService::class)
        ));
        $this->singleton(RestaurantService::class, fn() => new RestaurantService(
            $this->get(Database::class)
        ));
        $this->singleton(MenuService::class, fn() => new MenuService(
            $this->get(Database::class)
        ));
        $this->singleton(CartService::class, fn() => new CartService(
            $this->get(Database::class)
        ));
        $this->singleton(OrderService::class, fn() => new OrderService(
            $this->get(Database::class),
            $this->get(WebSocketNotifier::class)
        ));

        // Controllers
        $this->singleton(AuthController::class, fn() => new AuthController(
            $this->get(AuthService::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(RestaurantController::class, fn() => new RestaurantController(
            $this->get(RestaurantService::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(MenuController::class, fn() => new MenuController(
            $this->get(MenuService::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(CartController::class, fn() => new CartController(
            $this->get(CartService::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(OrderController::class, fn() => new OrderController(
            $this->get(OrderService::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(DriverController::class, fn() => new DriverController(
            $this->get(Database::class),
            $this->get(ResponseHelper::class)
        ));
        $this->singleton(AdminController::class, fn() => new AdminController(
            $this->get(Database::class),
            $this->get(ResponseHelper::class)
        ));

        // Router
        $this->singleton(Router::class, fn() => new Router(
            $this,
            $this->get(AuthMiddleware::class),
            $this->get(ResponseHelper::class)
        ));
    }

    public function get(string $class): mixed
    {
        if (isset($this->singletons[$class])) {
            return $this->singletons[$class];
        }
        if (isset($this->bindings[$class])) {
            return ($this->bindings[$class])();
        }
        throw new \RuntimeException("No binding for: {$class}");
    }

    private function singleton(string $class, callable $factory): void
    {
        $this->bindings[$class] = function () use ($class, $factory) {
            if (!isset($this->singletons[$class])) {
                $this->singletons[$class] = $factory();
            }
            return $this->singletons[$class];
        };
    }
}
