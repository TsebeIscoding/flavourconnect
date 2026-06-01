<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Services\MenuService;
use FlavourConnect\Utils\ResponseHelper;

class MenuController
{
    public function __construct(
        private MenuService    $menuService,
        private ResponseHelper $response
    ) {}

    public function index(array $params, ?array $claims): never
    {
        $result = $this->menuService->getMenu($params['id'], $_GET);
        $this->response->success($result);
    }

    public function store(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->menuService->create($claims['sub'], $data);
        $this->response->success($result, 201);
    }

    public function update(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->menuService->update($params['id'], $claims['sub'], $claims['role'], $data);
        $this->response->success($result);
    }

    public function destroy(array $params, ?array $claims): never
    {
        $this->menuService->destroy($params['id'], $claims['sub'], $claims['role']);
        $this->response->success(['message' => 'Item disabled']);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
