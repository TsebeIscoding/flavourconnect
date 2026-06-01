# FlavourConnect — Development Testing Guide

This document walks you through testing every part of the system manually,
step by step, before shipping to production. Follow the phases in order.
Each phase builds on the one before it.

You need four terminal windows open throughout this guide. Label them:

```
[T1] API server
[T2] WebSocket server
[T3] curl / HTTP tests
[T4] WebSocket listener
```

---

## Contents

1. [Environment Setup](#1-environment-setup)
2. [Database Verification](#2-database-verification)
3. [API Server Smoke Test](#3-api-server-smoke-test)
4. [Authentication Flow](#4-authentication-flow)
5. [Role Isolation Tests](#5-role-isolation-tests)
6. [Restaurant and Menu Tests](#6-restaurant-and-menu-tests)
7. [Cart Tests](#7-cart-tests)
8. [Full Order Lifecycle](#8-full-order-lifecycle)
9. [WebSocket Real-Time Tests](#9-websocket-real-time-tests)
10. [Security Boundary Tests](#10-security-boundary-tests)
11. [Edge Cases and Error Paths](#11-edge-cases-and-error-paths)
12. [Pre-Production Checklist](#12-pre-production-checklist)

---

## 1. Environment Setup

### 1.1 Check dependencies

```bash
make check-deps
```

Expected output: every item shows a green `✔`. Fix anything that shows `✘`
before continuing.

### 1.2 Create and configure the environment file

```bash
make env-setup
```

Open `backend/.env` and set these values for development:

```ini
APP_ENV=development
APP_URL=http://localhost:8000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=flavourconnect
DB_USER=fc_user
DB_PASSWORD=devpassword

JWT_SECRET=<output of: openssl rand -hex 64>
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=1209600

CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000,http://127.0.0.1:5500

WS_PORT=8080
WS_INTERNAL_URL=http://localhost:8081/internal
WS_INTERNAL_SECRET=<output of: openssl rand -hex 32>

TRUSTED_PROXIES=127.0.0.1,::1
UPLOAD_PATH=/tmp/fc_uploads
```

Generate the two secrets:

```bash
# JWT secret (paste the output into JWT_SECRET)
make gen-secret

# WS secret (paste the output into WS_INTERNAL_SECRET)
openssl rand -hex 32
```

Create the upload directory:

```bash
mkdir -p /tmp/fc_uploads/logos /tmp/fc_uploads/menu
```

### 1.3 Validate the environment

```bash
make env-check
```

Every variable must show `✔`. No item should say "placeholder".

---

## 2. Database Verification

### 2.1 Create the PostgreSQL user and database

```bash
psql -U postgres
```

Inside psql:

```sql
CREATE USER fc_user WITH PASSWORD 'devpassword';
CREATE DATABASE flavourconnect OWNER fc_user;
GRANT ALL PRIVILEGES ON DATABASE flavourconnect TO fc_user;
\q
```

### 2.2 Apply the schema

```bash
make db-setup
```

Expected: no errors. The output ends with `Database setup complete.`

### 2.3 Verify the schema loaded correctly

```bash
make db-shell
```

Inside psql, run each of these and confirm the output matches:

```sql
-- Should list all 10 tables
\dt

-- Expected:
--  audit_log
--  cart_items
--  carts
--  menu_items
--  order_items
--  orders
--  payments
--  rate_limit_log
--  refresh_tokens
--  restaurants
--  users

-- Confirm the order status enum exists
SELECT enum_range(NULL::order_status);
-- Expected: {pending,accepted,preparing,ready,out_for_delivery,delivered,cancelled}

-- Confirm the state machine trigger is in place
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'orders';
-- Expected: trg_order_state_machine, trg_orders_updated_at

-- Confirm the unique partial index for driver active delivery
SELECT indexname FROM pg_indexes
WHERE tablename = 'orders' AND indexname = 'idx_driver_active_delivery';
-- Expected: idx_driver_active_delivery

\q
```

---

## 3. API Server Smoke Test

### 3.1 Start the API server

In **[T1]**:

```bash
make serve-api
```

You should see:
```
API → http://localhost:8000/v1
PHP x.x.x Development Server (http://localhost:8000) started
```

### 3.2 Confirm it responds

In **[T3]**:

```bash
curl -s http://localhost:8000/v1/restaurants | python3 -m json.tool
```

Expected response shape:

```json
{
  "success": true,
  "data": {
    "restaurants": [],
    "pagination": { "page": 1, "limit": 20, "total": "0" }
  },
  "error": null,
  "meta": { "timestamp": "...", "request_id": "..." }
}
```

### 3.3 Confirm unknown routes return 404

```bash
curl -s http://localhost:8000/v1/doesnotexist | python3 -m json.tool
```

Expected: `"success": false`, HTTP 404, `"code": "NOT_FOUND"`.

### 3.4 Confirm wrong method returns 405

```bash
curl -s -X DELETE http://localhost:8000/v1/restaurants | python3 -m json.tool
```

Expected: HTTP 405, `"code": "METHOD_NOT_ALLOWED"`.

### 3.5 Confirm CORS blocks unlisted origins

```bash
curl -s -H "Origin: https://evil.com" \
     http://localhost:8000/v1/restaurants \
     -o /dev/null -w "%{http_code}"
```

Expected: `403`.

### 3.6 Confirm CORS allows listed origins

```bash
curl -s -H "Origin: http://localhost:3000" \
     http://localhost:8000/v1/restaurants \
     -o /dev/null -w "%{http_code}"
```

Expected: `200`, and the response headers include `Access-Control-Allow-Origin: http://localhost:3000`.

---

## 4. Authentication Flow

Set a shell variable for the base URL to keep commands short:

```bash
API="http://localhost:8000/v1"
```

### 4.1 Register a customer

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@test.com",
    "password": "TestPass!99",
    "full_name": "Alice Customer",
    "role": "customer"
  }' | python3 -m json.tool
```

Expected: HTTP 201, `"success": true`.
The response contains `access_token`, `refresh_token`, and a `user` object with `"role": "customer"`.

Save the tokens:

```bash
CUSTOMER_TOKEN="<paste access_token here>"
CUSTOMER_REFRESH="<paste refresh_token here>"
```

### 4.2 Register a vendor

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor@test.com",
    "password": "TestPass!99",
    "full_name": "Bob Vendor",
    "role": "vendor",
    "phone": "+27821112222"
  }' | python3 -m json.tool
```

Save the tokens:

```bash
VENDOR_TOKEN="<paste access_token here>"
VENDOR_REFRESH="<paste refresh_token here>"
```

### 4.3 Register a driver

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@test.com",
    "password": "TestPass!99",
    "full_name": "Carol Driver",
    "role": "driver",
    "phone": "+27823334444"
  }' | python3 -m json.tool
```

Save the tokens:

```bash
DRIVER_TOKEN="<paste access_token here>"
DRIVER_REFRESH="<paste refresh_token here>"
```

### 4.4 Confirm duplicate email is rejected

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@test.com",
    "password": "TestPass!99",
    "full_name": "Duplicate",
    "role": "customer"
  }' | python3 -m json.tool
```

Expected: HTTP 409, `"code": "CONFLICT_EMAIL_EXISTS"`.

### 4.5 Test login

```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@test.com",
    "password": "TestPass!99"
  }' | python3 -m json.tool
```

Expected: HTTP 200 with fresh tokens.

### 4.6 Test wrong password

```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@test.com",
    "password": "WrongPassword"
  }' | python3 -m json.tool
```

Expected: HTTP 401, `"code": "AUTH_INVALID_CREDENTIALS"`.

### 4.7 Test token refresh

```bash
curl -s -X POST "$API/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$CUSTOMER_REFRESH\"}" | python3 -m json.tool
```

Expected: HTTP 200. You receive a **new** `access_token` and a **new** `refresh_token`.
Update your saved tokens — the old refresh token is now invalid.

```bash
CUSTOMER_TOKEN="<new access_token>"
CUSTOMER_REFRESH="<new refresh_token>"
```

### 4.8 Confirm the old refresh token is revoked (reuse detection)

Try to use the refresh token you just rotated away:

```bash
curl -s -X POST "$API/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"<old refresh token>\"}" | python3 -m json.tool
```

Expected: HTTP 401, `"code": "AUTH_REFRESH_REVOKED"`.
Additionally, all sessions for that user should now be revoked. Confirm
by trying the new refresh token too — it should also return 401.

### 4.9 Test accessing a protected route without a token

```bash
curl -s "$API/cart" | python3 -m json.tool
```

Expected: HTTP 401, `"code": "AUTH_REQUIRED"`.

### 4.10 Test accessing a protected route with an expired/invalid token

```bash
curl -s "$API/cart" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.fake.token" \
  | python3 -m json.tool
```

Expected: HTTP 401, `"code": "AUTH_TOKEN_INVALID"`.

### 4.11 Test logout

```bash
curl -s -X POST "$API/auth/logout" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$CUSTOMER_REFRESH\"}" | python3 -m json.tool
```

Expected: HTTP 200, `"message": "Logged out successfully"`.

Log back in to get fresh tokens for the rest of the tests:

```bash
LOGIN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@test.com","password":"TestPass!99"}')

echo $LOGIN | python3 -m json.tool

CUSTOMER_TOKEN=$(echo $LOGIN | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['access_token'])")
CUSTOMER_REFRESH=$(echo $LOGIN | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['refresh_token'])")

# Do the same for vendor
LOGIN_V=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"vendor@test.com","password":"TestPass!99"}')

VENDOR_TOKEN=$(echo $LOGIN_V | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['access_token'])")
VENDOR_ID=$(echo $LOGIN_V | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['user']['id'])")

# And driver
LOGIN_D=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"driver@test.com","password":"TestPass!99"}')

DRIVER_TOKEN=$(echo $LOGIN_D | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['access_token'])")
```

---

## 5. Role Isolation Tests

These tests confirm that roles cannot access each other's endpoints.

### 5.1 Customer cannot access vendor endpoints

```bash
# Attempt to create a menu item as a customer
curl -s -X POST "$API/menu" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Hack","price":1.00,"restaurant_id":"00000000-0000-4000-8000-000000000000"}' \
  | python3 -m json.tool
```

Expected: HTTP 403, `"code": "FORBIDDEN_ROLE"`.

### 5.2 Vendor cannot access customer cart

```bash
curl -s "$API/cart" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  | python3 -m json.tool
```

Expected: HTTP 403, `"code": "FORBIDDEN_ROLE"`.

### 5.3 Driver cannot access vendor orders

```bash
curl -s "$API/orders/vendor" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  | python3 -m json.tool
```

Expected: HTTP 403, `"code": "FORBIDDEN_ROLE"`.

### 5.4 Customer cannot access driver orders

```bash
curl -s "$API/orders/driver" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  | python3 -m json.tool
```

Expected: HTTP 403, `"code": "FORBIDDEN_ROLE"`.

---

## 6. Restaurant and Menu Tests

### 6.1 Get the vendor's restaurant ID

When a vendor registers, a placeholder restaurant is created for them.
Fetch it:

```bash
RESTAURANTS=$(curl -s "$API/restaurants" \
  -H "Authorization: Bearer $VENDOR_TOKEN")

echo $RESTAURANTS | python3 -m json.tool

REST_ID=$(echo $RESTAURANTS | python3 -c \
  "import sys,json; rs=json.load(sys.stdin)['data']['restaurants']; print(rs[0]['id'])")

echo "Restaurant ID: $REST_ID"
```

### 6.2 Update the restaurant profile

```bash
curl -s -X PATCH "$API/restaurants/$REST_ID" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Napoli Pizza",
    "description": "Authentic Italian wood-fired pizza",
    "address": "12 Main Street, Cape Town",
    "phone": "+27211234567",
    "cuisine_tags": ["italian", "pizza"],
    "is_open": true
  }' | python3 -m json.tool
```

Expected: HTTP 200 with updated restaurant fields.

### 6.3 Confirm another vendor cannot update this restaurant

Create a second vendor and try to update the first vendor's restaurant:

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor2@test.com",
    "password": "TestPass!99",
    "full_name": "Eve Vendor",
    "role": "vendor",
    "phone": "+27825556666"
  }' > /tmp/v2.json

VENDOR2_TOKEN=$(python3 -c \
  "import json; d=json.load(open('/tmp/v2.json')); print(d['data']['access_token'])")

curl -s -X PATCH "$API/restaurants/$REST_ID" \
  -H "Authorization: Bearer $VENDOR2_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Hacked Name"}' | python3 -m json.tool
```

Expected: HTTP 403, `"code": "FORBIDDEN_OWNERSHIP"`.

### 6.4 Add menu items

```bash
ITEM1=$(curl -s -X POST "$API/menu" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurant_id\": \"$REST_ID\",
    \"name\": \"Margherita Pizza\",
    \"description\": \"Classic tomato, mozzarella, basil\",
    \"price\": 12.50
  }")

echo $ITEM1 | python3 -m json.tool

ITEM1_ID=$(echo $ITEM1 | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['menu_item']['id'])")

ITEM2=$(curl -s -X POST "$API/menu" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurant_id\": \"$REST_ID\",
    \"name\": \"Pepperoni Pizza\",
    \"description\": \"Tomato, mozzarella, pepperoni\",
    \"price\": 14.00
  }")

ITEM2_ID=$(echo $ITEM2 | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['menu_item']['id'])")

echo "Item 1 ID: $ITEM1_ID"
echo "Item 2 ID: $ITEM2_ID"
```

### 6.5 Confirm price must be positive

```bash
curl -s -X POST "$API/menu" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurant_id\": \"$REST_ID\",
    \"name\": \"Free Item\",
    \"price\": -1
  }" | python3 -m json.tool
```

Expected: HTTP 400, `"code": "VALIDATION_FAILED"`.

### 6.6 Fetch the public menu

```bash
curl -s "$API/restaurants/$REST_ID/menu" | python3 -m json.tool
```

Expected: HTTP 200, both items returned.

### 6.7 Update a menu item

```bash
curl -s -X PATCH "$API/menu/$ITEM1_ID" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price": 13.00, "is_available": true}' | python3 -m json.tool
```

Expected: HTTP 200, price updated to `13.00`.

### 6.8 Disable a menu item

```bash
curl -s -X PATCH "$API/menu/$ITEM2_ID" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_available": false}' | python3 -m json.tool
```

Expected: HTTP 200, `"is_available": false`.

---

## 7. Cart Tests

### 7.1 Fetch empty cart

```bash
curl -s "$API/cart" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | python3 -m json.tool
```

Expected: HTTP 200, `"items": []`, `"subtotal": 0`.

### 7.2 Add an available item

```bash
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM1_ID\", \"quantity\": 2}" | python3 -m json.tool
```

Expected: HTTP 200. Cart has 1 item, quantity 2, subtotal is `26.00` (2 × $13.00).

**Verify the server computed the subtotal** — the response total must match
`price × quantity` from the database, not anything the client sent.

### 7.3 Try to add a disabled item

```bash
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM2_ID\", \"quantity\": 1}" | python3 -m json.tool
```

Expected: HTTP 422, `"code": "ITEM_UNAVAILABLE"`.

### 7.4 Re-enable item 2 and add it

```bash
curl -s -X PATCH "$API/menu/$ITEM2_ID" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_available": true}' > /dev/null

curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM2_ID\", \"quantity\": 1}" | python3 -m json.tool
```

Expected: Cart now has 2 distinct items.

### 7.5 Test single-restaurant enforcement

Create a second restaurant with a menu item, then try to add it to the cart:

```bash
# Create a second vendor and their restaurant
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor3@test.com",
    "password": "TestPass!99",
    "full_name": "Dan Vendor",
    "role": "vendor",
    "phone": "+27827778888"
  }' > /tmp/v3.json

VENDOR3_TOKEN=$(python3 -c \
  "import json; d=json.load(open('/tmp/v3.json')); print(d['data']['access_token'])")

# Get the second restaurant ID
RESTAURANTS2=$(curl -s "$API/restaurants" -H "Authorization: Bearer $VENDOR3_TOKEN")
REST2_ID=$(echo $RESTAURANTS2 | python3 -c \
  "import sys,json; rs=json.load(sys.stdin)['data']['restaurants']; \
  print([r for r in rs if r['id'] != '$REST_ID'][0]['id'])")

# Open the second restaurant and add a menu item to it
curl -s -X PATCH "$API/restaurants/$REST2_ID" \
  -H "Authorization: Bearer $VENDOR3_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_open": true, "name": "Burger Barn", "address": "5 Oak Ave", "phone": "+27210000001"}' > /dev/null

ITEM3=$(curl -s -X POST "$API/menu" \
  -H "Authorization: Bearer $VENDOR3_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurant_id\": \"$REST2_ID\",
    \"name\": \"Cheeseburger\",
    \"price\": 9.00
  }")

ITEM3_ID=$(echo $ITEM3 | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['menu_item']['id'])")

# Now try to add item from restaurant 2 into a cart that has items from restaurant 1
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM3_ID\", \"quantity\": 1}" | python3 -m json.tool
```

Expected: HTTP 409, `"code": "CONFLICT_CART_RESTAURANT"`.

### 7.6 Remove an item from the cart

```bash
curl -s -X POST "$API/cart/remove" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM2_ID\"}" | python3 -m json.tool
```

Expected: HTTP 200. Cart now has only item 1 with quantity 2.

---

## 8. Full Order Lifecycle

This is the core integration test. Work through every state in sequence.

### 8.1 Confirm checkout fails if restaurant is closed

Close the restaurant temporarily:

```bash
curl -s -X PATCH "$API/restaurants/$REST_ID" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_open": false}' > /dev/null

curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "42 Customer Lane, Cape Town"}' | python3 -m json.tool
```

Expected: HTTP 409, `"code": "RESTAURANT_CLOSED"`.

Reopen it:

```bash
curl -s -X PATCH "$API/restaurants/$REST_ID" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_open": true}' > /dev/null
```

### 8.2 Place an order (customer)

```bash
ORDER=$(curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "42 Customer Lane, Cape Town, 8001"}')

echo $ORDER | python3 -m json.tool

ORDER_ID=$(echo $ORDER | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['order']['id'])")

echo "Order ID: $ORDER_ID"
```

Expected: HTTP 201.

Verify these server-computed fields are correct:
- `"status": "pending"`
- `"subtotal"` equals `2 × 13.00 = 26.00`
- `"delivery_fee": 2.00`
- `"total": 28.00`
- `"delivery_address"` matches exactly what you submitted
- Cart is now empty (verify with `GET /cart`)

```bash
curl -s "$API/cart" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | python3 -m json.tool
# items should be []
```

### 8.3 Confirm order state machine — customer can cancel before acceptance

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "cancelled"}' | python3 -m json.tool
```

Expected: HTTP 200, `"status": "cancelled"`.

Place a fresh order for the rest of the lifecycle test. Re-add items to cart first:

```bash
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM1_ID\", \"quantity\": 1}" > /dev/null

ORDER=$(curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "42 Customer Lane, Cape Town, 8001"}')

ORDER_ID=$(echo $ORDER | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['order']['id'])")

echo "Fresh Order ID: $ORDER_ID"
```

### 8.4 Vendor accepts the order

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "accepted"}' | python3 -m json.tool
```

Expected: HTTP 200, `"status": "accepted"`.

### 8.5 Confirm customer can no longer cancel

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "cancelled"}' | python3 -m json.tool
```

Expected: HTTP 422, `"code": "ORDER_INVALID_TRANSITION"`.

### 8.6 Confirm vendor cannot skip states

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "ready"}' | python3 -m json.tool
```

Expected: HTTP 422, `"code": "ORDER_INVALID_TRANSITION"`.

### 8.7 Vendor advances through their states

```bash
# accepted → preparing
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "preparing"}' | python3 -m json.tool

# preparing → ready
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "ready"}' | python3 -m json.tool
```

Both should return HTTP 200 with the new status.

### 8.8 Driver must be online to pick up

Attempt delivery while driver is offline:

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "out_for_delivery"}' | python3 -m json.tool
```

