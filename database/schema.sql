-- =============================================================
-- FlavourConnect — PostgreSQL Schema
-- Production-grade, normalized, constrained
-- =============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUM TYPES
-- =============================================================

CREATE TYPE user_role AS ENUM ('customer', 'vendor', 'driver', 'admin');

CREATE TYPE order_status AS ENUM (
    'pending',
    'accepted',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
    'cancelled'
);

CREATE TYPE payment_method AS ENUM ('cash');

CREATE TYPE payment_status AS ENUM ('pending', 'collected', 'refunded');

-- =============================================================
-- USERS
-- =============================================================

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,   -- Argon2id
    role          user_role    NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    phone         VARCHAR(30),
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    is_online     BOOLEAN      NOT NULL DEFAULT false, -- drivers only
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Phone required for drivers
    CONSTRAINT chk_driver_phone CHECK (
        role != 'driver' OR phone IS NOT NULL
    )
);

CREATE INDEX idx_users_email  ON users(email);
CREATE INDEX idx_users_role   ON users(role);

-- =============================================================
-- REFRESH TOKENS
-- =============================================================

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,  -- SHA-256 hash of raw token
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address  INET,
    user_agent  TEXT
);

CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash    ON refresh_tokens(token_hash);

-- =============================================================
-- RESTAURANTS
-- =============================================================

CREATE TABLE restaurants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id     UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    address       TEXT         NOT NULL,
    phone         VARCHAR(30)  NOT NULL,
    logo_path     VARCHAR(500),
    is_open       BOOLEAN      NOT NULL DEFAULT false,
    cuisine_tags  VARCHAR(50)[] DEFAULT '{}',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_restaurant_vendor CHECK (
        vendor_id IS NOT NULL
    )
);

CREATE INDEX idx_restaurants_vendor  ON restaurants(vendor_id);
CREATE INDEX idx_restaurants_is_open ON restaurants(is_open);

-- =============================================================
-- MENU ITEMS
-- =============================================================

CREATE TABLE menu_items (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID         NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    price         NUMERIC(10,2) NOT NULL,
    image_path    VARCHAR(500),
    is_available  BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_price_positive CHECK (price > 0)
);

CREATE INDEX idx_menu_items_restaurant   ON menu_items(restaurant_id);
CREATE INDEX idx_menu_items_available    ON menu_items(is_available);

-- =============================================================
-- CARTS
-- =============================================================

CREATE TABLE carts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_carts_customer    ON carts(customer_id);
CREATE INDEX idx_carts_restaurant  ON carts(restaurant_id);

-- =============================================================
-- CART ITEMS
-- =============================================================

CREATE TABLE cart_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id      UUID         NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    menu_item_id UUID         NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    quantity     INTEGER      NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE(cart_id, menu_item_id),

    CONSTRAINT chk_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);

-- =============================================================
-- ORDERS
-- =============================================================

CREATE TABLE orders (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID         NOT NULL REFERENCES users(id),
    restaurant_id       UUID         NOT NULL REFERENCES restaurants(id),
    driver_id           UUID         REFERENCES users(id),
    status              order_status NOT NULL DEFAULT 'pending',

    -- Snapshot fields — immutable after creation
    delivery_address    TEXT         NOT NULL,
    subtotal            NUMERIC(10,2) NOT NULL,
    delivery_fee        NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total               NUMERIC(10,2) NOT NULL,

    -- Timestamps per state
    accepted_at         TIMESTAMPTZ,
    preparing_at        TIMESTAMPTZ,
    ready_at            TIMESTAMPTZ,
    picked_up_at        TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_total_positive   CHECK (total > 0),
    CONSTRAINT chk_subtotal_positive CHECK (subtotal > 0),
    CONSTRAINT chk_driver_delivery  CHECK (
        (status NOT IN ('out_for_delivery', 'delivered')) OR driver_id IS NOT NULL
    )
);

CREATE INDEX idx_orders_customer    ON orders(customer_id);
CREATE INDEX idx_orders_restaurant  ON orders(restaurant_id);
CREATE INDEX idx_orders_driver      ON orders(driver_id);
CREATE INDEX idx_orders_status      ON orders(status);

