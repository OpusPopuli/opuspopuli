# Getting Started

This guide will get you up and running with Opus Populi in under 10 minutes.

## Prerequisites

- **Node.js** 20+ and pnpm
- **Docker** and Docker Compose
- **Git**

## Quick Start (5 Minutes)

### 1. Clone and Install

```bash
# Clone repository
git clone https://github.com/your-org/opuspopuli.git
cd opuspopuli

# Install dependencies
pnpm install
```

### 2. Start Infrastructure Services

```bash
# Start Supabase (PostgreSQL + pgvector) and Ollama
docker-compose up -d

# Verify all services are running
docker-compose ps
```

Expected output:
```
NAME                      STATUS          PORTS
opuspopuli-supabase-db       Up              0.0.0.0:5432->5432/tcp
opuspopuli-supabase-kong     Up              0.0.0.0:8000->8000/tcp
opuspopuli-supabase-studio   Up              0.0.0.0:3100->3000/tcp
opuspopuli-ollama            Up              0.0.0.0:11434->11434/tcp
```

### 3. Pull the Falcon LLM Model

```bash
# Run setup script
./scripts/setup-ollama.sh

# Or manually
docker exec opuspopuli-ollama ollama pull falcon

# Verify
docker exec opuspopuli-ollama ollama list
```

### 4. Configure Environment

```bash
# Copy environment template
cp apps/backend/.env.example apps/backend/.env

# The defaults are already configured for local development:
# - Embeddings: Xenova (in-process, no setup needed)
# - Vector DB: pgvector (same PostgreSQL instance)
# - LLM: Ollama/Falcon (localhost:11434)
# - Relational DB: PostgreSQL via Supabase (localhost:5432)
# - Auth/Storage/Secrets: Supabase (localhost:8000)
```

### 5. Start the Application

```bash
# Backend services (in one terminal)
cd apps/backend
pnpm start
# This starts all microservices concurrently (API Gateway, Users, Documents, Knowledge)

# Frontend (in another terminal)
cd apps/frontend
pnpm dev
```

### 6. Verify It's Working

Open your browser to:
- **API Gateway (GraphQL Playground)**: http://localhost:3000/graphql
- **Frontend**: http://localhost:5173
- **Supabase Studio**: http://localhost:3100
- **Supabase API**: http://localhost:8000
- **Ollama**: http://localhost:11434

**Test the RAG Pipeline**:

1. Open http://localhost:3000/graphql in your browser

2. Index a test document:
```graphql
mutation {
  indexDocument(
    userId: "test-user"
    documentId: "test-doc"
    text: "Opus Populi is a full-stack platform with RAG capabilities."
  ) {
    success
    message
  }
}
```

3. Ask a question:
```graphql
query {
  answerQuery(
    userId: "test-user"
    query: "What is Opus Populi?"
  )
}
```

4. You should get an AI-generated answer based on the indexed document!

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│          Frontend (React + Vite)                 │
│          http://localhost:5173                   │
└──────────────────────────────────────────────────┘
                      ↓ GraphQL
┌──────────────────────────────────────────────────┐
│         API Gateway (Apollo Federation)          │
│          http://localhost:3000                   │
└──────────────────────────────────────────────────┘
          ↓           ↓           ↓
    ┌─────────┐ ┌──────────┐ ┌──────────┐
    │ Users   │ │Documents │ │Knowledge │
    │  :3001  │ │  :3002   │ │  :3003   │
    └─────────┘ └──────────┘ └──────────┘
          ↓           ↓           ↓