Expected: HTTP 422, `"code": "DRIVER_OFFLINE"`.

Set the driver online:

```bash
curl -s -X PATCH "$API/drivers/status" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_online": true}' | python3 -m json.tool
```

### 8.9 Driver picks up the order

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "out_for_delivery"}' | python3 -m json.tool
```

Expected: HTTP 200, `"status": "out_for_delivery"`, and the order now has `"driver_id"` set.

### 8.10 Confirm driver cannot take a second delivery simultaneously

Place another order and advance it to `ready`, then try to assign the same driver:

```bash
# New order
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM1_ID\", \"quantity\": 1}" > /dev/null

ORDER2=$(curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "99 Other Road, Cape Town"}')

ORDER2_ID=$(echo $ORDER2 | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['order']['id'])")

# Vendor advances order 2 to ready
for STATUS in accepted preparing ready; do
  curl -s -X PATCH "$API/orders/$ORDER2_ID/status" \
    -H "Authorization: Bearer $VENDOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"$STATUS\"}" > /dev/null
  sleep 0.2
done

# Driver tries to take order 2 while already delivering order 1
curl -s -X PATCH "$API/orders/$ORDER2_ID/status" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "out_for_delivery"}' | python3 -m json.tool
```

Expected: HTTP 422, `"code": "DRIVER_BUSY"`.

### 8.11 Complete the delivery

```bash
curl -s -X PATCH "$API/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "delivered"}' | python3 -m json.tool
```

Expected: HTTP 200, `"status": "delivered"`, `"delivered_at"` timestamp populated.

Confirm the customer can see the completed order:

```bash
curl -s "$API/orders/customer" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | python3 -m json.tool
```

### 8.12 Verify order immutability — customer cannot see another customer's order

Register a second customer and try to access order 1's detail:

```bash
CUST2=$(curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer2@test.com",
    "password": "TestPass!99",
    "full_name": "Frank Customer",
    "role": "customer"
  }')

