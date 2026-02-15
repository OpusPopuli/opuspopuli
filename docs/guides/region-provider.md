# Region Provider Guide

This guide explains how the declarative region plugin system works and how to add civic data for your jurisdiction.

## Overview

The platform uses **declarative region plugins** — JSON configuration that describes where civic data lives on the web and what to extract. There is no scraper code to write. The AI-powered scraping pipeline analyzes page structure, derives extraction rules, and maps raw data to typed domain models.

### Key Components

- **Region microservice** (`apps/backend/src/apps/region/`) — Data sync, storage, and GraphQL API
- **Region provider package** (`packages/region-provider/`) — Plugin loader, registry, declarative plugin bridge, example provider
- **Scraping pipeline** (`packages/scraping-pipeline/`) — AI structural analysis, manifest caching, Cheerio extraction, domain mapping
- **Common types** (`packages/common/src/providers/`) — `DeclarativeRegionConfig`, `DataSourceConfig`, `DataType`, and domain models

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PLATFORM                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  packages/region-provider/regions/                                   │
│  └── california.json, texas.json, ...  (config files)               │
│       ↓ auto-discovered and synced to DB at startup                  │
│                                                                      │
│  Database (region_plugins table)                                     │
│  └── DeclarativeRegionConfig JSON + enabled flag + sync state       │
│                                                                      │
│  packages/region-provider/                                           │
│  ├── discoverRegionConfigs() (reads + validates JSON files)          │
│  ├── PluginLoaderService (loads config, creates plugin)              │
│  ├── PluginRegistryService (tracks active plugin)                    │
│  ├── DeclarativeRegionPlugin (bridges config → IRegionPlugin)        │
│  └── ExampleRegionProvider (built-in mock data for development)      │
│                                                                      │
│  packages/scraping-pipeline/                                         │
│  ├── StructuralAnalyzerService (AI analyzes page → manifest)         │
│  ├── ManifestStoreService (caches versioned manifests in DB)         │
│  ├── ManifestExtractorService (Cheerio extraction using rules)       │
│  ├── DomainMapperService (raw records → typed models)                │
│  ├── SelfHealingService (re-analyzes when extraction fails)          │
│  └── PipelineService (orchestrates the above)                        │
│                                                                      │
│  apps/backend/src/apps/region/                                       │
│  ├── RegionDomainService (loads plugin at startup, syncs data)       │
│  ├── GraphQL resolvers (queries + mutations)                         │
│  └── Database (propositions, meetings, representatives)              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Config Discovery**: `RegionDomainService.onModuleInit()` auto-discovers JSON files from `packages/region-provider/regions/` and upserts them into the `region_plugins` table (config changes propagate on every restart; the `enabled` flag is never overwritten)
2. **Plugin Loading**: `PluginLoaderService.loadPlugin()` reads the enabled plugin from the DB, validates the config, and creates a `DeclarativeRegionPlugin`
3. **Registration**: The plugin is registered in `PluginRegistryService` and wrapped in a `RegionService`
4. **Sync**: When data sync runs, the plugin calls `pipeline.execute()` for each data source
5. **Pipeline**: The scraping pipeline fetches the page, finds/creates a structural manifest via AI, extracts data with Cheerio, and maps it to typed domain models
6. **Storage**: Extracted data is upserted into the database (propositions, meetings, representatives)

If no plugin is configured in the database, the platform falls back to the built-in `ExampleRegionProvider` with mock data.

## Adding a Region

### Step 1: Create a JSON Config File

Create a new file in `packages/region-provider/regions/`. The filename should match the region name (e.g., `my-state.json`).

See `california.json` for a complete example:

