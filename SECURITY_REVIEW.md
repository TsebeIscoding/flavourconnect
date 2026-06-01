# FlavourConnect — Security Review

## Threat Model
Adversaries: unauthenticated users, authenticated-but-wrong-role users,
malicious customers, rogue vendors, insider threats, network attackers.

---

## 1. SQL INJECTION
**Threat**: Attacker injects SQL through user-supplied input.

**Mitigation**:
- ALL database queries use PDO prepared statements exclusively
- Database::query(), ::insert(), ::update() all take parameterized arrays
- Raw SQL string interpolation of user data is NEVER used
- Input sanitization in Validator strips null bytes before any processing
- PostgreSQL-typed enums prevent injection through status fields

**Code reference**: `backend/utils/Database.php` — only $stmt->execute($params)

---

## 2. BROKEN AUTHENTICATION
**Threat**: Token theft, session hijacking, brute force.

**Mitigations**:
- JWT access tokens expire in 15 minutes (short window)
- Refresh tokens are 256-bit cryptographically random values
- Refresh tokens stored as SHA-256 hash — raw value never persisted
- Token rotation on every refresh (old token immediately revoked)
- **Refresh token reuse detection**: if a revoked token is presented,
  ALL tokens for that user are revoked (detects token theft)
- Passwords hashed with Argon2id (memory=64MB, time=4 iterations)
- PHP's password_hash() generates unique salt per user automatically
- Constant-time comparison in login (password_verify always runs even
  if user not found — prevents timing attacks leaking email existence)
- Access tokens stored in memory only (not localStorage) — XSS-safe
- Refresh tokens in sessionStorage — cleared on tab close

**Code reference**: `backend/services/AuthService.php`, `backend/utils/JwtService.php`

---

## 3. BROKEN ACCESS CONTROL / IDOR
**Threat**: User accesses or modifies another user's data by guessing IDs.

**Mitigations**:
- Every protected route goes through `AuthMiddleware::requireRole()`
- Object-level authorization on every resource access:
  - Customer can only see their own orders (customer_id = auth user)
  - Vendor can only update their own restaurant (vendor_id = auth user)
  - Vendor can only update menu items belonging to their restaurant
  - Driver can only update orders assigned to them
- `AuthMiddleware::requireOwnership()` enforced before any data mutation
- Order status transitions are role-gated — vendor cannot skip to delivery,
  driver cannot accept orders, customer cannot set status to delivered
- Admin role has explicit bypass only — not implicit fallthrough

**Code reference**: `backend/middleware/AuthMiddleware.php`,
`backend/services/OrderService.php::verifyOrderAccess()`

---

## 4. CROSS-SITE SCRIPTING (XSS)
**Threat**: Attacker injects malicious scripts via user input.

**Mitigations**:
- **Backend**: PHP never renders HTML — JSON API only
- **Frontend**: `Dom.el()` creates elements via `createElement` + `textContent`
  NEVER uses `innerHTML` with user-supplied data
- `Dom.render()` clears container and appends Node objects
- All user data assigned via `.textContent` (auto-escaped by browser)
- Content-Security-Policy header: `script-src 'self'` — no inline scripts,
  no eval, no external script sources
- `X-Content-Type-Options: nosniff` header set globally

**Code reference**: `frontend/js/utils/dom.js` — all el() usage,
`frontend/index.html` — CSP meta tag

---

## 5. CROSS-SITE REQUEST FORGERY (CSRF)
**Threat**: Attacker tricks browser into making authenticated requests.

**Mitigations**:
- JWT in Authorization header (not cookie) — not sent automatically by browser
- CORS strict whitelist prevents cross-origin fetches from completing
- SameSite policy effective for sessionStorage-based refresh flow
- API is JSON-only — `Content-Type: application/json` required, which
  browsers cannot send cross-origin without CORS preflight

---

## 6. CORS MISCONFIGURATION
**Threat**: Attacker's origin makes authenticated requests to the API.

**Mitigation**:
- Strict origin whitelist: only `CORS_ALLOWED_ORIGINS` env var entries allowed
- No wildcard (`*`) ever used
- Request from unlisted origin → immediate 403
- `Vary: Origin` header set to prevent cache poisoning
- Preflight checked on every mutation (POST, PATCH, DELETE)

**Code reference**: `backend/middleware/CorsMiddleware.php`

---

## 7. RATE LIMITING / DENIAL OF SERVICE
**Threat**: Attacker floods API to exhaust resources or brute-force credentials.

**Mitigations**:
- 100 requests/minute per user (by JWT sub) or IP address
- Rate limit key uses JWT sub when available (prevents IP rotation bypass
  for authenticated users)
- HTTP 429 returned with `Retry-After` header
- Cleanup of old rate limit records prevents table bloat
- Trusted proxy header (`X-Forwarded-For`) only accepted from known proxy IPs
- Login endpoint rate-limited same as all other endpoints

**Code reference**: `backend/middleware/RateLimiter.php`

---

## 8. MASS ASSIGNMENT
**Threat**: Client sends extra fields that get written to database (e.g. is_admin: true).

**Mitigation**:
- Services use explicit field whitelists — only allowed fields are mapped
- PATCH endpoints use `$allowed = ['name', 'description', ...]` arrays
- Role, user ID, restaurant ID never accepted from client body
- `RETURNING *` fetches what was actually written — no echo of input

**Code reference**: `backend/services/RestaurantMenuService.php::update()`

---

## 9. INSECURE DIRECT OBJECT REFERENCES
**Threat**: Attacker constructs requests targeting other users' resources.