CUSTOMER2_TOKEN=$(echo $CUST2 | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

curl -s "$API/orders/$ORDER_ID" \
  -H "Authorization: Bearer $CUSTOMER2_TOKEN" | python3 -m json.tool
```

Expected: HTTP 403, `"code": "FORBIDDEN_OWNERSHIP"`.

---

## 9. WebSocket Real-Time Tests

### 9.1 Start the WebSocket server

In **[T2]**:

```bash
make serve-ws
```

Expected output:
```
[WS] WebSocket server started on port 8080
[WS] Internal HTTP server started on port 8081
```

### 9.2 Install wscat for command-line WebSocket testing

```bash
npm install -g wscat
```

### 9.3 Connect as the customer

In **[T4]**, connect using the customer's current access token:

```bash
wscat -c "ws://localhost:8080?token=$CUSTOMER_TOKEN"
```

Expected: server sends a `connected` event immediately:

```json
{"event":"connected","payload":{"user_id":"...","role":"customer"}}
```

Leave this connection open.

### 9.4 Test heartbeat

In **[T4]**, type and send:

```json
{"event":"ping"}
```

Expected: server responds with:

```json
{"event":"pong"}
```

### 9.5 Test real-time order update

Open a second wscat connection in a new terminal as the vendor **[T5]**:

```bash
wscat -c "ws://localhost:8080?token=$VENDOR_TOKEN"
```

Now in **[T3]**, place a new order:

```bash
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM1_ID\", \"quantity\": 1}" > /dev/null

ORDER3=$(curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "77 Live Street, Cape Town"}')

ORDER3_ID=$(echo $ORDER3 | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['order']['id'])")
echo "Order 3 ID: $ORDER3_ID"
```

**In [T5] (vendor window)** — you should see an `order.created` event arrive without polling:

```json
{
  "event": "order.created",
  "payload": { "order_id": "...", "restaurant_id": "...", "total": 13.0 }
}
```

Now accept the order in **[T3]**:

```bash
curl -s -X PATCH "$API/orders/$ORDER3_ID/status" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "accepted"}' > /dev/null
```

**In [T4] (customer window)** — you should see an `order.updated` event:

```json
{
  "event": "order.updated",
  "payload": { "order_id": "...", "status": "accepted", "customer_id": "..." }
}
```

### 9.6 Test that customers do not receive other customers' events

The second customer's wscat connection should not have received anything when
order 1 or 3 changed status. Scroll through `[T4]` — no `order.updated` events
should appear for orders that do not belong to customer 1.

### 9.7 Test invalid WebSocket token is rejected

```bash
wscat -c "ws://localhost:8080?token=not.a.real.token"
```

Expected: server sends an error event then closes the connection:

```json
{"event":"error","payload":{"code":"AUTH_FAILED","message":"Invalid token"}}
```

### 9.8 Test WebSocket with no token

```bash
wscat -c "ws://localhost:8080"
```

Expected: connection is closed immediately with an auth error.

---

## 10. Security Boundary Tests

### 10.1 Rate limiting

Send 101 rapid requests and confirm the 101st is rejected:

```bash
for i in $(seq 1 101); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/restaurants")
  echo "Request $i: HTTP $CODE"
