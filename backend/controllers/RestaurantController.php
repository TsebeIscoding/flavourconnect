<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Services\RestaurantService;
use FlavourConnect\Utils\ResponseHelper;

class RestaurantController
{
    public function __construct(
        private RestaurantService $restaurantService,
        private ResponseHelper    $response
    ) {}

    public function index(array $params, ?array $claims): never
    {
        $result = $this->restaurantService->list($_GET);
        $this->response->success($result);
    }

    public function show(array $params, ?array $claims): never
    {
        $result = $this->restaurantService->findById($params['id']);
        $this->response->success($result);
    }

    public function update(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->restaurantService->update(
            $params['id'],
            $claims['sub'],
            $claims['role'],
            $data
        );
        $this->response->success($result);
    }

    public function uploadLogo(array $params, ?array $claims): never
    {
        $result = $this->restaurantService->uploadLogo(
            $params['id'],
            $claims['sub'],
            $claims['role']
        );
        $this->response->success($result);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
