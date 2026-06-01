<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\BusinessException;

// ─────────────────────────────────────────────────────────────
// OrderService — Order lifecycle management
// Backend computes ALL totals — never trusts frontend
// State machine is enforced at DB trigger AND service level
// ─────────────────────────────────────────────────────────────

class OrderService
{
    // Role-permitted status transitions
    private const ROLE_TRANSITIONS = [
        'customer' => [
            'pending' => 'cancelled',
        ],
        'vendor' => [
            'pending'   => 'accepted',
            'accepted'  => 'preparing',
            'preparing' => 'ready',
        ],
        'driver' => [
            'ready'            => 'out_for_delivery',
            'out_for_delivery' => 'delivered',
        ],
        'admin' => [], // admin uses force-update endpoint
    ];

    private const DELIVERY_FEE = 2.00;

    public function __construct(
        private Database           $db,
        private WebSocketNotifier  $wsNotifier
    ) {}

    // ── CREATE ORDER FROM CART ─────────────────────────────────

    public function createOrder(string $customerId, array $data): array
    {
        Validator::make($data, [
            'delivery_address' => 'required|string|min:10|max:500',
        ]);

        $this->db->beginTransaction();
        try {
            // 1. Load cart
            $cart = $this->db->queryOne(
                "SELECT c.id, c.restaurant_id
                 FROM carts c
                 WHERE c.customer_id = :uid",
                ['uid' => $customerId]
            );

            if (!$cart || !$cart['restaurant_id']) {
                throw new BusinessException('Your cart is empty', 409, 'CART_EMPTY');
            }

            // 2. Load cart items with current prices (server-side)
            $cartItems = $this->db->query(
                "SELECT ci.quantity, mi.id as menu_item_id, mi.name, mi.price, mi.is_available
                 FROM cart_items ci
                 JOIN menu_items mi ON mi.id = ci.menu_item_id
                 WHERE ci.cart_id = :cart_id",
                ['cart_id' => $cart['id']]
            );

            if (empty($cartItems)) {
                throw new BusinessException('Your cart is empty', 409, 'CART_EMPTY');
            }

            // 3. Validate all items are still available
            foreach ($cartItems as $item) {
                if (!$item['is_available']) {
                    throw new BusinessException(
                        "'{$item['name']}' is no longer available",
                        422,
                        'ITEM_UNAVAILABLE'
                    );
                }
            }

            // 4. Verify restaurant is open
            $restaurant = $this->db->queryOne(
                "SELECT id, name, is_open FROM restaurants WHERE id = :id",
                ['id' => $cart['restaurant_id']]
            );

            if (!$restaurant || !$restaurant['is_open']) {
                throw new BusinessException('This restaurant is currently closed', 409, 'RESTAURANT_CLOSED');
            }

            // 5. Compute totals SERVER-SIDE — never accept from client
            $subtotal = 0.00;
            foreach ($cartItems as $item) {
                $subtotal += round((float)$item['price'] * (int)$item['quantity'], 2);
            }

            $deliveryFee = self::DELIVERY_FEE;
            $total       = round($subtotal + $deliveryFee, 2);

            // 6. Create order
            $order = $this->db->insert(
                "INSERT INTO orders
                    (customer_id, restaurant_id, delivery_address, subtotal, delivery_fee, total)
                 VALUES
                    (:customer_id, :restaurant_id, :delivery_address, :subtotal, :delivery_fee, :total)",
                [
                    'customer_id'      => $customerId,
                    'restaurant_id'    => $cart['restaurant_id'],
                    'delivery_address' => $data['delivery_address'],
                    'subtotal'         => $subtotal,
                    'delivery_fee'     => $deliveryFee,
                    'total'            => $total,
                ]
            );

            // 7. Snapshot order items (price fixed at time of order)
            foreach ($cartItems as $item) {
                $lineTotal = round((float)$item['price'] * (int)$item['quantity'], 2);
                $this->db->execute(
                    "INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, line_total)
                     VALUES (:order_id, :menu_item_id, :name, :price, :quantity, :line_total)",
                    [
                        'order_id'     => $order['id'],
                        'menu_item_id' => $item['menu_item_id'],
                        'name'         => $item['name'],
                        'price'        => $item['price'],
                        'quantity'     => $item['quantity'],
                        'line_total'   => $lineTotal,
                    ]
                );
            }

            // 8. Create payment record
            $this->db->execute(
                "INSERT INTO payments (order_id, amount) VALUES (:order_id, :amount)",
                ['order_id' => $order['id'], 'amount' => $total]
            );

            // 9. Clear cart
            $this->db->execute(
                "DELETE FROM cart_items WHERE cart_id = :cart_id",
                ['cart_id' => $cart['id']]
            );
            $this->db->execute(
                "UPDATE carts SET restaurant_id = NULL WHERE id = :cart_id",
                ['cart_id' => $cart['id']]
            );

            $this->db->commit();

            // 10. Notify vendor via WebSocket
            $this->wsNotifier->emit('order.created', [
                'order_id'      => $order['id'],
                'restaurant_id' => $cart['restaurant_id'],
                'total'         => $total,
            ]);

            return $this->findById($order['id'], $customerId, 'customer');

        } catch (\Throwable $e) {
            $this->db->rollback();
            throw $e;
        }
    }

