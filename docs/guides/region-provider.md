# Region Provider Guide

This guide explains how the declarative region plugin system works and how to add civic data for your jurisdiction.

## Overview

The platform uses **declarative region plugins** — JSON configuration that describes where civic data lives on the web and what to extract. There is no scraper code to write. The AI-powered scraping pipeline analyzes page structure, derives extraction rules, and maps raw data to typed domain models. Structured data sources (REST APIs, bulk CSV/TSV downloads) are ingested directly without AI — the schema is declared in the config.

### Key Components

- **Region microservice** (`apps/backend/src/apps/region/`) — Data sync, storage, and GraphQL API
- **Region provider package** (`packages/region-provider/`) — Plugin loader, registry, declarative plugin bridge, example provider
- **Scraping pipeline** (`packages/scraping-pipeline/`) — AI structural analysis, manifest caching, Cheerio extraction, API ingest, bulk download, domain mapping
- **Common types** (`packages/common/src/providers/`) — `DeclarativeRegionConfig`, `DataSourceConfig`, `DataType`, domain models, and config utilities

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PLATFORM                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  packages/region-provider/regions/                                  │
│  ├── federal.json    (always loaded — federal campaign finance)     │
│  ├── california.json (local plugin — state-specific civic data)     │
│  └── texas.json, ... (other regions)                                │
│       ↓ auto-discovered and synced to DB at startup                 │
│                                                                     │
│  Database (region_plugins table)                                    │
│  └── DeclarativeRegionConfig JSON + enabled flag + sync state       │
│                                                                     │
│  packages/region-provider/                                          │
│  ├── discoverRegionConfigs() (reads + validates JSON files)         │
│  ├── PluginLoaderService (loads config, creates plugins)            │
│  │   ├── loadPlugin() — local region plugin                        │
│  │   └── loadFederalPlugin() — federal plugin (always loaded)      │
│  ├── PluginRegistryService (dual-slot: federal + local)             │
│  │   ├── registerFederal() / getFederal()                          │
│  │   ├── registerLocal() / getLocal()                              │
│  │   └── getAll() — returns all active plugins                     │
│  ├── DeclarativeRegionPlugin (bridges config → IRegionPlugin)       │
│  └── ExampleRegionProvider (built-in mock data for development)     │
│                                                                     │
│  packages/scraping-pipeline/                                        │
│  ├── PipelineService (routes by sourceType)                         │
│  │   ├── html_scrape → StructuralAnalyzerService → Cheerio         │
│  │   ├── api → ApiIngestHandler (paginated REST)                   │
│  │   └── bulk_download → BulkDownloadHandler (ZIP/CSV/TSV)         │
│  ├── DomainMapperService (raw records → typed models)               │
│  └── SelfHealingService (re-analyzes when extraction fails)         │
│                                                                     │
│  packages/common/src/providers/config/                              │
│  └── resolveConfigPlaceholders() — resolve ${var} in configs        │
│                                                                     │
│  apps/backend/src/apps/region/                                      │
│  ├── RegionDomainService (loads plugins at startup, syncs data)     │
│  │   └── onModuleInit: read local stateCode → resolve federal      │
│  │       placeholders → load federal plugin → load local plugin     │
│  ├── GraphQL resolvers (queries + mutations)                        │
│  └── Database tables:                                               │
│      propositions, meetings, representatives,                       │
│      committees, contributions, expenditures,                       │
│      independent_expenditures                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Config Discovery**: `RegionDomainService.onModuleInit()` auto-discovers JSON files from `packages/region-provider/regions/` and upserts them into the `region_plugins` table (config changes propagate on every restart; the `enabled` flag is never overwritten)
2. **Local Config Read**: The service reads the enabled local region's `stateCode` (e.g., `"CA"`) from the database
3. **Placeholder Resolution**: Federal config `${stateCode}` placeholders are resolved using `resolveConfigPlaceholders()` (e.g., `contributor_state: "${stateCode}"` becomes `contributor_state: "CA"`)
4. **Federal Plugin Loading**: `PluginLoaderService.loadFederalPlugin()` creates a `DeclarativeRegionPlugin` from the resolved federal config and registers it in the `federal` slot
5. **Local Plugin Loading**: `PluginLoaderService.loadPlugin()` creates a plugin from the enabled local config (e.g., California) and registers it in the `local` slot
6. **Sync**: When data sync runs, `getAll()` returns both plugins. Each plugin calls `pipeline.execute()` for its data sources
7. **Pipeline Routing**: The pipeline routes each data source by `sourceType`:
   - `html_scrape` (default) — AI structural analysis → Cheerio extraction
   - `api` — Paginated REST API calls → JSON response parsing
   - `bulk_download` — File download → ZIP extraction → delimited parsing with filters
