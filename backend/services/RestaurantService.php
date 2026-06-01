<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\BusinessException;

class RestaurantService
{
    private const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    private const MAX_LOGO_SIZE      = 2 * 1024 * 1024; // 2 MB

    public function __construct(private Database $db) {}

    public function list(array $query): array
    {
        $where  = ['1=1'];
        $params = [];

        if (isset($query['open']) && $query['open'] === 'true') {
            $where[] = 'r.is_open = true';
        }

        if (!empty($query['cuisine'])) {
            $where[]           = ':cuisine = ANY(r.cuisine_tags)';
            $params['cuisine'] = strtolower($query['cuisine']);
        }

        if (!empty($query['search'])) {
            $where[]          = 'r.name ILIKE :search';
            $params['search'] = '%' . $query['search'] . '%';
        }

        $page   = max(1, (int)($query['page'] ?? 1));
        $limit  = min(50, max(1, (int)($query['limit'] ?? 20)));
        $offset = ($page - 1) * $limit;

        $whereStr = implode(' AND ', $where);

        $total = $this->db->queryOne(
            "SELECT COUNT(*) as count FROM restaurants r WHERE {$whereStr}",
            $params
        )['count'];

        $rows = $this->db->query(
            "SELECT r.id, r.name, r.description, r.address, r.phone,
                    r.logo_path, r.is_open, r.cuisine_tags
             FROM restaurants r
             WHERE {$whereStr}
             ORDER BY r.is_open DESC, r.name ASC
             LIMIT :limit OFFSET :offset",
            array_merge($params, ['limit' => $limit, 'offset' => $offset])
        );

        $rows = array_map(fn($r) => $this->formatRestaurant($r), $rows);

        return ['restaurants' => $rows, 'pagination' => compact('page', 'limit', 'total')];
    }

    public function findById(string $id): array
    {
        $r = $this->db->queryOne(
            "SELECT * FROM restaurants WHERE id = :id",
            ['id' => $id]
        );

        if (!$r) {
            throw new BusinessException('Restaurant not found', 404, 'RESOURCE_NOT_FOUND');
        }

        return $this->formatRestaurant($r);
    }

    public function update(string $restaurantId, string $vendorId, string $role, array $data): array
    {
        if ($role === 'vendor') {
            $owns = $this->db->queryOne(
                "SELECT id FROM restaurants WHERE id = :rid AND vendor_id = :vid",
                ['rid' => $restaurantId, 'vid' => $vendorId]
            );
            if (!$owns) {
                throw new BusinessException('Access denied', 403, 'FORBIDDEN_OWNERSHIP');
            }
        }

        Validator::make($data, [
            'name'        => 'nullable|string|min:2|max:255',
            'description' => 'nullable|string|max:2000',
            'address'     => 'nullable|string|min:5|max:500',
            'phone'       => 'nullable|string|max:30',
            'is_open'     => 'nullable|boolean',
        ]);

        $allowed = ['name', 'description', 'address', 'phone', 'is_open'];
        $updates = [];
        $params  = ['id' => $restaurantId];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $updates[] = "{$field} = :{$field}";
                $params[$field] = $data[$field];
            }
        }

        if (isset($data['cuisine_tags']) && is_array($data['cuisine_tags'])) {
            $tags = array_map('strtolower', array_slice($data['cuisine_tags'], 0, 10));
            $updates[] = "cuisine_tags = :cuisine_tags";
            $params['cuisine_tags'] = '{' . implode(',', $tags) . '}';
        }

        if (empty($updates)) {
            return $this->findById($restaurantId);
        }

        $updated = $this->db->update(
            "UPDATE restaurants SET " . implode(', ', $updates) . " WHERE id = :id",
            $params
        );

        return $this->formatRestaurant($updated);
    }

    public function uploadLogo(string $restaurantId, string $vendorId, string $role): array
    {
        if ($role === 'vendor') {
            $owns = $this->db->queryOne(
                "SELECT id FROM restaurants WHERE id = :rid AND vendor_id = :vid",
                ['rid' => $restaurantId, 'vid' => $vendorId]
            );
            if (!$owns) {
                throw new BusinessException('Access denied', 403, 'FORBIDDEN_OWNERSHIP');
            }
        }

        if (!isset($_FILES['logo'])) {
            throw new BusinessException('No file uploaded', 400, 'VALIDATION_FAILED');
        }

        $file = $_FILES['logo'];

        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new BusinessException('File upload failed', 400, 'UPLOAD_ERROR');
        }

        if ($file['size'] > self::MAX_LOGO_SIZE) {
            throw new BusinessException('Logo must be under 2MB', 422, 'VALIDATION_FAILED');
        }

        $finfo    = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);

        if (!in_array($mimeType, self::ALLOWED_LOGO_TYPES, true)) {
            throw new BusinessException('Logo must be JPG, PNG, or WebP', 422, 'VALIDATION_FAILED');
        }

        $ext      = match($mimeType) {
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'image/webp' => 'webp',
        };
        $filename = bin2hex(random_bytes(16)) . '.' . $ext;
        $destPath = FC_ROOT . '/uploads/logos/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            throw new BusinessException('Failed to save file', 500, 'UPLOAD_ERROR');
        }

        $logoPath = '/uploads/logos/' . $filename;

        $this->db->execute(
            "UPDATE restaurants SET logo_path = :path WHERE id = :id",
            ['path' => $logoPath, 'id' => $restaurantId]
        );

        $baseUrl = $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com';
        return ['logo_url' => $baseUrl . $logoPath];
    }

    private function formatRestaurant(array $r): array
    {
        $baseUrl = $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com';

        $tags = [];
        if (!empty($r['cuisine_tags'])) {
            if (is_string($r['cuisine_tags'])) {
                $tags = array_filter(explode(',', trim($r['cuisine_tags'], '{}')));
            } elseif (is_array($r['cuisine_tags'])) {
                $tags = $r['cuisine_tags'];
            }
        }

        return [
            'id'           => $r['id'],
            'name'         => $r['name'],
            'description'  => $r['description'],
            'address'      => $r['address'],
            'phone'        => $r['phone'],
            'logo_url'     => $r['logo_path'] ? $baseUrl . $r['logo_path'] : null,
            'is_open'      => (bool)$r['is_open'],
            'cuisine_tags' => array_values($tags),
        ];
    }
}
