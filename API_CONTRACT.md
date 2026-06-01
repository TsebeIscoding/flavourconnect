# FlavourConnect — API Contract

Base URL: https://api.flavourconnect.com/v1
Content-Type: application/json
Authorization: Bearer <access_token>

All responses follow the envelope:
{
  "success": bool,
  "data": any | null,
  "error": { "code": string, "message": string } | null,
  "meta": { "timestamp": ISO8601, "request_id": uuid } | null
}

---

## AUTH ENDPOINTS

### POST /auth/register
Request:
{
  "email": "user@example.com",
  "password": "SecurePass!99",
  "full_name": "Jane Doe",
  "role": "customer",
  "phone": "+27821234567"
}

Response 201:
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "...", "role": "customer", "full_name": "Jane Doe" },
    "access_token": "eyJ...",
    "refresh_token": "raw-refresh-token"
  }
}

Errors: 400 (validation), 409 (email exists)

---

### POST /auth/login
Request:
{ "email": "user@example.com", "password": "SecurePass!99" }

Response 200:
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "...", "role": "customer" },
    "access_token": "eyJ...",
    "refresh_token": "raw-refresh-token"
  }
}

Errors: 401 (invalid credentials), 403 (inactive account)

---

### POST /auth/refresh
Request:
{ "refresh_token": "raw-refresh-token" }

Response 200:
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "refresh_token": "new-raw-refresh-token"
  }
}

Errors: 401 (invalid/expired/revoked token)

---

### POST /auth/logout
Headers: Authorization: Bearer <access_token>
Request:
{ "refresh_token": "raw-refresh-token" }

Response 200:
{ "success": true, "data": { "message": "Logged out" } }

---

## RESTAURANT ENDPOINTS

### GET /restaurants
Query: ?page=1&limit=20&open=true&cuisine=italian

Response 200:
{
  "success": true,
  "data": {
    "restaurants": [
      {
        "id": "uuid",
        "name": "Napoli Pizza",
        "description": "...",
        "address": "...",
        "phone": "...",
        "logo_url": "https://...",
        "is_open": true,
        "cuisine_tags": ["italian", "pizza"]
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 45 }
  }
}

---

### GET /restaurants/{id}
Response 200:
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Napoli Pizza",
    "description": "...",
    "address": "...",
    "phone": "...",
    "logo_url": "https://...",
    "is_open": true,
    "cuisine_tags": ["italian"],
    "menu_preview": [ { "id": "uuid", "name": "...", "price": 12.50 } ]
  }
}

Errors: 404

---

### PATCH /restaurants/{id}
Role: vendor (owns restaurant only)
Request (partial update allowed):
{
  "name": "New Name",
  "description": "Updated",
  "is_open": true,
  "cuisine_tags": ["italian", "pasta"]
}

Response 200:
{ "success": true, "data": { "restaurant": { ...updated } } }

Errors: 400, 403, 404

---

### POST /restaurants/{id}/logo
Role: vendor (owns restaurant only)
Content-Type: multipart/form-data
Body: file (max 2MB, jpg/png/webp)

Response 200:
{ "success": true, "data": { "logo_url": "https://..." } }

---

## MENU ENDPOINTS

### GET /restaurants/{id}/menu
Query: ?available=true

Response 200:
{
  "success": true,
  "data": {
    "menu_items": [
      {
        "id": "uuid",
        "name": "Margherita Pizza",
        "description": "Classic tomato sauce...",
        "price": 12.50,
        "image_url": "https://...",
        "is_available": true
      }
    ]
  }
}

---

### POST /menu
Role: vendor
Request:
{
  "restaurant_id": "uuid",
  "name": "Margherita Pizza",
  "description": "...",
  "price": 12.50
}

Response 201:
{ "success": true, "data": { "menu_item": { "id": "uuid", ... } } }

Errors: 400, 403

---

### PATCH /menu/{id}
Role: vendor (owns restaurant that owns this item)
Request (partial):
{
  "name": "Updated Name",
  "price": 14.00,
  "is_available": false
}

Response 200:
{ "success": true, "data": { "menu_item": { ...updated } } }

---

## CART ENDPOINTS

### GET /cart
Role: customer