done | tail -5
```

Expected: requests 1–100 return `200`. Request 101 returns `429`.
The response includes a `Retry-After` header.

Wait 60 seconds and confirm requests succeed again:

```bash
sleep 60
curl -s -o /dev/null -w "%{http_code}" "$API/restaurants"
```

Expected: `200`.

### 10.2 Confirm stack traces never appear in errors

Send a malformed UUID to trigger a potential error path:

```bash
curl -s "$API/restaurants/not-a-uuid" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | python3 -m json.tool
```

The response must not contain any of: `Traceback`, `Stack trace`, `in /`, `line `,
PHP file paths, SQL query text, or database schema details.

Expected: a clean JSON error object with only `code` and `message`.

### 10.3 Confirm SQL injection is rejected

```bash
curl -s "$API/restaurants?search='; DROP TABLE users; --" | python3 -m json.tool
```

Expected: HTTP 200 with an empty result set — the query parameter is sanitized.
Run `make db-shell` and verify the `users` table still exists:

```sql
SELECT COUNT(*) FROM users;
-- Should return the number of users you created
```

### 10.4 Confirm XSS payloads are stored and returned safely

Create a menu item with a script tag in the name:

```bash
curl -s -X POST "$API/menu" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurant_id\": \"$REST_ID\",
    \"name\": \"<script>alert(1)</script>\",
    \"price\": 5.00
  }" | python3 -m json.tool
