#!/bin/bash

# =============================================================================
# OPUSPOPULI Application Server Setup
# =============================================================================
# This script sets up:
# - Docker and Docker Compose
# - Self-hosted Supabase stack (PostgreSQL, Auth, Storage, Realtime)
# - pgvector extension for vector storage
# - Redis for caching
#
# Features:
# - Retry logic for network operations
# - Health checks instead of hardcoded sleeps
# - Idempotency (safe to re-run)
# - Comprehensive logging
# =============================================================================

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SETUP_DIR="/opt/opuspopuli"
MARKER_FILE="/opt/opuspopuli/.setup-complete"
LOG_FILE="/var/log/user-data.log"
MAX_RETRIES=5
RETRY_DELAY=10

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------

exec > >(tee -a "$LOG_FILE" | logger -t user-data -s 2>/dev/console) 2>&1

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

log_success() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1"
}

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

# Retry a command with exponential backoff
retry() {
    local max_attempts=$1
    local delay=$2
    shift 2
    local cmd="$@"
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        log "Attempt $attempt/$max_attempts: $cmd"
        if eval "$cmd"; then
            return 0
        fi
        log_error "Attempt $attempt failed. Retrying in $${delay}s..."
        sleep $delay
        delay=$((delay * 2))
        attempt=$((attempt + 1))
    done

    log_error "All $max_attempts attempts failed for: $cmd"
    return 1
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Wait for a service to be healthy
wait_for_healthy() {
    local service_name=$1
    local check_cmd=$2
    local max_wait=$${3:-300}  # Default 5 minutes
    local interval=$${4:-5}

    log "Waiting for $service_name to be healthy (max $${max_wait}s)..."
    local elapsed=0

    while [ $elapsed -lt $max_wait ]; do
        if eval "$check_cmd" >/dev/null 2>&1; then
            log_success "$service_name is healthy after $${elapsed}s"
            return 0
        fi
        sleep $interval
        elapsed=$((elapsed + interval))
    done

    log_error "$service_name did not become healthy within $${max_wait}s"
    return 1
}

# -----------------------------------------------------------------------------
# Main Setup
# -----------------------------------------------------------------------------

log "=========================================="
log "Starting OPUSPOPULI App Server Setup"
log "=========================================="

# Check if setup already completed
if [ -f "$MARKER_FILE" ]; then
    log "Setup already completed. Checking services..."
    cd "$SETUP_DIR"
    if docker-compose ps | grep -q "Up"; then
        log_success "Services are running. Nothing to do."
        exit 0
    else
        log "Services not running. Restarting..."
        docker-compose up -d
        exit 0
    fi
fi

# -----------------------------------------------------------------------------
# Step 1: System Update
# -----------------------------------------------------------------------------

log "Step 1: Updating system packages..."

if ! retry $MAX_RETRIES $RETRY_DELAY "apt-get update"; then
    log_error "Failed to update apt cache"
    exit 1
fi

# Upgrade with automatic conflict resolution
export DEBIAN_FRONTEND=noninteractive
retry $MAX_RETRIES $RETRY_DELAY "apt-get upgrade -y -o Dpkg::Options::='--force-confdef' -o Dpkg::Options::='--force-confold'"

# -----------------------------------------------------------------------------
# Step 2: Install Dependencies
# -----------------------------------------------------------------------------

log "Step 2: Installing dependencies..."

PACKAGES="apt-transport-https ca-certificates curl gnupg lsb-release jq unzip"

for pkg in $PACKAGES; do
    if dpkg -l | grep -q "^ii  $pkg "; then
        log "$pkg already installed"
    else
        retry $MAX_RETRIES $RETRY_DELAY "apt-get install -y $pkg"
    fi
done

# -----------------------------------------------------------------------------
# Step 3: Install Docker
# -----------------------------------------------------------------------------

log "Step 3: Installing Docker..."

if command_exists docker; then
    log "Docker already installed: $(docker --version)"
else
    log "Installing Docker..."
    if ! retry $MAX_RETRIES $RETRY_DELAY "curl -fsSL https://get.docker.com | sh"; then
        log_error "Failed to install Docker"
        exit 1
    fi
fi

# Ensure docker group and permissions
usermod -aG docker ubuntu 2>/dev/null || true
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready
wait_for_healthy "Docker" "docker info" 60 5 || exit 1

# -----------------------------------------------------------------------------
# Step 4: Install Docker Compose
# -----------------------------------------------------------------------------

log "Step 4: Installing Docker Compose..."

if command_exists docker-compose; then
    log "Docker Compose already installed: $(docker-compose --version)"
else
    log "Installing Docker Compose..."
    DOCKER_COMPOSE_VERSION=$(retry 3 5 "curl -s https://api.github.com/repos/docker/compose/releases/latest | jq -r .tag_name")

    if [ -z "$DOCKER_COMPOSE_VERSION" ] || [ "$DOCKER_COMPOSE_VERSION" = "null" ]; then
        DOCKER_COMPOSE_VERSION="v2.24.0"  # Fallback version
        log "Using fallback Docker Compose version: $DOCKER_COMPOSE_VERSION"
    fi

    retry $MAX_RETRIES $RETRY_DELAY "curl -L 'https://github.com/docker/compose/releases/download/$DOCKER_COMPOSE_VERSION/docker-compose-$(uname -s)-$(uname -m)' -o /usr/local/bin/docker-compose"
    chmod +x /usr/local/bin/docker-compose
fi

# -----------------------------------------------------------------------------
# Step 5: Install AWS CLI
# -----------------------------------------------------------------------------

log "Step 5: Installing AWS CLI..."

if command_exists aws; then
    log "AWS CLI already installed: $(aws --version)"
else
    log "Installing AWS CLI v2..."
    cd /tmp
    retry $MAX_RETRIES $RETRY_DELAY "curl -fsSL 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o 'awscliv2.zip'"
    unzip -o awscliv2.zip
    ./aws/install --update
    rm -rf aws awscliv2.zip
fi

# -----------------------------------------------------------------------------
# Step 6: Fetch Secrets
# -----------------------------------------------------------------------------

log "Step 6: Fetching secrets from AWS Secrets Manager..."

SECRETS=""
if ! SECRETS=$(retry $MAX_RETRIES $RETRY_DELAY "aws secretsmanager get-secret-value --secret-id '${secret_arn}' --region '${aws_region}' --query SecretString --output text"); then
    log_error "Failed to fetch secrets from AWS Secrets Manager"
    exit 1
fi

POSTGRES_PASSWORD=$(echo "$SECRETS" | jq -r '.postgres_password')
JWT_SECRET=$(echo "$SECRETS" | jq -r '.jwt_secret')
ANON_KEY=$(echo "$SECRETS" | jq -r '.anon_key')
SERVICE_ROLE_KEY=$(echo "$SECRETS" | jq -r '.service_role_key')

if [ -z "$POSTGRES_PASSWORD" ] || [ "$POSTGRES_PASSWORD" = "null" ]; then
    log_error "Failed to parse secrets"
    exit 1
fi

log_success "Secrets fetched successfully"

# -----------------------------------------------------------------------------
# Step 7: Create Working Directory and Configuration
# -----------------------------------------------------------------------------

log "Step 7: Creating configuration files..."

mkdir -p "$SETUP_DIR"
cd "$SETUP_DIR"

# Create docker-compose.yml for Supabase stack
cat > docker-compose.yml <<'DOCKEREOF'
version: '3.8'

services:
  # PostgreSQL with pgvector
  postgres:
    image: supabase/postgres:15.1.0.147
    container_name: supabase-db
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: $${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # PostgREST API
  postgrest:
    image: postgrest/postgrest:v11.2.2
    container_name: supabase-rest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://postgres:$${POSTGRES_PASSWORD}@postgres:5432/postgres
      PGRST_DB_SCHEMAS: public,storage,graphql_public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: $${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"

  # GoTrue (Auth)
  gotrue:
    image: supabase/gotrue:v2.132.3
    container_name: supabase-auth
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: http://localhost
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:$${POSTGRES_PASSWORD}@postgres:5432/postgres
      GOTRUE_SITE_URL: http://localhost
      GOTRUE_URI_ALLOW_LIST: "*"
      GOTRUE_DISABLE_SIGNUP: "false"
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_EXP: 3600
      GOTRUE_JWT_SECRET: $${JWT_SECRET}
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_MAILER_AUTOCONFIRM: "true"

  # Realtime
  realtime:
    image: supabase/realtime:v2.25.35
    container_name: supabase-realtime
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: postgres
      DB_USER: supabase_admin
      DB_PASSWORD: $${POSTGRES_PASSWORD}
      DB_SSL: "false"
      PORT: 4000
      JWT_SECRET: $${JWT_SECRET}
      REPLICATION_MODE: RLS
      REPLICATION_POLL_INTERVAL: 100
      SECURE_CHANNELS: "true"
      SLOT_NAME: supabase_realtime_rls
      TEMPORARY_SLOT: "true"

  # Storage
  storage:
    image: supabase/storage-api:v0.46.4
    container_name: supabase-storage
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      ANON_KEY: $${ANON_KEY}
      SERVICE_KEY: $${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://postgrest:3000
      PGRST_JWT_SECRET: $${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:$${POSTGRES_PASSWORD}@postgres:5432/postgres
      FILE_SIZE_LIMIT: 52428800
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: local
      GLOBAL_S3_BUCKET: stub
    volumes:
      - storage-data:/var/lib/storage

  # Kong (API Gateway)
  kong:
    image: kong:3.4.2
    container_name: supabase-kong
    restart: unless-stopped
    ports:
      - "80:8000"
      - "443:8443"
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /usr/local/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl
    volumes:
      - ./kong.yml:/usr/local/kong/kong.yml

  # Supabase Studio
  studio:
    image: supabase/studio:20240101-ce42139
    container_name: supabase-studio
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      STUDIO_PG_META_URL: http://meta:8080
      POSTGRES_PASSWORD: $${POSTGRES_PASSWORD}
      DEFAULT_ORGANIZATION_NAME: "OPUSPOPULI"
      DEFAULT_PROJECT_NAME: "${project}-${stage}"
      SUPABASE_URL: http://kong:8000
      SUPABASE_PUBLIC_URL: http://localhost
      SUPABASE_ANON_KEY: $${ANON_KEY}
      SUPABASE_SERVICE_KEY: $${SERVICE_ROLE_KEY}

  # Meta (for Studio)
  meta:
    image: supabase/postgres-meta:v0.75.0
    container_name: supabase-meta
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PG_META_PORT: 8080
      PG_META_DB_HOST: postgres
      PG_META_DB_PORT: 5432
      PG_META_DB_NAME: postgres
      PG_META_DB_USER: postgres
      PG_META_DB_PASSWORD: $${POSTGRES_PASSWORD}

  # Redis (for caching)
  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
  storage-data:
  redis-data:
DOCKEREOF

# Create Kong configuration
cat > kong.yml <<'KONGEOF'
_format_version: "3.0"

services:
  - name: auth-v1
    url: http://gotrue:9999/
    routes:
      - name: auth-v1-all
        strip_path: true
        paths:
          - /auth/v1/

  - name: rest-v1
    url: http://postgrest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/

  - name: realtime-v1
    url: http://realtime:4000/
    routes:
      - name: realtime-v1-all
        strip_path: true
        paths:
          - /realtime/v1/

  - name: storage-v1
    url: http://storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/

  - name: meta
    url: http://meta:8080/
    routes:
      - name: meta-all
        strip_path: true
        paths:
          - /pg/

plugins:
  - name: cors
    config:
      origins:
        - "*"
      methods:
        - GET
        - POST
        - PUT
        - PATCH
        - DELETE
        - OPTIONS
      headers:
        - Accept
        - Accept-Version
        - Content-Length
        - Content-MD5
        - Content-Type
        - Date
        - X-Auth-Token
        - Authorization
        - apikey
      exposed_headers:
        - X-Auth-Token
      credentials: true
      max_age: 3600
KONGEOF

# Create init scripts directory
mkdir -p init-scripts

# Create database initialization script
cat > init-scripts/01-init.sql <<'SQLEOF'
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create necessary roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_storage_admin') THEN
        CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') THEN
        CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
    END IF;
END
$$;

-- Grant necessary permissions
GRANT anon TO postgres;
GRANT authenticated TO postgres;
GRANT service_role TO postgres;
GRANT supabase_auth_admin TO postgres;
GRANT supabase_storage_admin TO postgres;
GRANT supabase_admin TO postgres;

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;

-- Create storage schema
CREATE SCHEMA IF NOT EXISTS storage;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
SQLEOF

# Create .env file
cat > .env <<ENVEOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
GPU_SERVER_IP=${gpu_server_ip}
ENVEOF

# Set proper ownership
chown -R ubuntu:ubuntu "$SETUP_DIR"

log_success "Configuration files created"

# -----------------------------------------------------------------------------
# Step 8: Pull Docker Images
# -----------------------------------------------------------------------------

log "Step 8: Pulling Docker images (this may take a while)..."

cd "$SETUP_DIR"

# Pull images with retry
retry $MAX_RETRIES $RETRY_DELAY "docker-compose pull" || {
    log_error "Failed to pull some images, will try on startup"
}

# -----------------------------------------------------------------------------
# Step 9: Start Services
# -----------------------------------------------------------------------------

log "Step 9: Starting services..."

cd "$SETUP_DIR"
docker-compose up -d

# -----------------------------------------------------------------------------
# Step 10: Health Checks
# -----------------------------------------------------------------------------

log "Step 10: Running health checks..."

# Wait for PostgreSQL
wait_for_healthy "PostgreSQL" "docker exec supabase-db pg_isready -U postgres" 120 5 || {
    log_error "PostgreSQL health check failed"
    docker-compose logs postgres
}

# Wait for Redis
wait_for_healthy "Redis" "docker exec redis redis-cli ping" 60 5 || {
    log_error "Redis health check failed"
}

# Wait for Kong/API
wait_for_healthy "Kong API Gateway" "curl -sf http://localhost:80/rest/v1/" 120 5 || {
    log_error "Kong health check failed - API may still be starting"
}

# -----------------------------------------------------------------------------
# Step 11: HTTPS Setup (Optional)
# -----------------------------------------------------------------------------

DOMAIN_NAME="${domain_name}"
APP_SUBDOMAIN="${app_subdomain}"
CERTBOT_EMAIL="${certbot_email}"

if [ -n "$DOMAIN_NAME" ] && [ "$DOMAIN_NAME" != "" ]; then
    log "Step 11: Setting up HTTPS for $APP_SUBDOMAIN.$DOMAIN_NAME..."

    # Install nginx and certbot
    retry $MAX_RETRIES $RETRY_DELAY "apt-get install -y nginx certbot python3-certbot-nginx"

    # Stop nginx temporarily to free port 80
    systemctl stop nginx 2>/dev/null || true

    # Create nginx config for Supabase proxy
    cat > /etc/nginx/sites-available/supabase <<NGINXEOF
# HTTP - redirect to HTTPS (after cert obtained)
server {
    listen 80;
    server_name $APP_SUBDOMAIN.$DOMAIN_NAME;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS - proxy to Kong
server {
    listen 443 ssl http2;
    server_name $APP_SUBDOMAIN.$DOMAIN_NAME;

    # Certificates (will be populated by certbot)
    ssl_certificate /etc/letsencrypt/live/$APP_SUBDOMAIN.$DOMAIN_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$APP_SUBDOMAIN.$DOMAIN_NAME/privkey.pem;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Kong (Supabase API Gateway on internal port)
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}
NGINXEOF

    # Enable site
    ln -sf /etc/nginx/sites-available/supabase /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default

    # Create webroot for certbot
    mkdir -p /var/www/html

    # Update Kong to listen on 8000 instead of 80 (nginx will proxy)
    log "Updating Kong port configuration..."
    cd "$SETUP_DIR"
    sed -i 's/- "80:8000"/- "8080:8000"/' docker-compose.yml
    docker-compose up -d kong

    # Start nginx for ACME challenge
    systemctl start nginx

    # Get certificate from Let's Encrypt
    log "Obtaining SSL certificate from Let's Encrypt..."
    if retry 3 30 "certbot certonly --webroot -w /var/www/html -d $APP_SUBDOMAIN.$DOMAIN_NAME --email $CERTBOT_EMAIL --agree-tos --non-interactive"; then
        log_success "SSL certificate obtained successfully"

        # Reload nginx with SSL config
        nginx -t && systemctl reload nginx

        # Enable auto-renewal
        systemctl enable certbot.timer
        systemctl start certbot.timer

        log_success "HTTPS configured for $APP_SUBDOMAIN.$DOMAIN_NAME"
    else
        log_error "Failed to obtain SSL certificate. HTTPS not configured."
        log "Make sure DNS A record for $APP_SUBDOMAIN.$DOMAIN_NAME points to this server's IP"
        # Revert Kong to port 80
        sed -i 's/- "8080:8000"/- "80:8000"/' docker-compose.yml
        docker-compose up -d kong
        systemctl stop nginx
    fi
else
    log "Step 11: Skipping HTTPS setup (no domain configured)"
fi

# -----------------------------------------------------------------------------
# Completion
# -----------------------------------------------------------------------------

# Mark setup as complete
touch "$MARKER_FILE"
echo "$(date '+%Y-%m-%d %H:%M:%S')" > "$MARKER_FILE"

PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 || echo "unknown")

log "=========================================="
log_success "OPUSPOPULI App Server Setup Complete!"
log "=========================================="
log ""
if [ -n "$DOMAIN_NAME" ] && [ "$DOMAIN_NAME" != "" ]; then
    log "Supabase Studio: http://$PUBLIC_IP:3000"
    log "Supabase API:    https://$APP_SUBDOMAIN.$DOMAIN_NAME"
    log "PostgreSQL:      $PUBLIC_IP:5432 (with pgvector)"
    log "Redis:           $PUBLIC_IP:6379"
else
    log "Supabase Studio: http://$PUBLIC_IP:3000"
    log "Supabase API:    http://$PUBLIC_IP"
    log "PostgreSQL:      $PUBLIC_IP:5432 (with pgvector)"
    log "Redis:           $PUBLIC_IP:6379"
fi
log ""
log "GPU Server: ${gpu_server_ip}"
log ""
log "Setup completed at: $(date)"
