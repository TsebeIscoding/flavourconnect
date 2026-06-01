<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\BusinessException;

// ─────────────────────────────────────────────────────────────
// CartService — Cart management
// Enforces: one cart per customer, one restaurant per cart
// Server computes ALL totals
// ─────────────────────────────────────────────────────────────

class CartService
{
    public function __construct(private Database $db) {}

    public function getCart(string $customerId): array
    {
        $cart = $this->getOrCreateCart($customerId);
        return $this->formatCart($cart);
    }

    public function addItem(string $customerId, array $data): array
    {
        Validator::make($data, [
            'menu_item_id' => 'required|uuid',
            'quantity'     => 'required|integer|min:1|max:99',
        ]);

        $menuItem = $this->db->queryOne(
            "SELECT mi.*, r.id as restaurant_id, r.is_open
             FROM menu_items mi
             JOIN restaurants r ON r.id = mi.restaurant_id
             WHERE mi.id = :id",
            ['id' => $data['menu_item_id']]
        );

        if (!$menuItem) {
            throw new BusinessException('Menu item not found', 404, 'RESOURCE_NOT_FOUND');
        }

        if (!$menuItem['is_available']) {
            throw new BusinessException('This item is currently unavailable', 422, 'ITEM_UNAVAILABLE');
        }

        $cart = $this->getOrCreateCart($customerId);

        // Enforce single-restaurant constraint
        if ($cart['restaurant_id'] !== null && $cart['restaurant_id'] !== $menuItem['restaurant_id']) {
            throw new BusinessException(
                'Your cart contains items from a different restaurant. Clear your cart first.',
                409,
                'CONFLICT_CART_RESTAURANT'
            );
        }

        $this->db->beginTransaction();
        try {
            // Set restaurant on cart if not set
            if ($cart['restaurant_id'] === null) {
                $this->db->execute(
                    "UPDATE carts SET restaurant_id = :rid WHERE id = :id",
                    ['rid' => $menuItem['restaurant_id'], 'id' => $cart['id']]
                );
                $cart['restaurant_id'] = $menuItem['restaurant_id'];
            }

            // Upsert cart item
            $existing = $this->db->queryOne(
                "SELECT id, quantity FROM cart_items
                 WHERE cart_id = :cart_id AND menu_item_id = :item_id",
                ['cart_id' => $cart['id'], 'item_id' => $data['menu_item_id']]
            );

            if ($existing) {
                $newQty = $existing['quantity'] + (int)$data['quantity'];
                if ($newQty > 99) {
                    throw new BusinessException('Maximum quantity is 99 per item', 422, 'VALIDATION_FAILED');
                }
                $this->db->execute(
                    "UPDATE cart_items SET quantity = :qty WHERE id = :id",
                    ['qty' => $newQty, 'id' => $existing['id']]
                );
            } else {
                $this->db->execute(
                    "INSERT INTO cart_items (cart_id, menu_item_id, quantity)
                     VALUES (:cart_id, :item_id, :qty)",
                    [
                        'cart_id' => $cart['id'],
                        'item_id' => $data['menu_item_id'],
                        'qty'     => (int)$data['quantity'],
                    ]
                );
            }

            $this->db->commit();
            return $this->formatCart($cart);
        } catch (\Throwable $e) {
            $this->db->rollback();
            throw $e;
        }
    }

    public function removeItem(string $customerId, array $data): array
    {
        Validator::make($data, [
            'menu_item_id' => 'required|uuid',
        ]);

        $cart = $this->getOrCreateCart($customerId);

        $this->db->execute(
            "DELETE FROM cart_items
             WHERE cart_id = :cart_id AND menu_item_id = :item_id",
            ['cart_id' => $cart['id'], 'item_id' => $data['menu_item_id']]
        );

        // Clear restaurant if cart is now empty
        $remaining = $this->db->queryOne(
            "SELECT COUNT(*) as count FROM cart_items WHERE cart_id = :cart_id",
            ['cart_id' => $cart['id']]
        );

        if ((int)$remaining['count'] === 0) {
            $this->db->execute(
                "UPDATE carts SET restaurant_id = NULL WHERE id = :id",
                ['id' => $cart['id']]
            );
            $cart['restaurant_id'] = null;
        }

        return $this->formatCart($cart);
    }

    public function clearCart(string $customerId): void
    {
        $cart = $this->getOrCreateCart($customerId);

        $this->db->execute(
            "DELETE FROM cart_items WHERE cart_id = :cart_id",
            ['cart_id' => $cart['id']]
        );
        $this->db->execute(
            "UPDATE carts SET restaurant_id = NULL WHERE id = :id",
            ['id' => $cart['id']]
        );
    }

    private function getOrCreateCart(string $customerId): array
    {
        $cart = $this->db->queryOne(
            "SELECT id, restaurant_id FROM carts WHERE customer_id = :uid",
            ['uid' => $customerId]
        );

        if (!$cart) {
            $cart = $this->db->insert(
                "INSERT INTO carts (customer_id) VALUES (:uid)",
                ['uid' => $customerId]
            );
        }

        return $cart;
    }

    private function formatCart(array $cart): array
    {
        $items = $this->db->query(
            "SELECT ci.id as cart_item_id, ci.menu_item_id, mi.name,
                    mi.price, ci.quantity,
                    (mi.price * ci.quantity) as line_total
             FROM cart_items ci
             JOIN menu_items mi ON mi.id = ci.menu_item_id
             WHERE ci.cart_id = :cart_id",
            ['cart_id' => $cart['id']]
        );

        $restaurant = null;
        if ($cart['restaurant_id']) {
            $restaurant = $this->db->queryOne(
                "SELECT id, name FROM restaurants WHERE id = :id",
                ['id' => $cart['restaurant_id']]
            );
        }

        // Server-side total computation
        $subtotal = array_sum(array_column($items, 'line_total'));
        $subtotal = round($subtotal, 2);

        return [
            'id'              => $cart['id'],
            'restaurant_id'   => $cart['restaurant_id'],
            'restaurant_name' => $restaurant['name'] ?? null,
            'items'           => $items,
            'subtotal'        => $subtotal,
            'item_count'      => count($items),
        ];
    }
}