```

The API returns the name as a JSON string — which is safe. Confirm the frontend
renders it via `textContent` (not `innerHTML`) by loading the menu page in a
browser and verifying no alert dialog appears and the tag is displayed as literal
text: `<script>alert(1)</script>`.

### 10.5 Confirm oversized payload is handled

```bash
python3 -c "print('A' * 100000)" | \
  curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$(python3 -c "print('A'*60000)")"'@test.com","password":"x"}' \
  | python3 -m json.tool
```

Expected: HTTP 400, `"code": "VALIDATION_FAILED"` — the email fails max-length validation.
The server must not crash or time out.

### 10.6 Confirm malformed JSON body is rejected

```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d 'not json at all' | python3 -m json.tool
```

Expected: HTTP 400 or a clean error. The server does not crash.

### 10.7 File upload security

Test that only image files are accepted for logo upload:

```bash
# Create a fake PHP file disguised as a JPEG
echo '<?php system($_GET["cmd"]); ?>' > /tmp/shell.jpg

curl -s -X POST "$API/restaurants/$REST_ID/logo" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -F "logo=@/tmp/shell.jpg;type=image/jpeg" | python3 -m json.tool
```

Expected: HTTP 422, `"code": "VALIDATION_FAILED"`.
The server reads the file's actual MIME type (PHP content), not the declared type.

Test file size limit:

```bash
dd if=/dev/urandom bs=1024 count=2049 2>/dev/null > /tmp/toobig.png

