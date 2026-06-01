<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Services\OrderService;
use FlavourConnect\Utils\ResponseHelper;

class OrderController
{
    public function __construct(
        private OrderService   $orderService,
        private ResponseHelper $response
    ) {}

    public function create(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->orderService->createOrder($claims['sub'], $data);
        $this->response->success(['order' => $result], 201);
    }

    public function customerOrders(array $params, ?array $claims): never
    {
        $result = $this->orderService->getCustomerOrders($claims['sub'], $_GET);
        $this->response->success($result);
    }

    public function vendorOrders(array $params, ?array $claims): never
    {
        $result = $this->orderService->getVendorOrders($claims['sub'], $_GET);
        $this->response->success($result);
    }

    public function driverOrders(array $params, ?array $claims): never
    {
        $result = $this->orderService->getDriverOrders($claims['sub'], $_GET);
        $this->response->success($result);
    }

    public function show(array $params, ?array $claims): never
    {
        $order = $this->orderService->findById($params['id'], $claims['sub'], $claims['role']);
        $this->response->success(['order' => $order]);
    }

    public function updateStatus(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->orderService->updateStatus(
            $params['id'],
            $data['status'] ?? '',
            $claims['sub'],
            $claims['role']
        );
        $this->response->success(['order' => $result]);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
