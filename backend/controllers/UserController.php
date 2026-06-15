<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Services\UserService;
use FlavourConnect\Utils\ResponseHelper;

class UserController
{
    public function __construct(
        private UserService    $userService,
        private ResponseHelper $response
    ) {}

    public function show(array $params, ?array $claims): never
    {
        $result = $this->userService->getProfile($claims['sub']);
        $this->response->success(['user' => $result]);
    }

    public function update(array $params, ?array $claims): never
    {
        $data   = $this->parseBody();
        $result = $this->userService->updateProfile($claims['sub'], $data);
        $this->response->success(['user' => $result]);
    }

    public function uploadAvatar(array $params, ?array $claims): never
    {
        $result = $this->userService->uploadAvatar($claims['sub']);
        $this->response->success($result);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
