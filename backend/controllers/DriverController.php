<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\ResponseHelper;
use FlavourConnect\Utils\Validator;

class DriverController
{
    public function __construct(
        private Database       $db,
        private ResponseHelper $response
    ) {}

    public function setOnlineStatus(array $params, ?array $claims): never
    {
        $data = $this->parseBody();

        Validator::make($data, [
            'is_online' => 'required|boolean',
        ]);

        $isOnline = filter_var($data['is_online'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

        $this->db->execute(
            "UPDATE users SET is_online = :online WHERE id = :id",
            ['online' => $isOnline ? 'true' : 'false', 'id' => $claims['sub']]
        );

        $this->response->success(['is_online' => $isOnline]);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
