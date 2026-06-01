# ==============================================================================
# FlavourConnect — Makefile
#
# Usage:  make <target>
#         make help          List all targets with descriptions
#
# Conventions:
#   - Targets that are dangerous in production are guarded with a confirmation
#   - Targets that change system state print what they are about to do
#   - All targets are .PHONY unless they produce a real file
# ==============================================================================

# ── Configuration ──────────────────────────────────────────────────────────────

SHELL        := /bin/bash
.DEFAULT_GOAL := help

ROOT         := $(shell pwd)
API_SERVICE  := flavourconnect-api
WS_SERVICE   := flavourconnect-ws
API_PORT     := 8000
WS_PORT      := 8080
BACKEND_DIR  := $(ROOT)/backend
WS_DIR       := $(ROOT)/websocket
DB_DIR       := $(ROOT)/database
LOG_DIR      := $(ROOT)/logs

# Include .env if present so DB vars are available to psql targets
-include $(BACKEND_DIR)/.env
export

DB_HOST     ?= localhost
DB_PORT     ?= 5432
DB_NAME     ?= flavourconnect
DB_USER     ?= fc_user

PHP         := $(shell command -v php 2>/dev/null)
COMPOSER    := $(shell command -v composer 2>/dev/null)

# Terminal colours
BOLD        := \033[1m
RESET       := \033[0m
GREEN       := \033[32m
YELLOW      := \033[33m
RED         := \033[31m
CYAN        := \033[36m
DIM         := \033[2m

# ==============================================================================
# HELP
# ==============================================================================

.PHONY: help
help: ## Show this help message
	@printf "\n$(BOLD)FlavourConnect$(RESET)\n"
	@printf "$(DIM)Real-time food delivery platform$(RESET)\n\n"
	@printf "$(BOLD)Usage:$(RESET)  make $(CYAN)<target>$(RESET)\n\n"
	@awk 'BEGIN {FS = ":.*##"} \
		/^##@/ { printf "\n$(BOLD)%s$(RESET)\n", substr($$0,5) } \
		/^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)
	@printf "\n"

# ==============================================================================
##@ Setup
# ==============================================================================

.PHONY: check-deps
check-deps: ## Verify required tools and PHP extensions are present
	@printf "$(BOLD)Checking dependencies...$(RESET)\n"
	@fail=0; \
	for cmd in php composer psql nginx openssl nc curl; do \
		if command -v "$$cmd" >/dev/null 2>&1; then \
			printf "  $(GREEN)✔$(RESET)  $$cmd\n"; \
		else \
			printf "  $(RED)✘$(RESET)  $$cmd  — not found\n"; fail=1; \
		fi; \
	done; \
	for ext in pdo_pgsql curl argon2; do \
		if php -m 2>/dev/null | grep -q "$$ext"; then \
			printf "  $(GREEN)✔$(RESET)  PHP ext: $$ext\n"; \
		else \
			printf "  $(RED)✘$(RESET)  PHP ext: $$ext  — missing\n"; fail=1; \
		fi; \
	done; \
	[ "$$fail" -eq 0 ] || { printf "\n$(RED)Missing dependencies.$(RESET)\n"; exit 1; }; \
	printf "\n$(GREEN)All dependencies satisfied.$(RESET)\n"

.PHONY: install
install: check-deps ## Install Composer dependencies for backend and websocket
	@printf "\n$(BOLD)Installing backend dependencies...$(RESET)\n"
	cd $(BACKEND_DIR) && composer install --no-interaction --prefer-dist --optimize-autoloader
	@printf "\n$(BOLD)Installing WebSocket dependencies...$(RESET)\n"
	cd $(WS_DIR) && composer install --no-interaction --prefer-dist --optimize-autoloader
	@printf "\n$(GREEN)Done.$(RESET)\n"

.PHONY: install-prod
install-prod: check-deps ## Install dependencies for production (no dev packages)
	@printf "\n$(BOLD)Installing backend dependencies (production)...$(RESET)\n"
	cd $(BACKEND_DIR) && composer install --no-interaction --prefer-dist \
		--optimize-autoloader --no-dev --classmap-authoritative
	@printf "\n$(BOLD)Installing WebSocket dependencies (production)...$(RESET)\n"
	cd $(WS_DIR) && composer install --no-interaction --prefer-dist \
		--optimize-autoloader --no-dev --classmap-authoritative
	@printf "\n$(GREEN)Done.$(RESET)\n"

# ==============================================================================
##@ Environment
# ==============================================================================

.PHONY: env-setup
env-setup: ## Copy .env.dev.example → .env for development (skips if .env exists)
	@if [ -f "$(BACKEND_DIR)/.env" ]; then \
		printf "$(YELLOW)$(BACKEND_DIR)/.env already exists — skipping.$(RESET)\n"; \
		printf "$(DIM)To reset: rm $(BACKEND_DIR)/.env && make env-setup$(RESET)\n"; \
	elif [ -f "$(BACKEND_DIR)/.env.dev.example" ]; then \
		cp $(BACKEND_DIR)/.env.dev.example $(BACKEND_DIR)/.env; \
		printf "$(GREEN)Created $(BACKEND_DIR)/.env from .env.dev.example$(RESET)\n\n"; \
		printf "$(YELLOW)▸ Two secrets still need to be generated:$(RESET)\n"; \
		printf "$(YELLOW)  JWT_SECRET     →  make gen-secret$(RESET)\n"; \
		printf "$(YELLOW)  WS_INTERNAL_SECRET → openssl rand -hex 32$(RESET)\n"; \
		printf "$(YELLOW)  DB_PASSWORD    →  whatever you used in CREATE USER$(RESET)\n\n"; \
		printf "$(DIM)Then run: make env-check$(RESET)\n"; \
	else \
		cp $(BACKEND_DIR)/.env.example $(BACKEND_DIR)/.env; \
		printf "$(GREEN)Created $(BACKEND_DIR)/.env from .env.example$(RESET)\n"; \
		printf "$(YELLOW)▸ Fill in every REPLACE_WITH_ value before continuing.$(RESET)\n"; \
	fi

.PHONY: env-setup-prod
env-setup-prod: ## Copy .env.example → .env for production configuration
	@if [ -f "$(BACKEND_DIR)/.env" ]; then \
		printf "$(YELLOW)$(BACKEND_DIR)/.env already exists — skipping.$(RESET)\n"; \
		printf "$(DIM)To reset: rm $(BACKEND_DIR)/.env && make env-setup-prod$(RESET)\n"; \
	else \
		cp $(BACKEND_DIR)/.env.example $(BACKEND_DIR)/.env; \
		printf "$(GREEN)Created $(BACKEND_DIR)/.env from .env.example$(RESET)\n"; \
		printf "$(YELLOW)▸ Fill in every REPLACE_WITH_ value before continuing.$(RESET)\n"; \
		printf "$(YELLOW)  Run: make gen-secret  to generate JWT_SECRET$(RESET)\n"; \
	fi

.PHONY: env-check
env-check: ## Validate that all required environment variables are configured
	@printf "$(BOLD)Validating environment...$(RESET)\n"
	@[ -f "$(BACKEND_DIR)/.env" ] || { \
		printf "$(RED)$(BACKEND_DIR)/.env not found. Run: make env-setup$(RESET)\n"; exit 1; \
	}
	@set -a; source $(BACKEND_DIR)/.env; set +a; \
	fail=0; \
	for var in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD \
	           JWT_SECRET CORS_ALLOWED_ORIGINS WS_INTERNAL_SECRET APP_URL; do \
		val=$$(eval echo "\$$$${var}"); \
		if [ -z "$$val" ] || echo "$$val" | grep -qE "CHANGE_THIS|REPLACE_WITH_"; then \
			printf "  $(RED)✘$(RESET)  $$var — not set or still a placeholder\n"; fail=1; \
		else \
			printf "  $(GREEN)✔$(RESET)  $$var\n"; \
		fi; \
	done; \
	jwt=$$(grep '^JWT_SECRET=' $(BACKEND_DIR)/.env | cut -d= -f2-); \
	if [ $${#jwt} -lt 64 ]; then \
		printf "  $(RED)✘$(RESET)  JWT_SECRET must be ≥64 chars (currently $${#jwt})\n"; fail=1; \
	fi; \
	[ "$$fail" -eq 0 ] || { printf "\n$(RED)Validation failed.$(RESET)\n"; exit 1; }; \
	printf "\n$(GREEN)Environment looks good.$(RESET)\n"

.PHONY: gen-secret
gen-secret: ## Print a cryptographically secure random secret
	@printf "$(BOLD)Generated secret (copy to your .env):$(RESET)\n\n"
	@openssl rand -hex 64
	@printf "\n"

# ==============================================================================
##@ Database
# ==============================================================================

.PHONY: db-setup
db-setup: env-check ## Apply schema.sql and all migrations (safe to re-run on a fresh DB)
	@printf "$(BOLD)Applying schema...$(RESET)\n"
	PGPASSWORD="$(DB_PASSWORD)" psql \
		-h "$(DB_HOST)" -p "$(DB_PORT)" \
		-U "$(DB_USER)" -d "$(DB_NAME)" \
		-f "$(DB_DIR)/schema.sql" --set ON_ERROR_STOP=1
	@$(MAKE) --no-print-directory db-migrate
	@printf "$(GREEN)Database setup complete.$(RESET)\n"

.PHONY: db-migrate
db-migrate: env-check ## Run every SQL file in database/migrations/ in filename order
	@printf "$(BOLD)Running migrations...$(RESET)\n"
	@count=0; \
	for f in $(DB_DIR)/migrations/*.sql; do \
		[ -f "$$f" ] || continue; \
		printf "  Applying $$(basename $$f)...\n"; \
		PGPASSWORD="$(DB_PASSWORD)" psql \
			-h "$(DB_HOST)" -p "$(DB_PORT)" \
			-U "$(DB_USER)" -d "$(DB_NAME)" \
			-f "$$f" --set ON_ERROR_STOP=1; \
		count=$$((count + 1)); \
	done; \
	if [ "$$count" -eq 0 ]; then \
		printf "  $(DIM)No migration files found.$(RESET)\n"; \
	else \
		printf "$(GREEN)$$count migration(s) applied.$(RESET)\n"; \
	fi

.PHONY: db-reset
db-reset: ## ⚠ DROP and recreate the database — DESTROYS ALL DATA (dev only)
	@printf "$(RED)$(BOLD)WARNING: This will destroy all data in '$(DB_NAME)'.$(RESET)\n"
	@printf "$(YELLOW)Type the database name to confirm: $(RESET)"; read confirm; \
	if [ "$$confirm" != "$(DB_NAME)" ]; then printf "$(GREEN)Aborted.$(RESET)\n"; exit 0; fi
	PGPASSWORD="$(DB_PASSWORD)" psql -h "$(DB_HOST)" -p "$(DB_PORT)" -U postgres \
		-c "DROP DATABASE IF EXISTS $(DB_NAME);"
	PGPASSWORD="$(DB_PASSWORD)" psql -h "$(DB_HOST)" -p "$(DB_PORT)" -U postgres \
		-c "CREATE DATABASE $(DB_NAME) OWNER $(DB_USER);"
	@$(MAKE) --no-print-directory db-setup
	@printf "$(GREEN)Database reset complete.$(RESET)\n"

.PHONY: db-shell
db-shell: ## Open an interactive psql session
	PGPASSWORD="$(DB_PASSWORD)" psql \
		-h "$(DB_HOST)" -p "$(DB_PORT)" \
		-U "$(DB_USER)" -d "$(DB_NAME)"

.PHONY: db-dump
db-dump: ## Dump the database to database/backups/YYYY-MM-DD_HH-MM.sql
	@mkdir -p $(DB_DIR)/backups
	@DUMP="$(DB_DIR)/backups/$$(date +%Y-%m-%d_%H-%M).sql"; \
	PGPASSWORD="$(DB_PASSWORD)" pg_dump \
		-h "$(DB_HOST)" -p "$(DB_PORT)" \
		-U "$(DB_USER)" -d "$(DB_NAME)" \
		--no-password -f "$$DUMP"; \
	printf "$(GREEN)Dumped to: $$DUMP$(RESET)\n"

# ==============================================================================
##@ Development
# ==============================================================================

.PHONY: serve-api
serve-api: ## Start the PHP built-in API server on port $(API_PORT)
	@printf "$(BOLD)API → http://localhost:$(API_PORT)/v1$(RESET)\n"
	@mkdir -p $(LOG_DIR)
	$(PHP) -S localhost:$(API_PORT) -t $(BACKEND_DIR)/public 2>&1 | tee $(LOG_DIR)/api.log

.PHONY: serve-ws
serve-ws: ## Start the WebSocket server on port $(WS_PORT)
	@printf "$(BOLD)WebSocket → ws://localhost:$(WS_PORT)$(RESET)\n"
	@mkdir -p $(LOG_DIR)
	$(PHP) $(WS_DIR)/server.php 2>&1 | tee $(LOG_DIR)/ws.log

.PHONY: dev
dev: env-check ## Start API and WebSocket servers in parallel (Ctrl+C stops both)
	@printf "$(BOLD)Starting FlavourConnect (development)$(RESET)\n"
	@printf "$(DIM)  API       → http://localhost:$(API_PORT)/v1$(RESET)\n"
	@printf "$(DIM)  WebSocket → ws://localhost:$(WS_PORT)$(RESET)\n"
	@printf "$(DIM)  Frontend  → open frontend/index.html$(RESET)\n\n"
	@mkdir -p $(LOG_DIR)
	@trap 'kill %1 %2 2>/dev/null; exit 0' INT TERM; \
	$(PHP) -S localhost:$(API_PORT) -t $(BACKEND_DIR)/public >$(LOG_DIR)/api.log 2>&1 & \
	$(PHP) $(WS_DIR)/server.php >$(LOG_DIR)/ws.log 2>&1 & \
	printf "$(GREEN)Both servers running. Logs in $(LOG_DIR)/$(RESET)\n"; \
	printf "$(DIM)Press Ctrl+C to stop.$(RESET)\n"; \
	wait

# ==============================================================================
##@ Quality
# ==============================================================================

.PHONY: lint
lint: ## Check PHP syntax across backend and websocket
	@printf "$(BOLD)Linting PHP files...$(RESET)\n"
	@errors=0; \
	while IFS= read -r -d '' file; do \
		result=$$(php -l "$$file" 2>&1); \
		if [ $$? -ne 0 ]; then \
			printf "$(RED)  ✘  $$file$(RESET)\n"; \
			printf "$(DIM)     $$result$(RESET)\n"; \
			errors=$$((errors + 1)); \
		fi; \
	done < <(find $(BACKEND_DIR) $(WS_DIR) -name "*.php" -print0 2>/dev/null); \
	if [ "$$errors" -eq 0 ]; then \
		printf "$(GREEN)  No syntax errors found.$(RESET)\n"; \
	else \
		printf "\n$(RED)$$errors file(s) with syntax errors.$(RESET)\n"; exit 1; \
	fi

.PHONY: test
test: ## Run the PHPUnit test suite
	@printf "$(BOLD)Running tests...$(RESET)\n"
	@[ -f "$(BACKEND_DIR)/vendor/bin/phpunit" ] || { \
		printf "$(YELLOW)PHPUnit not installed. Run: make install$(RESET)\n"; exit 1; \
	}
	cd $(BACKEND_DIR) && vendor/bin/phpunit tests/ --testdox --colors=always

.PHONY: audit
audit: ## Check Composer dependencies for known security vulnerabilities
	@printf "$(BOLD)Auditing backend...$(RESET)\n"
	cd $(BACKEND_DIR) && composer audit
	@printf "\n$(BOLD)Auditing websocket...$(RESET)\n"
	cd $(WS_DIR) && composer audit

# ==============================================================================
##@ Observability
# ==============================================================================

.PHONY: logs
logs: ## Tail all service logs (override service with: make logs SERVICE=api)
	@mkdir -p $(LOG_DIR)
ifdef SERVICE
	tail -f $(LOG_DIR)/$(SERVICE).log
else
	@tail -f $(LOG_DIR)/api.log $(LOG_DIR)/ws.log 2>/dev/null \
		|| printf "$(YELLOW)No logs yet. Run: make dev$(RESET)\n"
endif

.PHONY: logs-php
logs-php: ## Tail the PHP error log
	@tail -f $(BACKEND_DIR)/logs/php_errors.log 2>/dev/null \
		|| printf "$(YELLOW)No PHP error log found yet.$(RESET)\n"

.PHONY: health-check
health-check: ## Verify that API, WebSocket, and database are all responding
	@printf "$(BOLD)Running health checks...$(RESET)\n"
	@ok=1; \
	\
	printf "  API (port $(API_PORT))... "; \
	code=$$(curl -s -o /dev/null -w "%{http_code}" \
		"http://localhost:$(API_PORT)/v1/restaurants" \
		-H "Accept: application/json" 2>/dev/null); \
	if [ "$$code" = "200" ]; then \
		printf "$(GREEN)✔  HTTP $$code$(RESET)\n"; \
	else \
		printf "$(RED)✘  HTTP $$code (expected 200)$(RESET)\n"; ok=0; \
	fi; \
	\
	printf "  WebSocket (port $(WS_PORT))... "; \
	if nc -z localhost $(WS_PORT) 2>/dev/null; then \
		printf "$(GREEN)✔  Port open$(RESET)\n"; \
	else \
		printf "$(RED)✘  Port not reachable$(RESET)\n"; ok=0; \
	fi; \
	\
	printf "  PostgreSQL... "; \
	if PGPASSWORD="$(DB_PASSWORD)" psql \
		-h "$(DB_HOST)" -p "$(DB_PORT)" \
		-U "$(DB_USER)" -d "$(DB_NAME)" \
		-c "SELECT 1" >/dev/null 2>&1; then \
		printf "$(GREEN)✔  Connected$(RESET)\n"; \
	else \
		printf "$(RED)✘  Cannot connect$(RESET)\n"; ok=0; \
	fi; \
	\
	[ "$$ok" -eq 1 ] || { printf "\n$(RED)Health check failed.$(RESET)\n"; exit 1; }; \
	printf "\n$(GREEN)All checks passed.$(RESET)\n"

.PHONY: version
version: ## Print runtime versions of PHP, Composer, and PostgreSQL
	@printf "$(BOLD)Runtime versions:$(RESET)\n"
	@printf "  PHP:        $$(php --version | head -1)\n"
	@printf "  Composer:   $$(composer --version 2>&1 | head -1)\n"
	@PGPASSWORD="$(DB_PASSWORD)" psql \
		-h "$(DB_HOST)" -p "$(DB_PORT)" \
		-U "$(DB_USER)" -d "$(DB_NAME)" \
		-t -c "SELECT version();" 2>/dev/null | head -1 | sed 's/^/  PostgreSQL: /' \
		|| printf "  PostgreSQL: $(YELLOW)not connected$(RESET)\n"

# ==============================================================================
##@ Deployment
# ==============================================================================

.PHONY: install-services
install-services: ## Write systemd unit files for the API and WebSocket services
	@printf "$(BOLD)Writing systemd unit files...$(RESET)\n"
	@printf '[Unit]\nDescription=FlavourConnect WebSocket Server\nAfter=network.target\n\n[Service]\nType=simple\nUser=www-data\nWorkingDirectory=$(WS_DIR)\nExecStart=$(PHP) $(WS_DIR)/server.php\nRestart=always\nRestartSec=5s\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=multi-user.target\n' \
		| sudo tee /etc/systemd/system/$(WS_SERVICE).service > /dev/null
	@sudo systemctl daemon-reload
	@printf "$(GREEN)Unit files written.$(RESET)\n"
	@printf "$(DIM)Enable: sudo systemctl enable --now $(API_SERVICE) $(WS_SERVICE)$(RESET)\n"

.PHONY: start
start: ## Start all services via systemd
	sudo systemctl start $(API_SERVICE) $(WS_SERVICE)
	@printf "$(GREEN)Services started.$(RESET)\n"

.PHONY: stop
stop: ## Stop all services via systemd
	sudo systemctl stop $(API_SERVICE) $(WS_SERVICE)
	@printf "$(YELLOW)Services stopped.$(RESET)\n"

.PHONY: restart
restart: ## Restart all services via systemd
	sudo systemctl restart $(API_SERVICE) $(WS_SERVICE)
	@printf "$(GREEN)Services restarted.$(RESET)\n"

.PHONY: status
status: ## Show systemd status for all services
	@systemctl status $(API_SERVICE) $(WS_SERVICE) --no-pager 2>/dev/null \
		|| printf "$(YELLOW)Services not installed yet. Run: make install-services$(RESET)\n"

.PHONY: reload-nginx
reload-nginx: ## Test Nginx config and reload it
	@printf "$(BOLD)Testing Nginx config...$(RESET)\n"
	sudo nginx -t
	sudo systemctl reload nginx
	@printf "$(GREEN)Nginx reloaded.$(RESET)\n"

.PHONY: deploy
deploy: ## Full production deploy: install → migrate → services → nginx
	@printf "$(BOLD)$(GREEN)Deploying FlavourConnect...$(RESET)\n\n"
	@$(MAKE) --no-print-directory env-check
	@$(MAKE) --no-print-directory install-prod
	@$(MAKE) --no-print-directory db-migrate
	@$(MAKE) --no-print-directory install-services
	sudo systemctl enable $(API_SERVICE) $(WS_SERVICE)
	@$(MAKE) --no-print-directory restart
	@$(MAKE) --no-print-directory reload-nginx
	@printf "\n$(GREEN)$(BOLD)Deployment complete.$(RESET)\n\n"
	@$(MAKE) --no-print-directory health-check

# ==============================================================================
##@ Housekeeping
# ==============================================================================

.PHONY: clean
clean: ## Remove vendor directories and generated log files
	@printf "$(BOLD)Cleaning...$(RESET)\n"
	rm -rf $(BACKEND_DIR)/vendor $(WS_DIR)/vendor $(LOG_DIR)
	@printf "$(GREEN)Done.$(RESET)\n"

.PHONY: clean-logs
clean-logs: ## Delete all log files
	rm -f $(LOG_DIR)/*.log $(BACKEND_DIR)/logs/*.log
	@printf "$(GREEN)Logs cleared.$(RESET)\n"

.PHONY: clean-uploads
clean-uploads: ## ⚠ Delete all uploaded files (confirms before running)
	@printf "$(RED)This will delete all uploaded files.$(RESET)\n"
	@printf "$(YELLOW)Type 'yes' to confirm: $(RESET)"; read c; \
	if [ "$$c" = "yes" ]; then \
		find $(BACKEND_DIR)/uploads -type f ! -name ".gitkeep" -delete 2>/dev/null; \
		printf "$(GREEN)Uploads cleared.$(RESET)\n"; \
	else \
		printf "$(GREEN)Aborted.$(RESET)\n"; \
	fi
