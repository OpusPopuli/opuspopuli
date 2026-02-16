# Region Setup and Validation Guide

A step-by-step guide for standing up a region from scratch, validating data ingestion, and verifying the full user experience. This guide uses **California** as the example region but the process applies to any region.

**Audience:** IT operations staff, QA testers, and anyone validating a new region deployment.

**Time estimate:** 45–90 minutes for a complete walkthrough (first-time setup takes longer due to model downloads).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Start All Services](#2-start-all-services)
3. [Verify All Services Are Running](#3-verify-all-services-are-running)
4. [Register a New User](#4-register-a-new-user)
5. [Complete Onboarding](#5-complete-onboarding)
6. [Verify Region Configuration](#6-verify-region-configuration)
7. [Trigger Data Ingestion](#7-trigger-data-ingestion)
8. [Validate Propositions](#8-validate-propositions)
9. [Validate Meetings](#9-validate-meetings)
10. [Validate Representatives](#10-validate-representatives)
11. [Validate Campaign Finance Data](#11-validate-campaign-finance-data)
12. [Cross-Cutting Checks](#12-cross-cutting-checks)
13. [Teardown](#13-teardown)
14. [Troubleshooting](#14-troubleshooting)
15. [Quick Reference](#15-quick-reference)

---

## 1. Prerequisites

### Software Required

| Software | Version | Purpose | Install |
|----------|---------|---------|---------|
| Docker Desktop | Latest | Runs all infrastructure and backend services | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Node.js | 20 or higher | Runs the frontend application | [nodejs.org](https://nodejs.org/) |
| pnpm | Latest | Package manager for the monorepo | `npm install -g pnpm` |
| Git | Latest | Source control | [git-scm.com](https://git-scm.com/) |

### System Requirements

- **RAM:** At least 8 GB allocated to Docker Desktop (Settings > Resources > Memory)
- **Disk:** At least 10 GB free (AI models and campaign finance data are large)
- **Network:** Internet access required for downloading AI models and scraping government websites

### Get the Code

```bash
git clone https://github.com/rodneygagnon/opuspopuli.git
cd opuspopuli
git checkout main
git pull origin main
pnpm install
```

### Configure Environment

```bash
# Copy the Supabase environment template (if not already done)
cp supabase/.env.example supabase/.env
```

> **Note:** Backend environment is configured automatically by the Docker compose file. No manual `.env` editing is needed for Docker-based startup.

---

## 2. Start All Services

All infrastructure and backend services run in Docker. Only the frontend runs locally.

### 2.1 Build and Start Everything

```bash
docker compose -f docker-compose-uat.yml up -d --build
```

This single command starts **all services** in the correct order:

1. **Infrastructure** — PostgreSQL, Redis, Ollama, Supabase Auth/Storage/Studio, Inbucket, observability stack
2. **Database migration** — automatically creates all tables and sets up PostGIS
3. **Backend microservices** — Users, Documents, Knowledge, Region, API Gateway (with health checks)

> **First-time build** takes 5–10 minutes (Docker images are cached for subsequent runs).
> Wait until `docker compose ps` shows all services as **Up (healthy)** before proceeding.

### 2.2 Verify Docker Services

```bash
docker compose -f docker-compose-uat.yml ps
```

All services should show status **Up** or **Up (healthy)**. Key services to confirm:

| Service | Port | What It Does |
|---------|------|--------------|
| `opuspopuli-supabase-db` | 5432 | Database (PostgreSQL + pgvector + PostGIS) |
| `opuspopuli-supabase-kong` | 8000 | Supabase API Gateway |
| `opuspopuli-supabase-studio` | 3100 | Database admin interface |
| `opuspopuli-redis` | 6379 | Caching |
| `opuspopuli-ollama` | 11434 | AI model inference |
| `opuspopuli-inbucket` | 54324 | Email capture (for testing) |
| `opuspopuli-uat-api` | 3000 | GraphQL API Gateway |
| `opuspopuli-uat-users` | 3001 | Users microservice |
| `opuspopuli-uat-documents` | 3002 | Documents microservice |
| `opuspopuli-uat-knowledge` | 3003 | Knowledge microservice |
| `opuspopuli-uat-region` | 3004 | Region microservice |

If any service shows **Restarting** or **Unhealthy**, check its logs:

```bash
docker compose -f docker-compose-uat.yml logs <service-name>
```

### 2.3 Download the AI Model

The AI model is needed for analyzing web pages during data ingestion. First-time download is 4–7 GB.

```bash
# Option A: Use the setup script
./scripts/setup-ollama.sh

# Option B: Pull manually
docker exec opuspopuli-ollama ollama pull falcon
```

Verify the model is ready:

```bash
docker exec opuspopuli-ollama ollama list
```

You should see `falcon:latest` (or `mistral:latest` if you chose that model) in the output.

> **Tip:** For better structural analysis quality, use `mistral` instead of `falcon`:
> ```bash
> docker exec opuspopuli-ollama ollama pull mistral
> ```

### 2.4 Start the Frontend

The frontend is the only service that runs locally (outside Docker).

Open a new terminal window:

```bash
cd apps/frontend
pnpm dev
```

Wait for the **"Ready"** message indicating the development server is running on port 3200.

---

## 3. Verify All Services Are Running

Open each of these URLs in your browser. Every one should load without errors.

| URL | What You Should See |
|-----|-------------------|
| http://localhost:3200 | The Opus Populi home page |
| http://localhost:3000/graphql | GraphQL Playground (interactive query tool) |
| http://localhost:3100 | Supabase Studio (database admin) |
| http://localhost:54324 | Inbucket (email testing inbox) |
| http://localhost:3101 | Grafana (monitoring dashboards, login: admin/admin) |

You can also check backend health from the command line:

```bash
curl http://localhost:3000/health    # API Gateway
curl http://localhost:3001/health    # Users service
curl http://localhost:3002/health    # Documents service
curl http://localhost:3003/health    # Knowledge service
curl http://localhost:3004/health    # Region service
```

Each should return an HTTP 200 response.

### Startup Checklist

- [ ] All Docker containers show **Up (healthy)** — `docker compose -f docker-compose-uat.yml ps`
- [ ] AI model appears in `ollama list`
- [ ] Frontend loads at http://localhost:3200
- [ ] GraphQL Playground loads at http://localhost:3000/graphql
- [ ] Inbucket loads at http://localhost:54324

---

## 4. Register a New User

### 4.1 Start Registration

1. Open http://localhost:3200 in your browser
2. Click **"Sign In"** in the top navigation
3. On the login page, find **"Don't have an account? Create one"** and click **"Create one"**
4. Enter a test email address (e.g., `tester@example.com`)
5. Click **"Continue with Email"**
6. You should see a confirmation message: **"Check your email"**

### 4.2 Verify Your Email

Since we are running locally, all emails are captured by Inbucket (not sent to real email addresses).

1. Open http://localhost:54324 in a new browser tab
2. You should see a verification email addressed to your test email
3. Open the email and click the **verification link** inside it
4. Your browser will redirect back to the application and you will be logged in

### 4.3 Add a Passkey (Optional)

After email verification, you may see a page offering to set up a passkey for faster future logins.

- **To add a passkey:** Enter a friendly name (e.g., "My Laptop") and follow the biometric prompt (fingerprint, face, or PIN)
- **To skip:** Click **"Skip for now"**

### Registration Checklist

- [ ] Registration form accepted the email address
- [ ] Verification email appeared in Inbucket (http://localhost:54324)
- [ ] Clicking the verification link logged you in
- [ ] Passkey setup page appeared (add or skip)

---

## 5. Complete Onboarding

After your first login, the application presents a 4-step onboarding walkthrough.

1. **Step 1 — Welcome:** Read the introduction, click **"Next"**
2. **Step 2 — Scan:** Feature overview of petition scanning, click **"Next"**
3. **Step 3 — Analyze:** Feature overview of civic analysis, click **"Next"**
4. **Step 4 — Track:** Feature overview of tracking, click **"Get Started"**

After completing onboarding, you will be redirected to the petition page.

### Onboarding Checklist

- [ ] All 4 onboarding steps displayed correctly
- [ ] Progress dots at the top updated with each step
- [ ] **"Get Started"** on the final step redirected to the application
- [ ] Refreshing the page does **not** show onboarding again (it only shows once)

---

## 6. Verify Region Configuration

Before ingesting data, confirm the California region is configured correctly.

### 6.1 Check via GraphQL Playground

1. Open http://localhost:3000/graphql
2. Paste this query into the left panel and click the **Play** button:

```graphql
query {
  regionInfo {
    id
    name
    description
    timezone
    supportedDataTypes
    dataSourceUrls
  }
}
```

**Expected result:**

- `name` should be **"California"**
- `timezone` should be **"America/Los_Angeles"**
- `supportedDataTypes` should list: `PROPOSITIONS`, `MEETINGS`, `REPRESENTATIVES`, `CAMPAIGN_FINANCE`
- `dataSourceUrls` should contain URLs to CA government websites

### 6.2 Check via the UI

1. Navigate to http://localhost:3200/region
2. You should see:
   - The region name **"California"**
   - A description of the region
   - Four clickable cards for: **Propositions**, **Meetings**, **Representatives**, **Campaign Finance**
   - Data source URLs listed at the bottom

### 6.3 Verify Empty State

Click into each data type page before ingestion to confirm empty states display properly:

- [ ] http://localhost:3200/region/propositions — Shows empty state message (no data yet)
- [ ] http://localhost:3200/region/meetings — Shows empty state message
- [ ] http://localhost:3200/region/representatives — Shows empty state message
- [ ] http://localhost:3200/region/campaign-finance — Shows hub with 4 sub-category cards

---

## 7. Trigger Data Ingestion

Now we will sync all civic data from California's official government sources. This is done through the GraphQL Playground.

### 7.1 Run the Sync

1. Open http://localhost:3000/graphql
2. Paste this mutation and click **Play**:

```graphql
mutation {
  syncRegionData {
    dataType
    itemsProcessed
    itemsCreated
    itemsUpdated
    errors
    syncedAt
  }
}
```

> **What happens during sync:**
>
> The system fetches data from 8 sources configured in the California plugin:
>
> | Source | Type | What It Fetches |
> |--------|------|----------------|
> | CA Secretary of State | Web scrape | Ballot propositions |
> | CA Assembly Daily File | Web scrape | Assembly committee meetings |
> | CA Senate Daily File | Web scrape | Senate committee meetings |
> | CA Assembly Members | Web scrape | Assembly representatives (80 members) |
> | CA Senate Members | Web scrape | Senate representatives (40 members) |
> | CAL-ACCESS RCPT_CD.TSV | Bulk download | Campaign contributions |
> | CAL-ACCESS EXPN_CD.TSV | Bulk download | Campaign expenditures |
> | CAL-ACCESS S496_CD.TSV | Bulk download | Independent expenditures |
>
> **Web scrape** sources use the AI model to analyze page structure — this can take 30–60 seconds per source on the first run (cached on subsequent runs).
>
> **Bulk download** sources download a large ZIP file (~1 GB) from the CA Secretary of State. This can take **5–10 minutes** depending on your internet connection. The ZIP is downloaded once and three different TSV files are extracted from it.

### 7.2 Review Sync Results

The mutation returns an array of results, one per data type. Check each:

**Successful sync looks like:**
```json
{
  "dataType": "PROPOSITIONS",
  "itemsProcessed": 12,
  "itemsCreated": 12,
  "itemsUpdated": 0,
  "errors": [],
  "syncedAt": "2026-02-15T..."
}
```

**If you see errors:** Note the `dataType` and `errors` array. Common issues:
- **Network timeout:** The source website may be temporarily unavailable. Try again.
- **AI analysis failure:** The AI model may struggle with a page. Check that Ollama is running.
- **Bulk download timeout:** The CAL-ACCESS ZIP file is very large. Increase `requestTimeoutMs` if needed.

### Ingestion Checklist

- [ ] Mutation executed without GraphQL errors
- [ ] PROPOSITIONS sync shows `itemsProcessed > 0`
- [ ] MEETINGS sync shows `itemsProcessed > 0`
- [ ] REPRESENTATIVES sync shows `itemsProcessed > 0`
- [ ] CAMPAIGN_FINANCE sync shows `itemsProcessed > 0`
- [ ] No critical errors in the `errors` arrays

---

## 8. Validate Propositions

### 8.1 Query via GraphQL

```graphql
query {
  propositions(skip: 0, take: 10) {
    total
    hasMore
    items {
      id
      externalId
      title
      summary
      status
      electionDate
      sourceUrl
    }
  }
}
```

**Check that:**
- `total` is greater than 0
- Each item has a `title` and `summary`
- `status` values are one of: `PENDING`, `PASSED`, `FAILED`, `WITHDRAWN`
- `electionDate` is populated (may be null for some items)

### 8.2 Verify in the UI

1. Navigate to http://localhost:3200/region/propositions
2. Verify each proposition card displays:
   - Title text
   - Summary text (may be truncated to 3 lines)
   - Status badge with color coding
   - Election date (formatted as readable date)
3. If there are more than 10 items, verify **pagination controls** appear and work
4. Click any proposition card to open its detail page
5. On the detail page, verify the full text and source URL are displayed

### Propositions Checklist

- [ ] GraphQL returns proposition data
- [ ] UI shows proposition cards with title, summary, status, date
- [ ] Status badges are color-coded
- [ ] Pagination works (if applicable)
- [ ] Detail page loads when clicking a card

---

## 9. Validate Meetings

### 9.1 Query via GraphQL

```graphql
query {
  meetings(skip: 0, take: 10) {
    total
    hasMore
    items {
      id
      externalId
      title
      body
      scheduledAt
      location
      agendaUrl
      videoUrl
    }
  }
}
```

**Check that:**
- `total` is greater than 0
- Each item has a `title` and `scheduledAt` date
- `location` may or may not be populated
- `agendaUrl` and `videoUrl` may or may not be populated

### 9.2 Verify in the UI

1. Navigate to http://localhost:3200/region/meetings
2. Verify each meeting card displays:
   - Date badge (calendar-style visual with month and day)
   - Title
   - Body/description text
   - Formatted date and time
   - Location (when available)
   - Agenda and/or video links (when available)
3. Meetings in the past should show a **"Past"** indicator
4. Verify pagination if more than 10 meetings

### Meetings Checklist

- [ ] GraphQL returns meeting data
- [ ] UI shows meeting cards with date badge, title, time
- [ ] Past meetings are visually distinguished
- [ ] Agenda/video links are clickable (when present)
- [ ] Pagination works (if applicable)

---

## 10. Validate Representatives

### 10.1 Query via GraphQL

```graphql
query {
  representatives(skip: 0, take: 12) {
    total
    hasMore
    items {
      id
      name
      chamber
      district
      party
      photoUrl
      contactInfo {
        email
        phone
        office
        website
      }
    }
  }
}
```

**Check that:**
- `total` is approximately **120** (80 Assembly + 40 Senate)
- Each item has `name`, `chamber`, `district`, and `party`
- `contactInfo` fields are populated where available

### 10.2 Test Chamber Filter

```graphql
query {
  representatives(skip: 0, take: 12, chamber: "Assembly") {
    total
    items { name, chamber, district }
  }
}
```

Should return approximately 80 Assembly members.

```graphql
query {
  representatives(skip: 0, take: 12, chamber: "Senate") {
    total
    items { name, chamber, district }
  }
}
```

Should return approximately 40 Senators.

### 10.3 Verify in the UI

1. Navigate to http://localhost:3200/region/representatives
2. Verify the page shows a grid of representative cards
3. Each card should display:
   - Photo (or a placeholder avatar if no photo)
   - Full name
   - Party badge (color-coded: blue for Democrat, red for Republican, etc.)
   - Chamber (Assembly or Senate)
   - District number
   - Contact information (email, phone, office address, website — as available)
4. Test the **chamber filter** dropdown at the top:
   - Select "Assembly" — only Assembly members should appear
   - Select "Senate" — only Senators should appear
   - Select "All" — all representatives should appear
5. Click **"Contact [Name]"** on any card to verify the contact modal opens
6. Verify pagination (12 per page)

### Representatives Checklist

- [ ] GraphQL returns ~120 representatives
- [ ] UI shows representative cards in a grid
- [ ] Photos display (or placeholder avatars)
- [ ] Party badges are color-coded correctly
- [ ] Chamber filter works (Assembly ~80, Senate ~40)
- [ ] Contact info displays where available
- [ ] Contact modal opens
- [ ] Pagination works

---

## 11. Validate Campaign Finance Data

### 11.1 Campaign Finance Hub

1. Navigate to http://localhost:3200/region/campaign-finance
2. Verify the hub page displays 4 sub-category cards:
   - **Committees** — Campaign committees and PACs
   - **Contributions** — Campaign donations
   - **Expenditures** — Campaign spending
   - **Independent Expenditures** — Independent spending for/against candidates
3. Each card should be clickable

### 11.2 Committees

**GraphQL Query:**
```graphql
query {
  committees(skip: 0, take: 10) {
    total
    hasMore
    items {
      id
      name
      type
      candidateName
      party
      status
      sourceSystem
    }
  }
}
```

**UI Verification:**
1. Navigate to http://localhost:3200/region/campaign-finance/committees
2. Verify committee cards display name, type, status, and source system
3. Verify pagination works

### 11.3 Contributions

**GraphQL Query:**
```graphql
query {
  contributions(skip: 0, take: 10) {
    total
    hasMore
    items {
      id
      donorName
      donorType
      amount
      date
      sourceSystem
    }
  }
}
```

**UI Verification:**
1. Navigate to http://localhost:3200/region/campaign-finance/contributions
2. Verify contribution cards display:
   - Donor name
   - Formatted date
   - Amount displayed as currency (e.g., $1,500.00)
   - Donor type badge (individual, committee, party, other)
   - Source system label
3. Verify pagination works

### 11.4 Expenditures

**GraphQL Query:**
```graphql
query {
  expenditures(skip: 0, take: 10) {
    total
    hasMore
    items {
      id
      payeeName
      amount
      date
      purposeDescription
      sourceSystem
    }
  }
}
```

**UI Verification:**
1. Navigate to http://localhost:3200/region/campaign-finance/expenditures
2. Verify expenditure cards display payee name, amount, date, and purpose
3. Verify pagination works

### 11.5 Independent Expenditures

**GraphQL Query:**
```graphql
query {
  independentExpenditures(skip: 0, take: 10) {
    total
    hasMore
    items {
      id
      committeeName
      candidateName
      amount
      date
      supportOrOppose
      sourceSystem
    }
  }
}
```

**UI Verification:**
1. Navigate to http://localhost:3200/region/campaign-finance/independent-expenditures
2. Verify IE cards display committee name, candidate name, amount, and support/oppose indicator
3. Verify pagination works

### Campaign Finance Checklist

- [ ] Hub page shows 4 sub-category cards
- [ ] Committees page renders with data
- [ ] Contributions page renders with currency-formatted amounts
- [ ] Donor type badges display with correct colors
- [ ] Expenditures page renders with data
- [ ] Independent Expenditures page renders with support/oppose indicators
- [ ] Pagination works on all campaign finance pages

---

## 12. Cross-Cutting Checks

These checks verify behavior that spans all pages.

### 12.1 Navigation

- [ ] Clicking the logo in the header returns to the home page
- [ ] All links in the header navigation work
- [ ] Navigating from Region overview to each data type page and back works
- [ ] Pasting a URL directly into the browser loads the correct page (deep linking)
- [ ] Browser back/forward buttons work as expected

### 12.2 Dark Mode

- [ ] If your system is set to dark mode, the entire application should render in dark theme
- [ ] All text remains readable against dark backgrounds
- [ ] Cards, badges, and borders are visible in dark mode
- [ ] All region pages render correctly in dark mode

### 12.3 Responsive Design

Using your browser's developer tools (F12 or Cmd+Option+I), test at different viewport widths:

- [ ] **Desktop (1200px+):** Multi-column grid layouts, sidebar navigation in settings
- [ ] **Tablet (768px):** Layouts adjust, cards may stack to fewer columns
- [ ] **Mobile (375px):** Single-column layout, all content accessible, navigation is usable

### 12.4 User Session

- [ ] Refreshing any page keeps you logged in
- [ ] The header displays your email address
- [ ] Clicking **"Sign Out"** logs you out and returns to the login page
- [ ] After signing out, navigating to a protected page redirects to login

### 12.5 Error Handling

To test error states, stop the region service container:

```bash
docker compose -f docker-compose-uat.yml stop region
```

- [ ] Region pages display a user-friendly error message (not a blank page or crash)
- [ ] After restarting the service and refreshing, pages recover and display data:
  ```bash
  docker compose -f docker-compose-uat.yml start region
  ```

---

## 13. Teardown

### Option A: Stop Services (Keep Data)

Use this when you plan to resume testing later. All data (database, cache, AI models) is preserved.

```bash
# Stop frontend: Ctrl+C in the frontend terminal

# Stop all Docker containers (data preserved in volumes)
docker compose -f docker-compose-uat.yml down
```

### Option B: Full Cleanup (Delete Everything)

Use this for a completely fresh start. All data, user accounts, and synced region data are deleted.

```bash
# Stop frontend first (Ctrl+C)

# Stop containers and delete all data volumes
docker compose -f docker-compose-uat.yml down -v
```

### Option C: Reset User Only (Keep Region Data)

Use this to re-test the registration and onboarding flow without re-ingesting all data.

1. **Clear browser data:**
   - Open browser developer tools (F12 or Cmd+Option+I)
   - Go to **Application** > **Local Storage** > http://localhost:3200
   - Click **Clear** to remove all stored data (this resets the onboarding flag)

2. **Delete the test user from the database:**
   - Open Supabase Studio: http://localhost:3100
   - Navigate to the `auth.users` table
   - Find and delete the row for your test email address

   Alternatively, use the command line:
   ```bash
   docker exec opuspopuli-supabase-db psql -U postgres -c \
     "DELETE FROM auth.users WHERE email = 'tester@example.com';"
   ```

3. You can now re-register and go through onboarding again.

---

## 14. Troubleshooting

### Service Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Docker container keeps restarting | Not enough memory | Increase Docker Desktop memory to 8 GB+ (Settings > Resources) |
| Port already in use | Another application is using the port | Find the process: `lsof -i :<port>` and stop it, or change ports in `.env` |
| Backend containers won't start | Database migration failed | Check `docker compose -f docker-compose-uat.yml logs db-migrate` for errors |
| Frontend shows blank page | Backend not running | Verify backend containers are healthy: `docker compose -f docker-compose-uat.yml ps` |

### Data Ingestion Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Sync returns 0 items for propositions | Source website changed layout | Check that https://www.sos.ca.gov/elections/ballot-measures/qualified-ballot-measures is accessible and hasn't changed |
| AI analysis takes too long | Ollama model too slow | Try `mistral` model for better reliability, or increase Docker CPU allocation |
| Campaign finance sync times out | Large file download | The CAL-ACCESS ZIP is ~1 GB. Ensure stable internet. Try again if it times out. |
| "Model not found" error | AI model not downloaded | Run `docker exec opuspopuli-ollama ollama pull falcon` |
| Sync shows errors in response | Individual source failed | Check the `errors` array for details. Some sources may fail independently. |

### Authentication Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Verification email not appearing | Inbucket not running | Check http://localhost:54324 is accessible. Run `docker-compose up -d inbucket` |
| Magic link expired | Link is valid for 2 hours | Register again to receive a new link |
| Passkey setup fails | Browser doesn't support WebAuthn | Use Chrome or Edge. Skip passkey setup if needed. |
| Can't log in after registering | Browser localStorage corrupted | Clear browser storage (Dev Tools > Application > Clear) |

### Database Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Migration fails | Database not ready yet | Wait 30 seconds after `docker-compose up` and try again |
| PostGIS error | Spatial extension not loaded | Run: `docker exec opuspopuli-supabase-db psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS postgis;"` |
| SRID 4326 missing | Initialization script didn't run | Run: `docker exec opuspopuli-supabase-db psql -U postgres -c "INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text) VALUES (4326, 'EPSG', 4326, '+proj=longlat +datum=WGS84 +no_defs') ON CONFLICT DO NOTHING;"` |

---

## 15. Quick Reference

### URLs

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:3200 | Main application |
| GraphQL Playground | http://localhost:3000/graphql | Run queries and mutations |
| Supabase Studio | http://localhost:3100 | Database admin |
| Inbucket | http://localhost:54324 | Email testing inbox |
| Grafana | http://localhost:3101 | Monitoring (admin/admin) |
| Prometheus | http://localhost:9090 | Metrics |

### Ports

| Port | Service | Docker Container |
|------|---------|-----------------|
| 3000 | API Gateway (GraphQL) | `opuspopuli-uat-api` |
| 3001 | Users microservice | `opuspopuli-uat-users` |
| 3002 | Documents microservice | `opuspopuli-uat-documents` |
| 3003 | Knowledge microservice | `opuspopuli-uat-knowledge` |
| 3004 | Region microservice | `opuspopuli-uat-region` |
| 3100 | Supabase Studio | `opuspopuli-supabase-studio` |
| 3101 | Grafana | `opuspopuli-grafana` |
| 3200 | Frontend | _(runs locally)_ |
| 5432 | PostgreSQL | `opuspopuli-supabase-db` |
| 6379 | Redis | `opuspopuli-redis` |
| 8000 | Supabase Kong Gateway | `opuspopuli-supabase-kong` |
| 9090 | Prometheus | `opuspopuli-prometheus` |
| 11434 | Ollama | `opuspopuli-ollama` |
| 54324 | Inbucket | `opuspopuli-inbucket` |

### Key Commands

```bash
# Start infrastructure + backend (all in Docker)
docker compose -f docker-compose-uat.yml up -d --build

# Start frontend (separate terminal)
cd apps/frontend && pnpm dev

# Check Docker health
docker compose -f docker-compose-uat.yml ps

# Check backend health
curl http://localhost:3000/health

# Check AI model
docker exec opuspopuli-ollama ollama list

# View logs for a specific service
docker compose -f docker-compose-uat.yml logs <service-name>

# Stop everything (keep data)
docker compose -f docker-compose-uat.yml down

# Stop everything (delete data)
docker compose -f docker-compose-uat.yml down -v
```

### California Data Sources

| Data Type | Source | Method |
|-----------|--------|--------|
| Propositions | CA Secretary of State | Web scrape |
| Assembly Meetings | CA Assembly Daily File | Web scrape |
| Senate Meetings | CA Senate Daily File | Web scrape |
| Assembly Members | CA Assembly website | Web scrape |
| State Senators | CA Senate website | Web scrape |
| Contributions | CAL-ACCESS RCPT_CD.TSV | Bulk download (ZIP) |
| Expenditures | CAL-ACCESS EXPN_CD.TSV | Bulk download (ZIP) |
| Independent Expenditures | CAL-ACCESS S496_CD.TSV | Bulk download (ZIP) |

---

## Related Documentation

- [Getting Started](getting-started.md) — Development quick start
- [Region Provider](region-provider.md) — How the plugin system works and how to add regions
- [Docker Setup](docker-setup.md) — Infrastructure service details
- [LLM Configuration](llm-configuration.md) — Switching AI models
- [Supabase Setup](supabase-setup.md) — Authentication and storage configuration
