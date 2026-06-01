-- Rate limit log table (required by RateLimiter middleware)
-- Add this to schema.sql migrations

CREATE TABLE rate_limit_log (
    id         BIGSERIAL   PRIMARY KEY,
    key        VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_key_time ON rate_limit_log(key, created_at);

-- Vendor's restaurant lookup endpoint (GET /restaurants/mine)
-- This is a convenience endpoint for vendor dashboard
-- Add to Router:
-- $this->add('GET', '/restaurants/mine', [RestaurantController::class, 'mine'], auth: true, roles: ['vendor']);
