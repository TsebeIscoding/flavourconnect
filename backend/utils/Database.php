<?php

declare(strict_types=1);

namespace FlavourConnect\Utils;

use PDO;
use PDOException;

// ─────────────────────────────────────────────────────────────
// Database — PDO wrapper
// NEVER use raw string interpolation in queries
// ALL queries use prepared statements
// ─────────────────────────────────────────────────────────────

class Database
{
    private PDO $pdo;

    public function __construct()
    {
        $host   = $_ENV['DB_HOST']     ?? 'localhost';
        $port   = $_ENV['DB_PORT']     ?? '5432';
        $name   = $_ENV['DB_NAME']     ?? 'flavourconnect';
        $user   = $_ENV['DB_USER']     ?? 'fc_user';
        $pass   = $_ENV['DB_PASSWORD'] ?? '';

        $dsn = "pgsql:host={$host};port={$port};dbname={$name};sslmode=require";

        try {
            $this->pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_STRINGIFY_FETCHES  => false,
            ]);
        } catch (PDOException $e) {
            // Log internally, never expose credentials
            error_log('DB connection failed: ' . $e->getMessage());
            throw new \RuntimeException('Database unavailable', 503);
        }
    }

    /** Execute a SELECT and return all rows */
    public function query(string $sql, array $params = []): array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** Execute a SELECT and return first row or null */
    public function queryOne(string $sql, array $params = []): ?array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    /** Execute INSERT/UPDATE/DELETE and return affected rows */
    public function execute(string $sql, array $params = []): int
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    /** Execute INSERT and return the new row */
    public function insert(string $sql, array $params = []): ?array
    {
        $stmt = $this->pdo->prepare($sql . ' RETURNING *');
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    /** Execute UPDATE and return the updated row */
    public function update(string $sql, array $params = []): ?array
    {
        $stmt = $this->pdo->prepare($sql . ' RETURNING *');
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    public function beginTransaction(): void
    {
        $this->pdo->beginTransaction();
    }

    public function commit(): void
    {
        $this->pdo->commit();
    }

    public function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }

    public function lastInsertId(): string
    {
        return $this->pdo->lastInsertId();
    }
}