    // ── UPDATE ORDER STATUS ────────────────────────────────────

    public function updateStatus(string $orderId, string $newStatus, string $actorId, string $role): array
    {
        Validator::make(['status' => $newStatus], [
            'status' => 'required|in:accepted,preparing,ready,out_for_delivery,delivered,cancelled',
        ]);

        // 1. Load order
        $order = $this->db->queryOne(
            "SELECT id, customer_id, restaurant_id, driver_id, status
             FROM orders WHERE id = :id",
            ['id' => $orderId]
        );

        if (!$order) {
            throw new BusinessException('Order not found', 404, 'RESOURCE_NOT_FOUND');
        }

        // 2. Ownership verification based on role
        $this->verifyOrderAccess($order, $actorId, $role);

        // 3. Verify this role can make this transition
        $allowedTransitions = self::ROLE_TRANSITIONS[$role] ?? [];
        $expectedNew        = $allowedTransitions[$order['status']] ?? null;

        if ($expectedNew !== $newStatus) {
            throw new BusinessException(
                "Cannot transition order from '{$order['status']}' to '{$newStatus}' as {$role}",
                422,
                'ORDER_INVALID_TRANSITION'
            );
        }

        // 4. Driver must be online to start delivery
        if ($role === 'driver' && $newStatus === 'out_for_delivery') {
            $driver = $this->db->queryOne(
                "SELECT is_online FROM users WHERE id = :id",
                ['id' => $actorId]
            );
            if (!$driver['is_online']) {
                throw new BusinessException('You must be online to accept deliveries', 422, 'DRIVER_OFFLINE');
            }

            // Check driver not already on a delivery
            $activeDelivery = $this->db->queryOne(
                "SELECT id FROM orders WHERE driver_id = :did AND status = 'out_for_delivery'",
                ['did' => $actorId]
            );
            if ($activeDelivery) {
                throw new BusinessException('You already have an active delivery', 422, 'DRIVER_BUSY');
            }

            // Assign driver to order
            $this->db->execute(
                "UPDATE orders SET driver_id = :did WHERE id = :oid",
                ['did' => $actorId, 'oid' => $orderId]
            );
        }

        // 5. Execute status update (DB trigger enforces state machine)
        $updated = $this->db->update(
            "UPDATE orders SET status = :status WHERE id = :id",
            ['status' => $newStatus, 'id' => $orderId]
        );

        // 6. WebSocket broadcast
        $this->wsNotifier->emit('order.updated', [
            'order_id'      => $orderId,
            'status'        => $newStatus,
            'customer_id'   => $order['customer_id'],
            'restaurant_id' => $order['restaurant_id'],
            'driver_id'     => $order['driver_id'] ?? $actorId,
        ]);

        return $this->findById($orderId, $actorId, $role);
    }

    // ── QUERIES ────────────────────────────────────────────────

    public function getCustomerOrders(string $customerId, array $query): array
    {
        $where  = ['o.customer_id = :uid'];
        $params = ['uid' => $customerId];

        if (!empty($query['status'])) {
            $where[]         = 'o.status = :status';
            $params['status'] = $query['status'];
        }

        return $this->paginatedOrders(
            implode(' AND ', $where),
            $params,
            (int)($query['page'] ?? 1),
            (int)($query['limit'] ?? 20)
        );
    }

