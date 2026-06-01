<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Services\CartService;
use FlavourConnect\Utils\ResponseHelper;

class CartController
{
    public function __construct(
        private CartService    $cartService,
        private ResponseHelper $response
    ) {}

    public function show(array $params, ?array $claims): never
    {
        $result = $this->cartService->getCart($claims['sub']);
        $this->response->success(['cart' => $result]);
    }

    public function add(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->cartService->addItem($claims['sub'], $data);
        $this->response->success(['cart' => $result]);
    }

    public function remove(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->cartService->removeItem($claims['sub'], $data);
        $this->response->success(['cart' => $result]);
    }

    public function clear(array $params, ?array $claims): never
    {
        $this->cartService->clearCart($claims['sub']);
        $this->response->success(['message' => 'Cart cleared']);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