curl -s -X POST "$API/restaurants/$REST_ID/logo" \
  -H "Authorization: Bearer $VENDOR_TOKEN" \
  -F "logo=@/tmp/toobig.png;type=image/png" | python3 -m json.tool
```

Expected: HTTP 422, file size exceeded error.

---

## 11. Edge Cases and Error Paths

### 11.1 Checkout with an empty cart

```bash
# Customer cart should be empty after previous tests
curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "Somewhere"}' | python3 -m json.tool
```

Expected: HTTP 409, `"code": "CART_EMPTY"`.

### 11.2 Checkout with a delivery address that is too short

```bash
curl -s -X POST "$API/cart/add" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"menu_item_id\": \"$ITEM1_ID\", \"quantity\": 1}" > /dev/null

curl -s -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_address": "short"}' | python3 -m json.tool
```

Expected: HTTP 400, `"code": "VALIDATION_FAILED"`, field error on `delivery_address`.

Clear the cart:

```bash
curl -s -X DELETE "$API/cart" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" > /dev/null
```

### 11.3 Request a resource with a well-formed but non-existent UUID

```bash
curl -s "$API/restaurants/00000000-0000-4000-8000-000000000099" | python3 -m json.tool
```

Expected: HTTP 404, `"code": "RESOURCE_NOT_FOUND"`.

### 11.4 Driver registers without a phone number

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "nophone@driver.com",
    "password": "TestPass!99",
    "full_name": "No Phone",
    "role": "driver"
  }' | python3 -m json.tool
```

