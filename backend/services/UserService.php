<?php

declare(strict_types=1);

namespace FlavourConnect\Services;

use FlavourConnect\Utils\Database;
use FlavourConnect\Utils\Validator;
use FlavourConnect\Exceptions\BusinessException;

// ─────────────────────────────────────────────────────────────
// UserService — Profile management for ALL roles.
// Avatar upload is available to everyone, but is primarily used
// by drivers (shown to customers during delivery tracking).
// ─────────────────────────────────────────────────────────────

class UserService
{
    private const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    private const MAX_AVATAR_SIZE     = 2 * 1024 * 1024; // 2 MB

    public function __construct(private Database $db) {}

    public function getProfile(string $userId): array
    {
        $user = $this->db->queryOne(
            "SELECT id, email, role, full_name, phone, avatar_path, is_online, created_at
             FROM users WHERE id = :id",
            ['id' => $userId]
        );

        if (!$user) {
            throw new BusinessException('User not found', 404, 'RESOURCE_NOT_FOUND');
        }

        return $this->formatUser($user);
    }

    public function updateProfile(string $userId, array $data): array
    {
        Validator::make($data, [
            'full_name' => 'nullable|string|min:2|max:255',
            'phone'     => 'nullable|string|max:30',
        ]);

        $allowed = ['full_name', 'phone'];
        $updates = [];
        $params  = ['id' => $userId];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $updates[] = "{$field} = :{$field}";
                $params[$field] = $data[$field];
            }
        }

        if (empty($updates)) {
            return $this->getProfile($userId);
        }

        $updated = $this->db->update(
            "UPDATE users SET " . implode(', ', $updates) . " WHERE id = :id",
            $params
        );

        return $this->formatUser($updated);
    }

    public function uploadAvatar(string $userId): array
    {
        if (!isset($_FILES['avatar'])) {
            throw new BusinessException('No file uploaded', 400, 'VALIDATION_FAILED');
        }

        $file = $_FILES['avatar'];

        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new BusinessException('File upload failed', 400, 'UPLOAD_ERROR');
        }

        if ($file['size'] > self::MAX_AVATAR_SIZE) {
            throw new BusinessException('Photo must be under 2MB', 422, 'VALIDATION_FAILED');
        }

        $finfo    = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);

        if (!in_array($mimeType, self::ALLOWED_IMAGE_TYPES, true)) {
            throw new BusinessException('Photo must be JPG, PNG, or WebP', 422, 'VALIDATION_FAILED');
        }

        $ext = match($mimeType) {
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'image/webp' => 'webp',
        };

        $filename = bin2hex(random_bytes(16)) . '.' . $ext;
        $dir      = FC_ROOT . '/uploads/avatars';
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $destPath = $dir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            throw new BusinessException('Failed to save file', 500, 'UPLOAD_ERROR');
        }

        $avatarPath = '/uploads/avatars/' . $filename;

        // Remove old avatar file if present
        $existing = $this->db->queryOne(
            "SELECT avatar_path FROM users WHERE id = :id",
            ['id' => $userId]
        );
        if (!empty($existing['avatar_path'])) {
            $oldFile = FC_ROOT . $existing['avatar_path'];
            if (is_file($oldFile)) {
                @unlink($oldFile);
            }
        }

        $this->db->execute(
            "UPDATE users SET avatar_path = :path WHERE id = :id",
            ['path' => $avatarPath, 'id' => $userId]
        );

        $baseUrl = $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com';
        return ['avatar_url' => $baseUrl . $avatarPath];
    }

    private function formatUser(array $user): array
    {
        $baseUrl = $_ENV['APP_URL'] ?? 'https://api.flavourconnect.com';

        return [
            'id'         => $user['id'],
            'email'      => $user['email'],
            'role'       => $user['role'],
            'full_name'  => $user['full_name'],
            'phone'      => $user['phone'] ?? null,
            'avatar_url' => !empty($user['avatar_path']) ? $baseUrl . $user['avatar_path'] : null,
            'is_online'  => isset($user['is_online']) ? (bool)$user['is_online'] : null,
        ];
    }
}