8. **Domain Mapping**: Raw records are mapped to typed domain models (`Proposition`, `Meeting`, `Representative`, `Committee`, `Contribution`, `Expenditure`, `IndependentExpenditure`)
9. **Storage**: Extracted data is upserted into the database

If no local plugin is configured in the database, the platform falls back to the built-in `ExampleRegionProvider` with mock data. The federal plugin always loads if its config exists.

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
    "stateCode": "NY",
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
      },
      {
        "url": "https://data.example.gov/contributions.zip",
        "dataType": "campaign_finance",
        "contentGoal": "Campaign contribution records",
        "category": "campaign_finance",
        "sourceType": "bulk_download",
        "bulk": {
          "format": "zip_csv",
          "filePattern": "contributions.csv",
          "columnMappings": {
            "COMMITTEE_ID": "committeeId",
            "DONOR_NAME": "donorName",
            "AMOUNT": "amount",
            "DATE": "date"
          },
          "filters": { "STATE": "NY" }
        }
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

**Important fields:**

| Field | Description |
|-------|-------------|
| `config.stateCode` | Two-letter US state code (e.g., `"CA"`). Used to scope federal data to this region — the federal plugin's `${stateCode}` placeholders are resolved to this value at startup. |

### Step 2: Enable the Plugin

On startup, the service auto-discovers JSON config files and syncs them to the database. New regions start **disabled** by default. Enable the plugin:

```sql
UPDATE region_plugins SET enabled = true WHERE name = 'my-state';
```

Only one local region can be enabled at a time. The federal plugin is always loaded alongside the active local plugin.

### Step 3: Restart and Sync

Restart the region service. It auto-syncs config files to the DB, resolves federal placeholders using the local region's `stateCode`, loads both plugins, and is ready:

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

## Federal Plugin

The `federal.json` config is special — it is **always loaded** alongside the active local region plugin. It provides federal-level data (FEC campaign finance) scoped to the local region's state.

### Placeholder Resolution

Federal config uses `${stateCode}` placeholders that are resolved at startup using the local region's `stateCode`:

```json
{
  "api": {
    "queryParams": {
      "contributor_state": "${stateCode}"
    }
  }
}
```

When California (`stateCode: "CA"`) is the active local region, the federal plugin's API calls send `contributor_state=CA`, and bulk download filters compare against `STATE=CA`.

If no local region has a `stateCode`, the federal config loads with unresolved placeholders and a warning is logged.

The resolution utility (`resolveConfigPlaceholders()` from `@opuspopuli/common`) supports any `${variableName}` pattern, making it extensible for future variables like `${countyFips}`.

## DeclarativeRegionConfig Reference

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `regionId` | `string` | Yes | Unique identifier (e.g., `"california"`) |
| `regionName` | `string` | Yes | Human-readable name (e.g., `"California"`) |
| `description` | `string` | Yes | Short description of the region |
| `timezone` | `string` | Yes | IANA timezone (e.g., `"America/Los_Angeles"`) |
| `stateCode` | `string` | No | Two-letter US state code (e.g., `"CA"`). Used to scope federal data. |
| `dataSources` | `DataSourceConfig[]` | Yes | Array of data source definitions |
| `rateLimit` | `object` | No | `{ requestsPerSecond, burstSize }` |
| `cacheTtlMs` | `number` | No | Cache TTL in milliseconds |
| `requestTimeoutMs` | `number` | No | Request timeout in milliseconds |

### DataSourceConfig Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | Yes | URL of the data source |
| `dataType` | `DataType` | Yes | `"propositions"`, `"meetings"`, `"representatives"`, `"campaign_finance"`, or `"lobbying"` |
| `contentGoal` | `string` | Yes | Natural language description of what to extract |
| `sourceType` | `string` | No | `"html_scrape"` (default), `"bulk_download"`, or `"api"` |
| `category` | `string` | No | Sub-grouping (e.g., `"Assembly"`, `"campaign_finance"`) |
| `hints` | `string[]` | No | Additional hints for the AI structural analyzer |
| `rateLimitOverride` | `number` | No | Override the default rate limit for this source |
| `bulk` | `BulkDownloadConfig` | No | Configuration for `bulk_download` sources |
| `api` | `ApiSourceConfig` | No | Configuration for `api` sources |

### BulkDownloadConfig Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `format` | `string` | Yes | `"tsv"`, `"csv"`, `"zip_tsv"`, or `"zip_csv"` |
| `filePattern` | `string` | No | For ZIP archives: filename to extract (e.g., `"itcont.txt"`) |
| `delimiter` | `string` | No | Column delimiter override (default: tab for tsv, comma for csv) |
| `headerLines` | `number` | No | Number of header lines to skip |
| `columnMappings` | `Record<string, string>` | Yes | Source column name to domain field name |
| `filters` | `Record<string, string>` | No | Row filter expressions (e.g., `{ "STATE": "CA" }`) |

### ApiSourceConfig Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | `string` | No | HTTP method: `"GET"` (default) or `"POST"` |
| `apiKeyEnvVar` | `string` | No | Environment variable name containing the API key |
| `apiKeyHeader` | `string` | No | Query parameter name for the API key |
| `pagination` | `ApiPaginationConfig` | No | Pagination strategy |
| `resultsPath` | `string` | No | JSON path to items array (e.g., `"results"`, `"data.items"`) |
| `queryParams` | `Record<string, string>` | No | Static query parameters appended to every request |

### ApiPaginationConfig Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `"offset"`, `"cursor"`, or `"page"` |
| `pageParam` | `string` | No | Query param name for page/offset |
| `limitParam` | `string` | No | Query param name for page size |
| `limit` | `number` | No | Items per page (default: 100) |

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

### Committee

```typescript
interface Committee {
  externalId: string;
  name: string;
  type: CommitteeType;            // 'candidate' | 'ballot_measure' | 'pac' | 'super_pac' | 'party' | 'small_contributor' | 'other'
  candidateName?: string;
  candidateOffice?: string;
  propositionId?: string;
  party?: string;
  status: "active" | "terminated";
  sourceSystem: "cal_access" | "fec";
  sourceUrl?: string;
}
```

### Contribution

```typescript
interface Contribution {
  externalId: string;
  committeeId: string;
  donorName: string;
  donorType: "individual" | "committee" | "party" | "self" | "other";
  donorEmployer?: string;
  donorOccupation?: string;
  donorCity?: string;
  donorState?: string;
  donorZip?: string;
  amount: number;
  date: Date;
  electionType?: string;
  contributionType?: string;
  sourceSystem: "cal_access" | "fec";
}
```

### Expenditure

```typescript
interface Expenditure {
  externalId: string;
  committeeId: string;
  payeeName: string;
  amount: number;
  date: Date;
  purposeDescription?: string;
  expenditureCode?: string;
  candidateName?: string;
  propositionTitle?: string;
  supportOrOppose?: "support" | "oppose";
  sourceSystem: "cal_access" | "fec";
}
```

### IndependentExpenditure

```typescript
interface IndependentExpenditure {
  externalId: string;
  committeeId: string;
  committeeName: string;
  candidateName?: string;
  propositionTitle?: string;
  supportOrOppose: "support" | "oppose";
  amount: number;
  date: Date;
  electionDate?: Date;
  description?: string;
  sourceSystem: "cal_access" | "fec";
}
```

## Source Types

The `sourceType` field on `DataSourceConfig` determines the extraction strategy:

### html_scrape (default)

The AI-powered scraping pipeline for web pages. Use for government websites with HTML content.

1. **Structural Analysis** — AI (via Ollama LLM) analyzes the page's HTML structure and produces a `StructuralManifest` with CSS selectors and field mappings
2. **Manifest Caching** — Manifests are versioned and stored in the database. Cached manifests are reused when the page structure hasn't changed
3. **Cheerio Extraction** — The manifest's CSS selectors extract raw records from the HTML
4. **Self-Healing** — If extraction fails (e.g., the website changed its layout), the pipeline re-analyzes and creates a new manifest version

### api

Paginated REST API ingestion. Use for structured JSON APIs (e.g., FEC API).

- Supports `offset`, `cursor`, and `page` pagination strategies
- API keys are resolved from environment variables at runtime
- Extracts items from JSON responses using configurable `resultsPath`
- No AI needed — the response schema is defined in the config

### bulk_download

File download and parsing. Use for bulk data exports (ZIP archives, CSV/TSV files).

- Downloads files with a 5-minute timeout for large archives
- Extracts target files from ZIP archives using `filePattern`
- Parses delimited rows using `columnMappings`
- Applies row-level `filters` during parsing (e.g., filter by state)
- No AI needed — the file schema is declared in the config

## Writing Good Content Goals

The `contentGoal` field in `DataSourceConfig` is the primary input to the AI structural analyzer (used for `html_scrape` sources). Good content goals are:

- **Specific**: "Extract Assembly members with name, district number, party affiliation, and photo URL"
- **Descriptive**: Mention the expected HTML structure if you know it (tables, lists, cards)
- **Field-aware**: Name the fields you expect to find (matches the domain model)

Use the `hints` array for additional context:

```json
{
  "url": "https://example.gov/members",
  "dataType": "representatives",
  "contentGoal": "Extract legislators with name, district, party, and photo",
  "hints": [
    "Members are displayed in a card grid layout",
    "District numbers are prefixed with 'District'",
    "Party is shown as (D) or (R) after the name"
  ]
}
```

For `api` and `bulk_download` sources, the `contentGoal` is documentation-only — extraction is driven by the `api` or `bulk` config.

## Data Sync

The region microservice syncs data from all active plugins to the database using bulk upsert operations (batched in a database transaction for performance).

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

## Version Compatibility

### Config Format Versions

Region config files use a `version` field (semver) to track the config format. The platform validates required fields on startup and rejects invalid configs.

| Config Version | Platform Version | Changes |
|----------------|-----------------|---------|
| `1.0.0` | 0.1.0+ | Initial format: `regionId`, `dataSources`, `contentGoal`, `sourceType` (`html_scrape`, `api`, `bulk_download`) |
| `1.1.0` | 0.1.0+ | Added `stateCode` for federal placeholder resolution, `category` field on data sources |

### Required Fields (all versions)

**Outer envelope:** `name`, `displayName`, `version`, `config.regionId`, `config.dataSources` (at least 1)

**Each data source:** `url`, `dataType`, `contentGoal`

### Forward Compatibility

- New optional fields may be added in minor versions (1.x.0) — older configs continue to work
- Required field changes increment the major version — migration notes will be provided
- The platform logs warnings for unrecognized fields but does not reject them

### Updating Config Versions

When the config format changes, update the `version` field in your JSON file. The platform reads the config on every restart, so no migration tool is needed — just update the file and restart.

## Troubleshooting

### Plugin Not Loading

1. Check that the `region_plugins` table has an enabled row
2. Verify the config JSON has `regionId` and `dataSources` fields
3. Check the region service logs for loader errors
4. Ensure `ScrapingPipelineModule` is imported in the region module

### Federal Data Not Scoped to State

1. Verify the local region config has a `stateCode` field (e.g., `"CA"`)
2. Check the region service logs for "Resolving federal config placeholders" message
3. If no local config is enabled, federal data loads without state filtering

### Sync Returning Empty Results

1. Check the sync mutation response for errors
2. Review the region service logs for pipeline errors
3. Verify the data source URLs are accessible
4. For `html_scrape`: Check the structural manifest in the database — the AI may need better `contentGoal` or `hints`
5. For `bulk_download`: Verify `columnMappings` match the file's actual column names
6. For `api`: Check that `apiKeyEnvVar` is set in the environment and `resultsPath` matches the response structure

### Data Not Appearing in Frontend

1. Verify the sync completed via the mutation response
2. Query the data directly via GraphQL to confirm it's in the database
3. Check the frontend console for GraphQL errors

## Example Provider

The built-in `ExampleRegionProvider` (`packages/region-provider/src/providers/example.provider.ts`) returns mock data for development. It is automatically used when no local plugin is configured in the database.