Response 200:
{
  "success": true,
  "data": {
    "cart": {
      "id": "uuid",
      "restaurant_id": "uuid",
      "restaurant_name": "Napoli Pizza",
      "items": [
        {
          "cart_item_id": "uuid",
          "menu_item_id": "uuid",
          "name": "Margherita Pizza",
          "price": 12.50,
          "quantity": 2,
          "line_total": 25.00
        }
      ],
      "subtotal": 25.00,
      "item_count": 2
    }
  }
}

---

### POST /cart/add
Role: customer
Request:
{
  "menu_item_id": "uuid",
  "quantity": 2
}

Rules:
- If cart has items from a DIFFERENT restaurant → error 409
- Server validates availability
- Server computes totals

Response 200:
{ "success": true, "data": { "cart": { ...updated cart } } }

Errors: 400, 404 (item not found), 409 (different restaurant), 422 (item unavailable)

---

### POST /cart/remove
Role: customer
Request:
{ "menu_item_id": "uuid" }

Response 200:
{ "success": true, "data": { "cart": { ...updated cart } } }

---

### DELETE /cart
Role: customer (clear entire cart)

Response 200:
{ "success": true, "data": { "message": "Cart cleared" } }

---

## ORDER ENDPOINTS

### POST /orders
Role: customer
Request:
{ "delivery_address": "123 Main St, City, Country" }

Rules:
- Cart must be non-empty
- Restaurant must be open
- All items must be available
- Backend computes total from cart (no frontend total accepted)

Response 201:
{
  "success": true,
  "data": {
    "order": {
      "id": "uuid",
      "status": "pending",
      "delivery_address": "...",
      "subtotal": 25.00,
      "delivery_fee": 2.00,
      "total": 27.00,
      "items": [ ... ],
      "created_at": "..."
    }
  }
}

Errors: 400, 409 (cart empty / restaurant closed)

---

### GET /orders/customer
Role: customer
Query: ?status=pending&page=1&limit=20

Response 200:
{
  "success": true,
  "data": {
    "orders": [ { "id": "uuid", "status": "pending", "total": 27.00, ... } ],
    "pagination": { ... }
  }
}

---

### GET /orders/vendor
Role: vendor
Query: ?status=pending&page=1&limit=20

Response 200: (same envelope, vendor's restaurant orders only)

---

### GET /orders/driver
Role: driver
Returns orders with status='ready' (available for pickup) and driver's own active order

---

### PATCH /orders/{id}/status
Role: vendor | driver (role determines allowed transitions)
Request:
{ "status": "accepted" }

Vendor allowed transitions: pending→accepted, accepted→preparing, preparing→ready
Driver allowed transitions: ready→out_for_delivery, out_for_delivery→delivered
Customer allowed transitions: pending→cancelled

Response 200:
{ "success": true, "data": { "order": { ...updated } } }

Errors: 400 (invalid transition), 403, 404, 422 (driver not online)

---

### GET /orders/{id}
Role: customer (own orders), vendor (restaurant orders), driver (assigned), admin (any)

Response 200: Full order detail with items

---

## DRIVER ENDPOINTS

### PATCH /drivers/status
Role: driver
Request: { "is_online": true }
Response 200: { "success": true, "data": { "is_online": true } }

---

## ADMIN ENDPOINTS

### GET /admin/users
Role: admin
Query: ?role=driver&page=1

### PATCH /admin/users/{id}
Role: admin
Request: { "is_active": false }

### GET /admin/orders
Role: admin (all orders)

---

## ERROR CODES

AUTH_INVALID_CREDENTIALS
AUTH_TOKEN_EXPIRED
AUTH_TOKEN_INVALID
AUTH_REFRESH_REVOKED
FORBIDDEN_ROLE
FORBIDDEN_OWNERSHIP
VALIDATION_FAILED
RESOURCE_NOT_FOUND
CONFLICT_EMAIL_EXISTS
CONFLICT_RESTAURANT_EXISTS
CONFLICT_CART_RESTAURANT
ITEM_UNAVAILABLE
RESTAURANT_CLOSED
CART_EMPTY
DRIVER_OFFLINE
DRIVER_BUSY
ORDER_INVALID_TRANSITION
RATE_LIMIT_EXCEEDED