Expected: HTTP 422 or 400, validation error about required phone for drivers.

### 11.5 Weak password is rejected

```bash
curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "weak@test.com",
    "password": "password",
    "full_name": "Weak Pass",
    "role": "customer"
  }' | python3 -m json.tool
```

Expected: HTTP 400, `"code": "VALIDATION_FAILED"`, password field error.

### 11.6 Pagination parameters

```bash
curl -s "$API/restaurants?page=1&limit=5" | python3 -m json.tool
curl -s "$API/orders/customer?page=1&limit=10" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | python3 -m json.tool
```

Both should return HTTP 200 with a `pagination` object containing `page`, `limit`, and `total`.

---

## 12. Pre-Production Checklist

Work through this checklist in order. Every item must pass before deploying.

### Environment

- [ ] `make env-check` — all variables set, no placeholders, JWT_SECRET ≥ 64 chars
- [ ] `APP_ENV` is set to `production` in the production `.env`
- [ ] `CORS_ALLOWED_ORIGINS` contains only the real production domain, nothing else
- [ ] `APP_URL` points to the production HTTPS URL
- [ ] Database uses a dedicated user (`fc_user`) with no superuser privileges

### Code quality

- [ ] `make lint` — zero PHP syntax errors
- [ ] `make test` — all tests pass
- [ ] `make audit` — no known CVEs in Composer dependencies