```json
{
  "name": "my-state",
  "displayName": "My State",
  "description": "Civic data for My State from official government websites",
  "version": "1.0.0",
  "config": {
    "regionId": "my-state",
    "regionName": "My State",
    "description": "Civic data for My State",
    "timezone": "America/New_York",
    "dataSources": [
      {
        "url": "https://www.example.gov/ballot-measures",
        "dataType": "propositions",
        "contentGoal": "Extract ballot measures with title, description, and election date",
        "hints": ["Look for a table of measures", "Each row has a measure number"]
      },
      {
        "url": "https://www.example.gov/meetings",
        "dataType": "meetings",
        "contentGoal": "Extract scheduled committee meetings with date, time, and location",
        "category": "Legislature"
      },
      {
        "url": "https://www.example.gov/representatives",
        "dataType": "representatives",
        "contentGoal": "Extract legislators with name, district, party, and photo",
        "category": "Legislature"
      }
    ],
    "rateLimit": { "requestsPerSecond": 1, "burstSize": 3 },
    "cacheTtlMs": 900000,
    "requestTimeoutMs": 30000
  }
}
```

**Required fields:**

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (matches filename without `.json`) |
| `displayName` | Human-readable name |
| `description` | Short description |
| `version` | Semver version string |
| `config.regionId` | Must match `name` |
| `config.regionName` | Human-readable name |
| `config.dataSources` | At least one data source |

Each data source requires `url`, `dataType` (`"propositions"`, `"meetings"`, or `"representatives"`), and `contentGoal`.

### Step 2: Enable the Plugin

On startup, the service auto-discovers JSON config files and syncs them to the database. New regions start **disabled** by default. Enable the plugin:

```sql
UPDATE region_plugins SET enabled = true WHERE name = 'my-state';
```

Only one region can be enabled at a time. The platform falls back to the built-in `ExampleRegionProvider` if no plugin is enabled.

### Step 3: Restart and Sync

Restart the region service. It auto-syncs config files to the DB, loads the enabled plugin, and is ready:

```bash
pnpm start:region
```

Trigger a data sync via GraphQL:

```graphql
mutation {
  syncAll {
    dataType
    itemsProcessed
    itemsCreated
    itemsUpdated
    errors
    syncedAt
  }
}
```

### Updating Config

Edit the JSON file and restart the service. Config changes propagate automatically on every restart (the `enabled` flag and sync tracking fields are preserved).

## DeclarativeRegionConfig Reference

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `regionId` | `string` | Yes | Unique identifier (e.g., `"california"`) |
| `regionName` | `string` | Yes | Human-readable name (e.g., `"California"`) |
| `description` | `string` | Yes | Short description of the region |
| `timezone` | `string` | Yes | IANA timezone (e.g., `"America/Los_Angeles"`) |
| `dataSources` | `DataSourceConfig[]` | Yes | Array of data source definitions |
| `rateLimit` | `object` | No | `{ requestsPerSecond, burstSize }` |
| `cacheTtlMs` | `number` | No | Cache TTL in milliseconds |
| `requestTimeoutMs` | `number` | No | Request timeout in milliseconds |

### DataSourceConfig Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | Yes | URL of the page to scrape |
| `dataType` | `DataType` | Yes | `"propositions"`, `"meetings"`, or `"representatives"` |
| `contentGoal` | `string` | Yes | Natural language description of what to extract |
| `category` | `string` | No | Sub-grouping (e.g., `"Assembly"`, `"Senate"`) |
| `hints` | `string[]` | No | Additional hints for the AI structural analyzer |
| `rateLimitOverride` | `number` | No | Override the default rate limit for this source |

## Data Types

### Proposition

```typescript
interface Proposition {
  externalId: string;           // Unique ID from source (e.g., "prop-2024-1")
  title: string;                // Proposition title
  summary: string;              // Brief summary
  fullText?: string;            // Full text of the proposition
  status: PropositionStatus;    // 'pending' | 'passed' | 'failed' | 'withdrawn'
  electionDate?: Date;          // Election date
  sourceUrl?: string;           // Link to official source
}
```

### Meeting

```typescript
interface Meeting {
  externalId: string;    // Unique ID from source
  title: string;         // Meeting title
  body: string;          // Legislative body (e.g., "Senate", "Assembly")
  scheduledAt: Date;     // Meeting date/time
  location?: string;     // Physical location
  agendaUrl?: string;    // Link to agenda
  videoUrl?: string;     // Link to video recording
}
```