    public function getVendorOrders(string $vendorId, array $query): array
    {
        // Verify vendor owns a restaurant
        $restaurant = $this->db->queryOne(
            "SELECT id FROM restaurants WHERE vendor_id = :vid",
            ['vid' => $vendorId]
        );

        if (!$restaurant) {
            return ['orders' => [], 'pagination' => ['page' => 1, 'limit' => 20, 'total' => 0]];
        }

        $where  = ['o.restaurant_id = :rid'];
        $params = ['rid' => $restaurant['id']];

        if (!empty($query['status'])) {
            $where[]          = 'o.status = :status';
            $params['status'] = $query['status'];
        }

        return $this->paginatedOrders(
            implode(' AND ', $where),
            $params,
            (int)($query['page'] ?? 1),
            (int)($query['limit'] ?? 20)
        );
    }

    public function getDriverOrders(string $driverId, array $query): array
    {
        // Drivers see: ready orders (available to pick up) + their own active order
        $where  = ["(o.status = 'ready' OR (o.driver_id = :did AND o.status = 'out_for_delivery'))"];
        $params = ['did' => $driverId];

        return $this->paginatedOrders(
            implode(' AND ', $where),
            $params,
            (int)($query['page'] ?? 1),
            (int)($query['limit'] ?? 20)
        );
    }

    public function findById(string $orderId, string $actorId, string $role): array
    {
        $order = $this->db->queryOne(
            "SELECT o.*, r.name as restaurant_name,
                    u.full_name as customer_name
             FROM orders o
             JOIN restaurants r ON r.id = o.restaurant_id
             JOIN users u ON u.id = o.customer_id
             WHERE o.id = :id",
            ['id' => $orderId]
        );

        if (!$order) {
            throw new BusinessException('Order not found', 404, 'RESOURCE_NOT_FOUND');
        }

        // Object-level auth (admin bypasses)
        if ($role !== 'admin') {
            $this->verifyOrderAccess($order, $actorId, $role);
        }

        $items = $this->db->query(
            "SELECT name, price, quantity, line_total FROM order_items WHERE order_id = :oid",
            ['oid' => $orderId]
        );

        $order['items'] = $items;
        return $order;
    }

    // ── HELPERS ────────────────────────────────────────────────

    private function verifyOrderAccess(array $order, string $actorId, string $role): void
    {
        $hasAccess = match($role) {
            'customer' => $order['customer_id'] === $actorId,
            'vendor'   => $this->vendorOwnsOrder($actorId, $order['restaurant_id']),
            'driver'   => $order['driver_id'] === $actorId
                          || $order['status'] === 'ready',
            'admin'    => true,
            default    => false,
        };

        if (!$hasAccess) {
            throw new BusinessException(
                'You do not have access to this order',
                403,
                'FORBIDDEN_OWNERSHIP'
            );
        }
    }

    private function vendorOwnsOrder(string $vendorId, string $restaurantId): bool
    {
        $r = $this->db->queryOne(
            "SELECT id FROM restaurants WHERE id = :rid AND vendor_id = :vid",
            ['rid' => $restaurantId, 'vid' => $vendorId]
        );
        return $r !== null;
    }

    private function paginatedOrders(
        string $whereClause,
        array  $params,
        int    $page,
        int    $limit
    ): array {
        $page  = max(1, $page);
        $limit = min(50, max(1, $limit));
        $offset = ($page - 1) * $limit;

        $total = $this->db->queryOne(
            "SELECT COUNT(*) as count FROM orders o WHERE {$whereClause}",
            $params
        )['count'];

        $orders = $this->db->query(
            "SELECT o.id, o.status, o.total, o.subtotal, o.delivery_fee,
                    o.delivery_address, o.created_at, o.updated_at,
                    r.name as restaurant_name
             FROM orders o
             JOIN restaurants r ON r.id = o.restaurant_id
             WHERE {$whereClause}
             ORDER BY o.created_at DESC
             LIMIT :limit OFFSET :offset",
            array_merge($params, ['limit' => $limit, 'offset' => $offset])
        );

        return [
            'orders'     => $orders,
            'pagination' => compact('page', 'limit', 'total'),
        ];
    }
}
