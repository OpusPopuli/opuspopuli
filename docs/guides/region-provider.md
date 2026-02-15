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
│  Database (region_plugins table)                                     │
│  └── DeclarativeRegionConfig JSON (data sources + content goals)     │
│                                                                      │
│  packages/region-provider/                                           │
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

1. **Startup**: `RegionDomainService.onModuleInit()` reads the `region_plugins` table for an enabled plugin
2. **Loading**: `PluginLoaderService.loadPlugin()` validates the config and creates a `DeclarativeRegionPlugin`
3. **Registration**: The plugin is registered in `PluginRegistryService` and wrapped in a `RegionService`
4. **Sync**: When data sync runs, the plugin calls `pipeline.execute()` for each data source
5. **Pipeline**: The scraping pipeline fetches the page, finds/creates a structural manifest via AI, extracts data with Cheerio, and maps it to typed domain models
6. **Storage**: Extracted data is upserted into the database (propositions, meetings, representatives)

If no plugin is configured in the database, the platform falls back to the built-in `ExampleRegionProvider` with mock data.

## Adding a Region

### Step 1: Define the Configuration

Create a `DeclarativeRegionConfig` describing your region's data sources:

```typescript
// DeclarativeRegionConfig (from @opuspopuli/common)
{
  regionId: "california",
  regionName: "California",
  description: "Civic data for the State of California",
  timezone: "America/Los_Angeles",
  dataSources: [
    {
      url: "https://www.sos.ca.gov/elections/ballot-measures/qualified-ballot-measures",
      dataType: "propositions",
      contentGoal: "Extract qualified ballot measures with measure ID, title, and election date",
      hints: ["Table with ballot measure details", "Look for measure numbers like 'Prop 1'"]
    },
    {
      url: "https://assembly.ca.gov/schedules-publications/assembly-daily-file",
      dataType: "meetings",
      contentGoal: "Extract scheduled committee meetings with date, time, location, and committee name",
      category: "Assembly"
    },
    {
      url: "https://senate.ca.gov/publications/senate-daily-file",
      dataType: "meetings",
      contentGoal: "Extract scheduled committee meetings with date, time, location, and committee name",
      category: "Senate"
    },
    {
      url: "https://assembly.ca.gov/assemblymembers",
      dataType: "representatives",
      contentGoal: "Extract Assembly members with name, district number, party affiliation, and photo URL",
      category: "Assembly"
    },
    {
      url: "https://senate.ca.gov/senators",
      dataType: "representatives",
      contentGoal: "Extract Senators with name, district number, party affiliation, and photo URL",
      category: "Senate"
    }
  ],
  rateLimit: { requestsPerSecond: 1, burstSize: 3 },
  cacheTtlMs: 3600000,
  requestTimeoutMs: 30000
}
```

### Step 2: Insert into the Database

Add a row to the `region_plugins` table with your config as JSON:

```sql
INSERT INTO region_plugins (name, enabled, config, plugin_type)
VALUES (
  'california',
  true,
  '{ "regionId": "california", "regionName": "California", ... }',
  'declarative'
);
```

Or add it to a Prisma seed script:

```typescript
await prisma.regionPlugin.create({
  data: {
    name: 'california',
    enabled: true,
    pluginType: 'declarative',
    config: {
      regionId: 'california',
      regionName: 'California',
      description: 'Civic data for the State of California',
      timezone: 'America/Los_Angeles',
      dataSources: [
        // ... data sources as above
      ],
    },
  },
});
```

### Step 3: Restart and Sync

Restart the region service. It reads the enabled plugin from the database and loads it:

```bash
pnpm start:region
```

Trigger a sync via GraphQL:

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