### Representative

```typescript
interface Representative {
  externalId: string;           // Unique ID from source
  name: string;                 // Full name
  chamber: string;              // Legislative chamber
  district: string;             // District identifier
  party: string;                // Political party
  photoUrl?: string;            // URL to photo
  contactInfo?: ContactInfo;    // Contact details
}

interface ContactInfo {
  email?: string;
  phone?: string;
  office?: string;
  website?: string;
}
```

## The Scraping Pipeline

The `@opuspopuli/scraping-pipeline` package handles all data extraction using a **schema-on-read** pattern:

1. **Structural Analysis** — AI (via Ollama LLM) analyzes a web page's HTML structure and produces a `StructuralManifest` containing CSS selectors and field mappings
2. **Manifest Caching** — Manifests are versioned and stored in the database. If the page structure hasn't changed, the cached manifest is reused (no LLM call)
3. **Cheerio Extraction** — The manifest's CSS selectors are applied with Cheerio to extract raw records from the page
4. **Domain Mapping** — Raw records are mapped to typed domain models (`Proposition`, `Meeting`, `Representative`)
5. **Self-Healing** — If extraction fails (e.g., the website changed its layout), the pipeline re-analyzes the page and creates a new manifest version

### Writing Good Content Goals

The `contentGoal` field in `DataSourceConfig` is the primary input to the AI structural analyzer. Good content goals are:

- **Specific**: "Extract Assembly members with name, district number, party affiliation, and photo URL"
- **Descriptive**: Mention the expected HTML structure if you know it (tables, lists, cards)
- **Field-aware**: Name the fields you expect to find (matches the domain model)

Use the `hints` array for additional context:

```typescript
{
  url: "https://example.gov/members",
  dataType: "representatives",
  contentGoal: "Extract legislators with name, district, party, and photo",
  hints: [
    "Members are displayed in a card grid layout",
    "District numbers are prefixed with 'District'",
    "Party is shown as (D) or (R) after the name"
  ]
}
```

## Data Sync

The region microservice syncs data from the plugin to the database using bulk upsert operations (batched in a database transaction for performance).

You can trigger a sync via GraphQL:

```graphql
# Sync all data types
mutation {
  syncAll {
    dataType
    itemsProcessed
    itemsCreated
    itemsUpdated
    errors
    syncedAt
  }
}

# Sync a specific data type
mutation {
  syncDataType(dataType: PROPOSITIONS) {
    dataType
    itemsProcessed
    itemsCreated
    itemsUpdated
    errors
    syncedAt
  }
}
```

## Querying Data

Once synced, civic data is available via GraphQL:

```graphql
# Region info
query {
  regionInfo {
    id
    name
    description
    timezone
    supportedDataTypes
  }
}

# Propositions with pagination
query {
  propositions(skip: 0, take: 10) {
    items {
      id
      title
      summary
      status
      electionDate
    }
    total
    hasMore
  }
}

# Representatives filtered by chamber
query {
  representatives(chamber: "Assembly", skip: 0, take: 20) {
    items {
      name
      district
      party
      photoUrl
    }
    total
    hasMore
  }
}
```

## Troubleshooting

### Plugin Not Loading

1. Check that the `region_plugins` table has an enabled row
2. Verify the config JSON has `regionId` and `dataSources` fields
3. Check the region service logs for loader errors
4. Ensure `ScrapingPipelineModule` is imported in the region module

### Sync Returning Empty Results

1. Check the sync mutation response for errors
2. Review the region service logs for pipeline errors
3. Verify the data source URLs are accessible
4. Check the structural manifest in the database — the AI may need better `contentGoal` or `hints`

### Data Not Appearing in Frontend

1. Verify the sync completed via the mutation response
2. Query the data directly via GraphQL to confirm it's in the database
3. Check the frontend console for GraphQL errors

## Example Provider

The built-in `ExampleRegionProvider` (`packages/region-provider/src/providers/example.provider.ts`) returns mock data for development. It is automatically used when no plugin is configured in the database.
