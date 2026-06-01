<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\BusinessException;

class MenuService
{
    public function __construct(private Database $db) {}

    public function getMenu(string $restaurantId, array $query): array
    {
        $where  = ['mi.restaurant_id = :rid'];
        $params = ['rid' => $restaurantId];

        if (isset($query['available']) && $query['available'] === 'true') {
            $where[] = 'mi.is_available = true';
        }

        $items = $this->db->query(
            "SELECT mi.id, mi.name, mi.description, mi.price,
                    mi.image_path, mi.is_available
             FROM menu_items mi
             WHERE " . implode(' AND ', $where) . "
             ORDER BY mi.name ASC",
            $params
        );

        return ['menu_items' => array_map(fn($i) => $this->formatItem($i), $items)];
    }

    public function create(string $vendorId, array $data): array
    {
        Validator::make($data, [
            'restaurant_id' => 'required|uuid',
            'name'          => 'required|string|min:2|max:255',
            'description'   => 'nullable|string|max:2000',
            'price'         => 'required|numeric|positive',
        ]);

        $restaurant = $this->db->queryOne(
            "SELECT id FROM restaurants WHERE id = :rid AND vendor_id = :vid",
            ['rid' => $data['restaurant_id'], 'vid' => $vendorId]
        );

        if (!$restaurant) {
            throw new BusinessException('Restaurant not found or access denied', 403, 'FORBIDDEN_OWNERSHIP');
        }

        $item = $this->db->insert(
            "INSERT INTO menu_items (restaurant_id, name, description, price)
             VALUES (:rid, :name, :desc, :price)",
            [
                'rid'   => $data['restaurant_id'],
                'name'  => $data['name'],
                'desc'  => $data['description'] ?? null,
                'price' => round((float)$data['price'], 2),
            ]
        );

        return ['menu_item' => $this->formatItem($item)];
    }

    public function update(string $itemId, string $vendorId, string $role, array $data): array
    {
        $item = $this->db->queryOne(
            "SELECT mi.*, r.vendor_id FROM menu_items mi
             JOIN restaurants r ON r.id = mi.restaurant_id
             WHERE mi.id = :id",
            ['id' => $itemId]
        );

        if (!$item) {
            throw new BusinessException('Menu item not found', 404, 'RESOURCE_NOT_FOUND');
        }

        if ($role === 'vendor' && $item['vendor_id'] !== $vendorId) {
            throw new BusinessException('Access denied', 403, 'FORBIDDEN_OWNERSHIP');
        }

        Validator::make($data, [
            'name'         => 'nullable|string|min:2|max:255',
            'description'  => 'nullable|string|max:2000',
            'price'        => 'nullable|numeric|positive',
            'is_available' => 'nullable|boolean',
        ]);

        $allowed = ['name', 'description', 'is_available'];
        $updates = [];
        $params  = ['id' => $itemId];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $updates[] = "{$field} = :{$field}";
                $params[$field] = $data[$field];
            }
        }

        if (isset($data['price'])) {
            $updates[] = "price = :price";
            $params['price'] = round((float)$data['price'], 2);
        }

        if (empty($updates)) {
            return ['menu_item' => $this->formatItem($item)];
        }

        $updated = $this->db->update(
            "UPDATE menu_items SET " . implode(', ', $updates) . " WHERE id = :id",
            $params
        );

        return ['menu_item' => $this->formatItem($updated)];
    }

    public function destroy(string $itemId, string $vendorId, string $role): void
    {
        $item = $this->db->queryOne(
            "SELECT mi.id, r.vendor_id FROM menu_items mi
             JOIN restaurants r ON r.id = mi.restaurant_id
             WHERE mi.id = :id",
            ['id' => $itemId]
        );

        if (!$item) {
            throw new BusinessException('Menu item not found', 404, 'RESOURCE_NOT_FOUND');
        }

        if ($role === 'vendor' && $item['vendor_id'] !== $vendorId) {
            throw new BusinessException('Access denied', 403, 'FORBIDDEN_OWNERSHIP');
        }

        // Soft-delete: preserves order history integrity
        $this->db->execute(
            "UPDATE menu_items SET is_available = false WHERE id = :id",
            ['id' => $itemId]
        );
    }

    private function formatItem(array $item): array
    {
        $baseUrl = $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com';
        return [
            'id'           => $item['id'],
            'name'         => $item['name'],
            'description'  => $item['description'],
            'price'        => (float)$item['price'],
            'image_url'    => $item['image_path'] ? $baseUrl . $item['image_path'] : null,
            'is_available' => (bool)$item['is_available'],
        ];
    }
}