**Mitigation**:
- All IDs are UUIDs (non-sequential — cannot enumerate)
- Every resource lookup verifies the authenticated user owns or is authorized
  to access the resource before returning data
- Ownership check happens in service layer, not just middleware

---

## 10. SENSITIVE DATA EXPOSURE
**Threat**: Passwords, tokens, or internal errors exposed to clients.

**Mitigations**:
- `password_hash` field never included in any API response
- `token_hash` column never returned — only raw tokens at issuance time
- `ErrorHandler` catches all exceptions — clients only receive safe messages
- Stack traces, file paths, SQL queries never in responses
- Internal error code goes to `error_log` only
- `display_errors = Off` in PHP config
- `X-Powered-By` header removed
- Database DSN/credentials only in environment variables, never in code

**Code reference**: `backend/middleware/ErrorHandler.php`,
`backend/utils/ResponseHelper.php`

---

## 11. BUSINESS LOGIC ATTACKS
**Threat**: Manipulating order totals, skipping payment, state machine abuse.

**Mitigations**:
- Cart totals computed server-side only — frontend total never accepted
- Checkout reads prices from `menu_items` table at time of order
- Order items snapshot prices at creation — price changes don't affect
  existing orders
- Order state machine enforced at TWO levels:
  1. PHP service layer (`ROLE_TRANSITIONS` array)
  2. PostgreSQL trigger (`enforce_order_state_machine`)
- Single unique constraint prevents driver having two active deliveries
- Restaurant must be open at checkout time (server checks `is_open`)
- All cart items must be `is_available = true` at checkout

**Code reference**: `backend/services/OrderService.php`,
`database/schema.sql` — `enforce_order_state_machine` trigger

---

## 12. FILE UPLOAD ATTACKS
**Threat**: Malicious file upload (web shells, oversized files, wrong types).

**Mitigations**:
- MIME type validated via `finfo::file()` (file content inspection)
  NOT from file extension or `$_FILES['type']` (client-supplied)
- Allowed types: image/jpeg, image/png, image/webp only
- Max size: 2MB enforced before `move_uploaded_file()`
- Saved filename: 32-character cryptographically random hex + correct extension
  (no user input in filename — prevents path traversal)
- Uploads stored outside web root in production
- PHP execution disabled in upload directories via server config

**Code reference**: `backend/services/RestaurantMenuService.php::uploadLogo()`

---

## 13. WEBSOCKET SECURITY
**Threat**: Unauthorized WebSocket connections, topic eavesdropping.

**Mitigations**:
- JWT verified on every new WebSocket connection (same signature check as REST)
- Expired tokens → connection refused immediately
- Topic subscription requires explicit authorization check:
  - Customers can only subscribe to their own user channel
  - Vendors can only subscribe to their own restaurant channel
  - Drivers can subscribe to driver broadcast channel
- Internal broadcast endpoint bound to localhost only (127.0.0.1)
- Internal endpoint verifies `X-Internal-Secret` header via `hash_equals()`
- No user data is trusted from the WebSocket message body for auth decisions

**Code reference**: `websocket/server.php`

---

## 14. SECRETS MANAGEMENT
**Threat**: Hardcoded credentials, leaked secrets.

**Mitigations**:
- All secrets in `.env` file (never in code)
- `.env` not committed to version control (`.gitignore` entry required)
- `.env.example` provided with placeholders only
- JWT_SECRET minimum 64 characters enforced at boot
- Database password only in environment variable
- WS_INTERNAL_SECRET verified via `hash_equals()` (timing-safe)

---

## 15. INPUT VALIDATION
**Threat**: Malformed data crashes services or reaches database unchecked.

**Mitigations**:
- `Validator::make()` called at start of EVERY service method
- Validation rules: required, email, min/max length, numeric, positive,
  boolean, uuid, in (enum), array, password strength
- Invalid requests rejected with HTTP 400 before any business logic
- Null bytes and control characters stripped from strings on input
- UUID format validated before any database lookup (prevents injection
  of non-UUID strings even into parameterized queries)

**Code reference**: `backend/utils/Validator.php`

---

## 16. DEPENDENCY SECURITY
**Recommendations** (not auto-enforced but required for production):
- Run `composer audit` in CI/CD pipeline
- Run `npm audit` for any frontend build tooling
- Pin dependency versions in composer.lock / package-lock.json
- Update Ratchet, PDO drivers, and PHP regularly
- Use Dependabot or similar for automated CVE alerts

---

## SECURITY CHECKLIST FOR DEPLOYMENT

- [ ] Set strong JWT_SECRET (≥64 random chars): `openssl rand -hex 64`
- [ ] Set strong DB_PASSWORD
- [ ] Set strong WS_INTERNAL_SECRET
- [ ] Configure CORS_ALLOWED_ORIGINS to production domain only
- [ ] Enable SSL/TLS for all connections (HTTPS + WSS)
- [ ] Set `APP_ENV=production`
- [ ] Disable PHP `display_errors` in php.ini
- [ ] Configure upload directory outside web root
- [ ] Disable PHP execution in upload directory (nginx config)
- [ ] Enable PostgreSQL SSL (`sslmode=require`)
- [ ] Set up log rotation for error logs
- [ ] Configure fail2ban for repeated 401/429 responses
- [ ] Add rate limit on /auth/login specifically (stricter: 10/min)
- [ ] Review and tighten CSP for production domains
- [ ] Run `composer audit` — no known vulnerabilities
- [ ] Configure HTTP Strict Transport Security (HSTS) header
- [ ] Back up database encryption keys