-- =============================================================
-- ORDER ITEMS (Snapshot of menu items at time of order)
-- =============================================================

CREATE TABLE order_items (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id  UUID          NOT NULL REFERENCES menu_items(id),
    name          VARCHAR(255)  NOT NULL,   -- snapshot
    price         NUMERIC(10,2) NOT NULL,   -- snapshot
    quantity      INTEGER       NOT NULL,
    line_total    NUMERIC(10,2) NOT NULL,

    CONSTRAINT chk_order_item_quantity  CHECK (quantity > 0),
    CONSTRAINT chk_order_item_price     CHECK (price > 0),
    CONSTRAINT chk_line_total           CHECK (line_total > 0)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- =============================================================
-- PAYMENTS
-- =============================================================

CREATE TABLE payments (
    id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID           NOT NULL UNIQUE REFERENCES orders(id),
    method         payment_method NOT NULL DEFAULT 'cash',
    status         payment_status NOT NULL DEFAULT 'pending',
    amount         NUMERIC(10,2)  NOT NULL,
    collected_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_payment_amount CHECK (amount > 0)
);

CREATE INDEX idx_payments_order ON payments(order_id);

-- =============================================================
-- AUDIT LOG (immutable append-only)
-- =============================================================

CREATE TABLE audit_log (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     UUID         REFERENCES users(id),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   UUID,
    meta        JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user   ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- =============================================================
-- UPDATED_AT TRIGGER
-- =============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_restaurants_updated_at
    BEFORE UPDATE ON restaurants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_menu_items_updated_at
    BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_carts_updated_at
    BEFORE UPDATE ON carts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cart_items_updated_at
    BEFORE UPDATE ON cart_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- ORDER STATE MACHINE ENFORCEMENT TRIGGER
-- =============================================================

CREATE OR REPLACE FUNCTION enforce_order_state_machine()
RETURNS TRIGGER AS $$
DECLARE
    valid_transitions TEXT[][] := ARRAY[
        ARRAY['pending',          'accepted'],
        ARRAY['pending',          'cancelled'],
        ARRAY['accepted',         'preparing'],
        ARRAY['preparing',        'ready'],
        ARRAY['ready',            'out_for_delivery'],
        ARRAY['out_for_delivery', 'delivered']
    ];
    t TEXT[];
    allowed BOOLEAN := false;
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    FOREACH t SLICE 1 IN ARRAY valid_transitions LOOP
        IF t[1] = OLD.status::TEXT AND t[2] = NEW.status::TEXT THEN
            allowed := true;
            EXIT;
        END IF;
    END LOOP;

    IF NOT allowed THEN
        RAISE EXCEPTION 'Invalid order status transition: % → %', OLD.status, NEW.status;
    END IF;

    -- Record timestamp per state
    CASE NEW.status
        WHEN 'accepted'         THEN NEW.accepted_at   := NOW();
        WHEN 'preparing'        THEN NEW.preparing_at  := NOW();
        WHEN 'ready'            THEN NEW.ready_at      := NOW();
        WHEN 'out_for_delivery' THEN NEW.picked_up_at  := NOW();
        WHEN 'delivered'        THEN NEW.delivered_at  := NOW();
        WHEN 'cancelled'        THEN NEW.cancelled_at  := NOW();
        ELSE NULL;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_state_machine
    BEFORE UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION enforce_order_state_machine();

-- =============================================================
-- SINGLE ACTIVE DELIVERY PER DRIVER CONSTRAINT
-- =============================================================

CREATE UNIQUE INDEX idx_driver_active_delivery
    ON orders(driver_id)
    WHERE status = 'out_for_delivery';

-- =============================================================
-- VIEWS
-- =============================================================

CREATE VIEW v_cart_totals AS
SELECT
    c.id          AS cart_id,
    c.customer_id,
    c.restaurant_id,
    COALESCE(SUM(ci.quantity * mi.price), 0) AS subtotal,
    COUNT(ci.id) AS item_count
FROM carts c
LEFT JOIN cart_items ci ON ci.cart_id = c.id
LEFT JOIN menu_items mi ON mi.id = ci.menu_item_id
GROUP BY c.id, c.customer_id, c.restaurant_id;