### Infrastructure

- [ ] `make check-deps` passes on the production server
- [ ] SSL certificate installed and valid: `curl -I https://api.yourdomain.com`
- [ ] WebSocket accessible over WSS: `wscat -c wss://ws.yourdomain.com?token=test`
- [ ] Nginx config tested: `sudo nginx -t`
- [ ] PHP `display_errors = Off` confirmed in `php.ini` or `php-fpm` pool config
- [ ] Upload directory is outside the web root and has no PHP execution
- [ ] Log rotation configured for `logs/` and `/var/log/nginx/`

### Database

- [ ] `make db-setup` applied cleanly on the production database
- [ ] All migrations in `database/migrations/` have run
- [ ] `make db-dump` works — take a backup before going live
- [ ] State machine trigger confirmed: `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'orders';`
- [ ] Unique index on active driver deliveries confirmed: `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_driver_active_delivery';`

### Functional smoke test on production

Run the following against the production URL after deploying. Use a test account,
not real customer data.

```bash
PROD="https://api.yourdomain.com/v1"

# 1. Public restaurant list responds
curl -s "$PROD/restaurants" | python3 -m json.tool

# 2. Register + login round trip
RESULT=$(curl -s -X POST "$PROD/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@test.com","password":"SmokeTest!1","full_name":"Smoke Test","role":"customer"}')
echo $RESULT | python3 -m json.tool

SMOKE_TOKEN=$(echo $RESULT | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

# 3. Authenticated cart access
curl -s "$PROD/cart" \
  -H "Authorization: Bearer $SMOKE_TOKEN" | python3 -m json.tool

# 4. WebSocket connects
wscat -c "wss://ws.yourdomain.com?token=$SMOKE_TOKEN" --execute '{"event":"ping"}'
# Expected: {"event":"pong"}
```

- [ ] All four commands above return expected responses
- [ ] `make health-check` passes (update API_PORT in Makefile to 443 for production, or run manually)

### Final

- [ ] Delete all test accounts created during this process from the production database
- [ ] Confirm error logs show no unexpected errors after smoke test
- [ ] Take a fresh database backup: `make db-dump`

Once every box is checked, the system is ready for production traffic.
