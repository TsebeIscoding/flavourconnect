<?php

declare(strict_types=1);

namespace FlavourConnect\Controllers;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\ResponseHelper;
use FlavourConnect\Utils\Validator;

class AdminController
{
    public function __construct(
        private Database       $db,
        private ResponseHelper $response
    ) {}

    public function listUsers(array $params, ?array $claims): never
    {
        $page   = max(1, (int)($_GET['page'] ?? 1));
        $limit  = min(50, max(1, (int)($_GET['limit'] ?? 20)));
        $offset = ($page - 1) * $limit;

        $where  = ['1=1'];
        $qParams = [];

        if (!empty($_GET['role'])) {
            $where[]          = 'role = :role';
            $qParams['role']  = $_GET['role'];
        }

        $whereStr = implode(' AND ', $where);

        $total = $this->db->queryOne(
            "SELECT COUNT(*) as count FROM users WHERE {$whereStr}",
            $qParams
        )['count'];

        $users = $this->db->query(
            "SELECT id, email, role, full_name, phone, is_active, is_online, created_at
             FROM users
             WHERE {$whereStr}
             ORDER BY created_at DESC
             LIMIT :limit OFFSET :offset",
            array_merge($qParams, ['limit' => $limit, 'offset' => $offset])
        );

        $this->response->success([
            'users'      => $users,
            'pagination' => compact('page', 'limit', 'total'),
        ]);
    }

    public function updateUser(array $params, ?array $claims): never
    {
        $data = $this->parseBody();

        Validator::make($data, [
            'is_active' => 'nullable|boolean',
            'role'      => 'nullable|in:customer,vendor,driver,admin',
        ]);

        $allowed = ['is_active', 'role'];
        $updates = [];
        $qParams = ['id' => $params['id']];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $updates[]      = "{$field} = :{$field}";
                $qParams[$field] = $data[$field];
            }
        }

        if (empty($updates)) {
            $this->response->error('No fields to update', 400, 'VALIDATION_FAILED');
        }

        $updated = $this->db->update(
            "UPDATE users SET " . implode(', ', $updates) . " WHERE id = :id",
            $qParams
        );

        $this->response->success(['user' => $updated]);
    }

    public function listOrders(array $params, ?array $claims): never
    {
        $page   = max(1, (int)($_GET['page'] ?? 1));
        $limit  = min(50, max(1, (int)($_GET['limit'] ?? 20)));
        $offset = ($page - 1) * $limit;

        $total = $this->db->queryOne("SELECT COUNT(*) as count FROM orders")['count'];

        $orders = $this->db->query(
            "SELECT o.id, o.status, o.total, o.created_at,
                    r.name as restaurant_name,
                    u.email as customer_email
             FROM orders o
             JOIN restaurants r ON r.id = o.restaurant_id
             JOIN users u ON u.id = o.customer_id
             ORDER BY o.created_at DESC
             LIMIT :limit OFFSET :offset",
            ['limit' => $limit, 'offset' => $offset]
        );

        $this->response->success([
            'orders'     => $orders,
            'pagination' => compact('page', 'limit', 'total'),
        ]);
    }

    public function stats(array $params, ?array $claims): never
    {
        $stats = $this->db->queryOne(
            "SELECT
                (SELECT COUNT(*) FROM users WHERE role = 'customer') as total_customers,
                (SELECT COUNT(*) FROM users WHERE role = 'vendor')   as total_vendors,
                (SELECT COUNT(*) FROM users WHERE role = 'driver')   as total_drivers,
                (SELECT COUNT(*) FROM restaurants WHERE is_open)     as open_restaurants,
                (SELECT COUNT(*) FROM orders)                        as total_orders,
                (SELECT COUNT(*) FROM orders WHERE status = 'pending')        as pending_orders,
                (SELECT COUNT(*) FROM orders WHERE status = 'out_for_delivery') as active_deliveries,
                (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status = 'delivered') as total_revenue"
        );

        $this->response->success(['stats' => $stats]);
    }

    private function parseBody(): array
    {
        $raw  = file_get_contents('php://input');
        $data = json_decode($raw ?: '{}', true);
        return is_array($data) ? $data : [];
    }
}
