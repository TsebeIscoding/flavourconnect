# FlavourConnect

A production-grade, real-time food ordering and delivery platform. Multi-role
(customer, vendor, driver, admin), API-first, with a reactive state-driven
frontend and live WebSocket order tracking.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Services](#running-the-services)
- [API Overview](#api-overview)
- [WebSocket Events](#websocket-events)
- [User Roles](#user-roles)
- [Order Lifecycle](#order-lifecycle)
- [Security](#security)
- [Deployment](#deployment)
- [Development Workflow](#development-workflow)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser Client                       │
│         Vanilla JS  ·  State Store  ·  Render Engine    │
└────────────────┬──────────────────────┬─────────────────┘
                 │ HTTPS/REST           │ WSS
                 ▼                      ▼
┌───────────────────────┐   ┌───────────────────────────┐
│    PHP REST API        │   │   PHP Ratchet WS Server   │
│    (Nginx + PHP-FPM)   │──▶│   (ReactPHP event loop)   │
│                        │   │                           │
│  CORS → Rate Limit     │   │  JWT Auth on connect      │
│  JWT Auth → RBAC       │   │  Topic-based broadcast    │
│  Validate → Execute    │   │  Internal HTTP endpoint   │
└───────────┬───────────┘   └───────────────────────────┘
            │
            ▼
┌───────────────────────┐
│      PostgreSQL        │
│                        │
│  State machine trigger │
│  FK constraints        │
│  Audit log             │
└───────────────────────┘
```

Every HTTP request passes through an eight-step pipeline:

```
CORS → Rate Limit → JWT Auth → Input Validation
     → RBAC → Ownership Check → Business Logic → Response
```

The frontend follows a strict unidirectional data flow:

```
User Action → dispatch(mutation) → State Update → Re-render
```

---

## Tech Stack

| Layer        | Technology                              |
|--------------|-----------------------------------------|
| Frontend     | HTML5, CSS3, Vanilla JS (no frameworks) |
| Backend      | PHP 8.1+, REST JSON API                 |
| Database     | PostgreSQL 14+                          |
| Real-time    | PHP Ratchet (ReactPHP), WebSockets      |
| Auth         | JWT (HS256) + Argon2id password hashing |
| Web server   | Nginx + PHP-FPM                         |

---

## Project Structure

```
flavourconnect/
│
├── README.md
├── Makefile
├── API_CONTRACT.md          # Full endpoint documentation
├── SECURITY_REVIEW.md       # Threat model + mitigations
│
├── backend/
│   ├── public/
│   │   └── index.php        # Single entry point — all requests route here
│   ├── config/
│   │   ├── bootstrap.php    # Env loading, PHP config, security headers
│   │   └── Container.php    # Dependency injection container
│   ├── middleware/
│   │   ├── CorsMiddleware.php
│   │   ├── RateLimiter.php
│   │   ├── AuthMiddleware.php
│   │   └── ErrorHandler.php
│   ├── controllers/         # HTTP layer only — no business logic
│   │   ├── AuthController.php
│   │   └── OrderController.php
│   ├── services/            # All business logic lives here
│   │   ├── AuthService.php
│   │   ├── CartService.php
│   │   ├── OrderService.php
│   │   ├── RestaurantMenuService.php
│   │   └── WebSocketNotifier.php
│   ├── routes/
│   │   └── Router.php       # URI → controller mapping with auth guards
│   ├── utils/
│   │   ├── Database.php     # PDO wrapper — prepared statements only
│   │   ├── JwtService.php   # Access + refresh token management
│   │   ├── Validator.php    # Input validation — runs before business logic
│   │   ├── ResponseHelper.php
│   │   └── Exceptions.php
│   ├── composer.json
│   └── .env.example         # Copy to .env and fill secrets
│
├── frontend/
│   ├── index.html           # Single page — all UI injected by JS
│   ├── css/
│   │   └── main.css         # Design tokens, components, responsive
│   └── js/
│       ├── app.js           # Boot sequence + view router
│       ├── state/
│       │   └── store.js     # Global state store — single source of truth
│       ├── services/
│       │   ├── api.js       # API service layer + action creators
│       │   └── websocket.js # WS client — reconnecting, authenticated
│       ├── components/      # Pure render functions — state in, DOM out
│       │   ├── nav.js
│       │   ├── restaurants.js
│       │   ├── cart.js
│       │   ├── orders.js
│       │   ├── auth-forms.js
│       │   └── vendor-dashboard.js
│       └── utils/
│           ├── dom.js       # Safe DOM helpers — no innerHTML
│           ├── http.js      # Fetch wrapper with auto token refresh
│           └── auth.js      # Token storage and session restore
│
├── websocket/
│   ├── server.php           # Ratchet WS server + internal HTTP endpoint
│   └── composer.json
│
├── database/
│   ├── schema.sql           # Full PostgreSQL schema
│   └── migrations/
│       └── 001_rate_limit.sql
│
└── deploy/
    └── nginx.conf           # Production Nginx configuration
```

---

## Prerequisites

| Requirement      | Version  | Notes                                  |
|------------------|----------|----------------------------------------|
| PHP              | ≥ 8.1    | With `pdo_pgsql`, `argon2`, `curl` extensions |
| PostgreSQL       | ≥ 14     |                                        |
| Composer         | ≥ 2.0    |                                        |
| Nginx            | ≥ 1.20   | Or Apache with mod_rewrite             |
| PHP-FPM          | ≥ 8.1    | Matches PHP version                    |
| OpenSSL          | any      | For generating secrets                 |

Check your environment:

```bash
make check-deps
```

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone https://github.com/yourorg/flavourconnect.git
cd flavourconnect

# 2. Install all dependencies
make install

# 3. Configure environment (copies .env.dev.example — safe dev defaults pre-filled)
make env-setup

# 4. Generate the two required secrets and paste them into backend/.env
make gen-secret        # → paste output into JWT_SECRET
openssl rand -hex 32   # → paste output into WS_INTERNAL_SECRET

# 5. Validate configuration — must show all green before continuing
make env-check

# 6. Create database and run schema
make db-setup

# 7. Start all services (API + WebSocket)
make dev
```

The API will be available at `http://localhost:8000` and the WebSocket server
at `ws://localhost:8080`.

> **For production** use `make env-setup-prod` instead of `make env-setup`.
> It copies `.env.example` which requires every value to be filled in explicitly.

---

## Configuration

There are two environment file templates:

| File | Use for | Notes |
|---|---|---|
| `backend/.env.dev.example` | **Development** | Safe defaults pre-filled. Only secrets need generating. |
| `backend/.env.example` | **Production** | Every value requires explicit configuration. |

For development (run by `make env-setup`):

```bash
cp backend/.env.dev.example backend/.env
```

For production (run by `make env-setup-prod`):

```bash
cp backend/.env.example backend/.env
```

The actual `backend/.env` is listed in `.gitignore` and must never be committed.
The two `.example` files contain no real secrets and are safe to commit.

| Variable               | Required | Description                                        |
|------------------------|----------|----------------------------------------------------|
| `APP_ENV`              | Yes      | `production` or `development`                      |
| `APP_URL`              | Yes      | Full URL of the API (e.g. `https://api.example.com`) |
| `APP_TIMEZONE`         | Yes      | PHP timezone string (e.g. `UTC`)                   |
| `DB_HOST`              | Yes      | PostgreSQL host                                    |
| `DB_PORT`              | Yes      | PostgreSQL port (default `5432`)                   |
| `DB_NAME`              | Yes      | Database name                                      |
| `DB_USER`              | Yes      | Database user                                      |
| `DB_PASSWORD`          | Yes      | Database password                                  |
| `JWT_SECRET`           | Yes      | **≥ 64 random characters.** Generate with `make gen-secret` |
| `JWT_ACCESS_TTL`       | Yes      | Access token lifetime in seconds (default `900`)   |
| `JWT_REFRESH_TTL`      | Yes      | Refresh token lifetime in seconds (default `1209600`) |
| `CORS_ALLOWED_ORIGINS` | Yes      | Comma-separated list of allowed origins. No wildcards. |
| `WS_PORT`              | Yes      | Public WebSocket port (default `8080`)             |
| `WS_INTERNAL_URL`      | Yes      | Internal URL the API uses to reach the WS server   |
| `WS_INTERNAL_SECRET`   | Yes      | Shared secret between API and WS server            |
| `TRUSTED_PROXIES`      | No       | Comma-separated IPs to trust for `X-Forwarded-For` |
| `UPLOAD_PATH`          | Yes      | Absolute path for file uploads (outside web root)  |

Generate cryptographically strong secrets:

```bash
# JWT secret
make gen-secret

# WS internal secret
openssl rand -hex 32
```

---

## Database Setup

### Create the database and user

```bash
# Connect as a superuser
psql -U postgres

# Inside psql:
CREATE USER fc_user WITH PASSWORD 'your_strong_password';
CREATE DATABASE flavourconnect OWNER fc_user;
GRANT ALL PRIVILEGES ON DATABASE flavourconnect TO fc_user;
\q
```

### Run the schema

```bash
make db-setup
```

This runs `database/schema.sql` followed by all files in `database/migrations/`
in filename order. It is idempotent — safe to re-run on a fresh database.

### Reset the database (development only)

```bash
make db-reset
```

> **Warning:** This drops and recreates the database. Never run in production.

---

## Running the Services

### Development

```bash
# Start API server on port 8000 (PHP built-in server)
make serve-api

# Start WebSocket server on port 8080
make serve-ws

# Start both in parallel
make dev
```

### Production

Services are managed by **systemd**. Install the unit files:

```bash
make install-services
sudo systemctl enable flavourconnect-api flavourconnect-ws
sudo systemctl start  flavourconnect-api flavourconnect-ws
```

Check status:

```bash
make status
```

---

## API Overview

Base URL: `https://api.flavourconnect.com/v1`

All responses use this envelope:

```json
{
  "success": true,
  "data":    { ... },
  "error":   null,
  "meta":    { "timestamp": "...", "request_id": "..." }
}
```

### Authentication

| Method | Endpoint         | Auth | Description              |
|--------|-----------------|------|--------------------------|
| POST   | `/auth/register` | —    | Create account           |
| POST   | `/auth/login`    | —    | Obtain tokens            |
| POST   | `/auth/refresh`  | —    | Rotate refresh token     |
| POST   | `/auth/logout`   | JWT  | Revoke refresh token     |

Pass the access token as a Bearer header on all authenticated requests:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

### Restaurants & Menu

| Method | Endpoint                    | Auth          | Description          |
|--------|-----------------------------|---------------|----------------------|
| GET    | `/restaurants`              | —             | List restaurants     |
| GET    | `/restaurants/:id`          | —             | Restaurant detail    |
| PATCH  | `/restaurants/:id`          | vendor/admin  | Update profile       |
| POST   | `/restaurants/:id/logo`     | vendor/admin  | Upload logo          |
| GET    | `/restaurants/:id/menu`     | —             | List menu items      |
| POST   | `/menu`                     | vendor/admin  | Create menu item     |
| PATCH  | `/menu/:id`                 | vendor/admin  | Update menu item     |
| DELETE | `/menu/:id`                 | vendor/admin  | Disable menu item    |

### Cart

| Method | Endpoint      | Auth     | Description                |
|--------|---------------|----------|----------------------------|
| GET    | `/cart`       | customer | Get current cart           |
| POST   | `/cart/add`   | customer | Add item (server validates)|
| POST   | `/cart/remove`| customer | Remove item                |
| DELETE | `/cart`       | customer | Clear cart                 |

### Orders

| Method | Endpoint                 | Auth                   | Description         |
|--------|--------------------------|------------------------|---------------------|
| POST   | `/orders`                | customer               | Checkout (from cart)|
| GET    | `/orders/customer`       | customer               | My orders           |
| GET    | `/orders/vendor`         | vendor                 | Restaurant orders   |
| GET    | `/orders/driver`         | driver                 | Available pickups   |
| GET    | `/orders/:id`            | owner/vendor/driver    | Order detail        |
| PATCH  | `/orders/:id/status`     | vendor/driver/customer | Advance status      |

See `API_CONTRACT.md` for complete request/response examples.

---

## WebSocket Events

Connect with your access token in the query string:

```
wss://ws.flavourconnect.com?token=<access_token>
```

### Events received by clients

| Event              | Who receives it        | Payload fields                          |
|--------------------|------------------------|-----------------------------------------|
| `connected`        | Everyone on connect    | `user_id`, `role`                       |
| `order.created`    | Vendor                 | `order_id`, `restaurant_id`, `total`    |
| `order.updated`    | Customer, vendor, driver | `order_id`, `status`, `customer_id`   |
| `order.ready`      | All online drivers     | `order_id`, `restaurant_id`             |
| `order.assigned`   | Assigned driver        | `order_id`, `driver_id`                 |
| `order.delivered`  | Customer               | `order_id`                              |
| `notification.new` | Targeted user          | `message`, `type`                       |

### Messages sent by clients

```json
{ "event": "ping" }
{ "event": "subscribe", "topic": "order:some-uuid" }
```

### Topic routing rules

| Topic                   | Accessible by                        |
|-------------------------|--------------------------------------|
| `user:<user_id>`        | The user themselves                  |
| `role:driver`           | All drivers                          |
| `restaurant:<rest_id>`  | The vendor who owns that restaurant  |
| `order:<order_id>`      | Customer who placed the order        |

---

## User Roles

| Role       | Capabilities                                                        |
|------------|---------------------------------------------------------------------|
| `customer` | Browse restaurants, manage cart, place orders, track deliveries     |
| `vendor`   | Manage their restaurant profile, menu, and incoming orders          |
| `driver`   | Go online/offline, pick up ready orders, mark deliveries complete   |
| `admin`    | Full read/write access to all resources                             |

Each user has **exactly one role**, set at registration and never changed by the user.

---

## Order Lifecycle

```
PENDING ──▶ ACCEPTED ──▶ PREPARING ──▶ READY ──▶ OUT_FOR_DELIVERY ──▶ DELIVERED
   │
   └──▶ CANCELLED  (customer only, before ACCEPTED)
```

| Transition              | Performed by |
|-------------------------|--------------|
| `pending → accepted`    | Vendor       |
| `accepted → preparing`  | Vendor       |
| `preparing → ready`     | Vendor       |
| `ready → out_for_delivery` | Driver    |
| `out_for_delivery → delivered` | Driver |
| `pending → cancelled`   | Customer     |

The state machine is enforced at two independent levels:

1. **Service layer** — `ROLE_TRANSITIONS` map in `OrderService.php`
2. **Database trigger** — `enforce_order_state_machine()` in `schema.sql`

A skip or reversal is impossible even with a direct database connection.

---

## Security

Key properties of the system:

- **SQL injection** — impossible. Every query uses PDO prepared statements. No string interpolation of user data ever reaches the database.
- **XSS** — impossible from the frontend. All user content is inserted via `.textContent`, never `.innerHTML`. A strict Content-Security-Policy blocks inline scripts.
- **IDOR** — every resource access verifies the authenticated user owns or is authorized for that specific object, not just the resource type.
- **Token theft** — refresh token reuse triggers automatic revocation of all sessions for that user.
- **Price manipulation** — the backend computes all totals from the database. No client-submitted price or total is ever accepted.
- **CSRF** — the JWT Authorization header cannot be sent by a browser cross-origin without explicit CORS approval.

See `SECURITY_REVIEW.md` for the full threat model covering 16 attack categories, each with specific mitigations and code references.

---

## Deployment

### 1. Server requirements

A single VPS with 2 vCPU / 4 GB RAM is sufficient for moderate load.
Recommended: Ubuntu 22.04 LTS.

### 2. Install Nginx configuration

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/flavourconnect
sudo ln -s /etc/nginx/sites-available/flavourconnect \
           /etc/nginx/sites-enabled/flavourconnect
sudo nginx -t && sudo systemctl reload nginx
```

### 3. SSL certificates

```bash
sudo certbot --nginx -d flavourconnect.com \
                     -d api.flavourconnect.com \
                     -d ws.flavourconnect.com
```

### 4. Full deployment

```bash
make deploy
```

This runs: `install → db-migrate → install-services → reload-nginx`

### 5. Post-deploy verification

```bash
make health-check
```

Checks that the API returns 200, the WebSocket server accepts connections,
and the database is reachable.

---

## Development Workflow

```bash
# Install dependencies
make install

# Run schema migrations
make db-migrate

# Start development servers (both API and WS, with output)
make dev

# Validate environment configuration
make env-check

# View live logs
make logs

# View logs for a specific service
make logs SERVICE=ws

# Lint PHP files
make lint

# Run tests
make test

# Generate a new JWT secret
make gen-secret

# Show all available commands
make help
```

---

## Contributing

1. Branch from `main`: `git checkout -b feature/your-feature`
2. Run `make lint` before committing — no warnings accepted
3. Run `make test` — all tests must pass
4. Open a pull request with a clear description of what changed and why

---

## License

MIT License — see `LICENSE` for details.
