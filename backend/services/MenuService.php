<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\BusinessException;

class MenuService
{
    private const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    private const MAX_IMAGE_SIZE      = 3 * 1024 * 1024; // 3 MB

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

    public function uploadImage(string $itemId, string $vendorId, string $role): array
    {
        $item = $this->db->queryOne(
            "SELECT mi.id, mi.image_path, r.vendor_id FROM menu_items mi
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

        if (!isset($_FILES['image'])) {
            throw new BusinessException('No file uploaded', 400, 'VALIDATION_FAILED');
        }

        $file = $_FILES['image'];

        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new BusinessException('File upload failed', 400, 'UPLOAD_ERROR');
        }

        if ($file['size'] > self::MAX_IMAGE_SIZE) {
            throw new BusinessException('Image must be under 3MB', 422, 'VALIDATION_FAILED');
        }

        $finfo    = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);

        if (!in_array($mimeType, self::ALLOWED_IMAGE_TYPES, true)) {
            throw new BusinessException('Image must be JPG, PNG, or WebP', 422, 'VALIDATION_FAILED');
        }

        $ext = match($mimeType) {
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'image/webp' => 'webp',
        };

        $filename = bin2hex(random_bytes(16)) . '.' . $ext;
        $dir      = FC_ROOT . '/uploads/menu';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $destPath = $dir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            throw new BusinessException('Failed to save file', 500, 'UPLOAD_ERROR');
        }

        $imagePath = '/uploads/menu/' . $filename;

        // Remove old image if present
        if (!empty($item['image_path'])) {
            $oldFile = FC_ROOT . $item['image_path'];
            if (is_file($oldFile)) {
                @unlink($oldFile);
            }
        }

        $this->db->execute(
            "UPDATE menu_items SET image_path = :path WHERE id = :id",
            ['path' => $imagePath, 'id' => $itemId]
        );

        $baseUrl = $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com';
        return ['image_url' => $baseUrl . $imagePath];
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