┌────────────────────────────────────────────────────┐
│              Provider Layer                        │
├────────────────────────────────────────────────────┤
│ Supabase + pgvector │ Xenova    │ Ollama/Falcon   │
│ :5432               │(in-proc)  │ :11434          │
└────────────────────────────────────────────────────┘
```

---

## Project Structure

```
opuspopuli/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── apps/          # Microservices
│   │   │   │   ├── users/     # Users Service (port 3001)
│   │   │   │   ├── documents/ # Documents Service (port 3002)
│   │   │   │   └── knowledge/ # Knowledge/RAG Service (port 3003)
│   │   │   ├── api/           # GraphQL Gateway (port 3000)
│   │   │   ├── db/            # Database module
│   │   │   └── config/        # Configuration
│   │   └── .env               # Local environment config
│   └── frontend/              # React frontend
├── docs/                      # Documentation (you are here!)
│   ├── architecture/          # As-built architecture docs
│   └── guides/                # How-to guides
├── scripts/                   # Utility scripts
└── docker-compose.yml         # Infrastructure services
```

---

## Default Configuration

Opus Populi comes with sensible defaults for local development:

### Embeddings: Xenova (Zero Setup)
- **Provider**: Xenova/Transformers.js
- **Model**: Xenova/all-MiniLM-L6-v2 (384 dimensions)
- **Runtime**: In-process (no external service)
- **First run**: Auto-downloads model from HuggingFace (~50MB)

### Vector Database: pgvector (PostgreSQL)
- **Provider**: pgvector (PostgreSQL extension)
- **Host**: localhost:5432 (same as relational DB)
- **Table**: `<project>_embeddings`
- **Storage**: Persistent (PostgreSQL)

### LLM: Ollama with Falcon 7B
- **Provider**: Ollama
- **URL**: http://localhost:11434
- **Model**: Falcon 7B (TII, Apache 2.0 license)
- **Setup**: Requires `ollama pull falcon`

### Relational Database: PostgreSQL via Supabase
- **Provider**: PostgreSQL
- **Host**: localhost:5432
- **Database**: postgres
- **Setup**: Automatic via docker-compose

### Auth/Storage/Secrets: Supabase
- **Auth**: Supabase Auth (GoTrue) with passwordless support
  - **Passkeys** (WebAuthn/FIDO2) - Primary passwordless method
  - **Magic Links** - Email-based passwordless login
  - **Password** - Legacy fallback
- **Storage**: Supabase Storage
- **Secrets**: Supabase Vault
- **API**: http://localhost:8000
- **Studio**: http://localhost:3100

### WebAuthn Configuration (Passkeys)
```bash
# Required for passkey authentication
WEBAUTHN_RP_NAME=Opus Populi
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

---

## Common Tasks

### Register a New User (Passwordless)

Opus Populi uses email-first passwordless registration:

1. Open http://localhost:3000/register
2. Enter your email address (no password needed)
3. Click "Send Magic Link"
4. Check your email and click the magic link
5. After verification, you'll be prompted to add a passkey
6. Use your fingerprint/face/PIN to create a passkey for faster future sign-ins

### Sign In

Three authentication methods are available:

**1. Passkey (Primary - Recommended)**
- Click "Sign in with Passkey"
- Authenticate with your fingerprint, face, or device PIN
- Instant sign-in without typing

**2. Magic Link**
- Enter your email
- Click "Send Magic Link"
- Check email and click link to sign in

**3. Password (Legacy)**
- Use traditional email/password combination

### Index a Document

Index text for semantic search and RAG using the GraphQL API:

```graphql
mutation IndexDocument {
  indexDocument(
    userId: "user-123"
    documentId: "quarterly-report-q4"
    text: """
    Q4 2024 Financial Report

    Revenue: $1.2M (up 25% from Q3)
    Key achievements:
    - Launched new product line
    - Expanded to 3 new markets
    - Team grew to 25 people

    Goals for Q1 2025:
    - Reach $1.5M revenue
    - Launch mobile app
    - Hire 5 more engineers
    """
  ) {
    success
    message
  }
}
```

**Response**:
```json
{
  "data": {
    "indexDocument": {
      "success": true,
      "message": "Document indexed successfully with 3 chunks"
    }
  }
}
```

### Ask Questions Using RAG

Query your indexed documents using natural language:

```graphql
query AskQuestion {
  answerQuery(
    userId: "user-123"
    query: "What was the Q4 revenue and what are the Q1 goals?"
  )
}
```

**Response**:
```json
{
  "data": {
    "answerQuery": "Q4 2024 revenue was $1.2M, which represents a 25% increase from Q3. The goals for Q1 2025 include reaching $1.5M in revenue, launching a mobile app, and hiring 5 more engineers."
  }
}
```

### Semantic Search (Without LLM)

Search for relevant text chunks without generating an answer:

```graphql
query SearchDocuments {
  searchText(
    userId: "user-123"
    query: "revenue growth"
    count: 3
  )
}
```

**Response**:
```json
{
  "data": {
    "searchText": [
      "Revenue: $1.2M (up 25% from Q3)",
      "Goals for Q1 2025: Reach $1.5M revenue",
      "Q4 2024 Financial Report"
    ]
  }
}
```

---

## Troubleshooting

### Ollama model not found

**Error**: `Error: model 'falcon' not found`

**Solution**:
```bash
# Pull the model
docker exec opuspopuli-ollama ollama pull falcon

# Verify
docker exec opuspopuli-ollama ollama list
```

### PostgreSQL/pgvector connection error

**Error**: `Failed to connect to PostgreSQL at localhost:5432`

**Solution**:
```bash
# Check if PostgreSQL is running
docker-compose ps supabase-db

# Restart if needed
docker-compose restart supabase-db

# View logs
docker-compose logs supabase-db

# Verify pgvector extension
docker exec opuspopuli-supabase-db psql -U postgres -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

### Port already in use

**Error**: `Error: listen EADDRINUSE: address already in use :::3000`

**Solution**:
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use different ports in .env
PORT=3010
```

### Xenova model download fails

**Error**: `Failed to download model from HuggingFace`

**Solution**:
1. Check internet connection
2. Try again (downloads can be flaky)
3. Clear cache: `rm -rf node_modules/@xenova/transformers/.cache`
4. Alternative: Switch to Ollama embeddings

---

## Next Steps

Now that you have Opus Populi running:

1. **Explore the API**: http://localhost:3000/graphql (GraphQL Playground)
2. **Upload documents**: Try different file types (TXT, PDF, Markdown)
3. **Test RAG**: Ask questions about your documents
4. **Read architecture docs**: [System Overview](../architecture/system-overview.md)
5. **Customize providers**: [LLM Configuration](llm-configuration.md)

---

## Development Workflow

### Backend Development

```bash
cd apps/backend

# Start all microservices concurrently (with watch mode)
pnpm start

# Run specific service only
pnpm start:api        # API Gateway only (port 3000)
pnpm start:users      # Users service only (port 3001)
pnpm start:documents  # Documents service only (port 3002)
pnpm start:knowledge  # Knowledge service only (port 3003)

# Build for production
pnpm build

# Run tests
pnpm test
pnpm test:watch
```

### Frontend Development

```bash
cd apps/frontend

# Start dev server with HMR
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test
```

### Docker Services

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f

# Restart specific service
docker-compose restart ollama

# Remove all data (fresh start)
docker-compose down -v
```

---

## Production Deployment

For production deployment, see:
- [System Overview](../architecture/system-overview.md#deployment-architecture)
- [Docker Setup](docker-setup.md) (Production configuration)

**Key Changes for Production**:
1. Use managed PostgreSQL with pgvector (Supabase Cloud or self-hosted)
2. Use Ollama with GPU instances for better performance
3. Enable SSL/TLS for all connections (required for WebAuthn)
4. Configure WebAuthn for your production domain:
   ```bash
   WEBAUTHN_RP_NAME=Your App Name
   WEBAUTHN_RP_ID=yourdomain.com
   WEBAUTHN_ORIGIN=https://yourdomain.com
   ```
5. Configure SMTP for magic link emails
6. Set up monitoring and logging
7. Configure backups

---

## Getting Help

- **Documentation**: Start with [docs/README.md](../README.md)
- **Architecture**: [System Overview](../architecture/system-overview.md)
- **Configuration**: [LLM Configuration](llm-configuration.md)
- **Issues**: Check GitHub issues or create a new one

## License

Apache 2.0 - See LICENSE file for details
