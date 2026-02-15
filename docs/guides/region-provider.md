# Region Provider Guide

This guide explains how to create a custom region provider to integrate civic data from your jurisdiction into the platform.

## Overview

The region framework follows the provider pattern used throughout the platform. The base platform includes:

- **Region microservice** (`apps/backend/src/apps/region/`) - Handles data sync, storage, and API
- **Region provider package** (`packages/region-provider/`) - Contains the example provider and factory
- **Provider interface** (`packages/common/src/providers/region/`) - TypeScript interfaces

Forks only need to create a new provider package that implements `IRegionProvider`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BASE PLATFORM                               │
├─────────────────────────────────────────────────────────────────────┤
│  packages/common/src/providers/region/                              │
│  └── types.ts (IRegionProvider, DataType)                           │
│                                                                     │
│  packages/extraction-provider/                                      │
│  ├── src/extraction.provider.ts (fetch, parse, rate limit, cache)  │
│  └── src/extraction.service.ts (text extraction orchestration)     │
│                                                                     │
│  packages/region-provider/                                          │
│  ├── src/providers/example.provider.ts (mock/sample data)          │
│  ├── src/region.service.ts (orchestrates sync)                     │
│  └── src/region.module.ts (DI factory based on env)                │
│                                                                     │
│  apps/backend/src/apps/region/                                      │
│  ├── Scheduler (cron jobs to sync data)                            │
│  ├── Database entities (propositions, meetings, reps)              │
│  └── GraphQL resolvers                                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         FORK ADDS ONLY                              │
├─────────────────────────────────────────────────────────────────────┤
│  packages/region-provider-california/  (or your jurisdiction)       │
│  └── Implements IRegionProvider using ExtractionProvider            │
└─────────────────────────────────────────────────────────────────────┘
```

**Note**: Region providers should use `ExtractionProvider` from `@opuspopuli/extraction-provider` for fetching web content. This provides built-in rate limiting, caching, retry with exponential backoff, and HTML parsing via cheerio.

## Creating a Custom Provider

### Step 1: Create the Provider Package

Create a new package directory:

```bash
mkdir -p packages/region-provider-california/src/providers
```

Create `package.json`:

```json
{
  "name": "@opuspopuli/region-provider-california",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@opuspopuli/common": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

### Step 2: Implement IRegionProvider

Create `src/providers/california.provider.ts`:

```typescript
import {
  IRegionProvider,
  RegionInfo,
  DataType,
  Proposition,
  Meeting,
  Representative,
} from '@opuspopuli/common';

export class CaliforniaRegionProvider implements IRegionProvider {
  getName(): string {
    return 'california';
  }

  getRegionInfo(): RegionInfo {
    return {
      id: 'california',
      name: 'California',
      description: 'Civic data for the State of California',
      timezone: 'America/Los_Angeles',
      dataSourceUrls: [
        'https://leginfo.legislature.ca.gov/',
        'https://www.sos.ca.gov/elections/',
      ],
    };
  }

  getSupportedDataTypes(): DataType[] {
    return [
      DataType.PROPOSITIONS,
      DataType.MEETINGS,
      DataType.REPRESENTATIVES,
    ];
  }

  async fetchPropositions(): Promise<Proposition[]> {
    // Implement scraping/API calls to fetch propositions
    // Example: Fetch from California Secretary of State API
    const propositions = await this.scrapePropositions();
    return propositions;
  }

  async fetchMeetings(): Promise<Meeting[]> {
    // Implement scraping/API calls to fetch legislative meetings
    const meetings = await this.scrapeMeetings();
    return meetings;
  }

  async fetchRepresentatives(): Promise<Representative[]> {
    // Implement API calls to fetch state legislators
    const reps = await this.fetchLegislators();
    return reps;
  }

  // Private helper methods for scraping/fetching
  private async scrapePropositions(): Promise<Proposition[]> {
    // Your implementation here
    return [];
  }

  private async scrapeMeetings(): Promise<Meeting[]> {
    // Your implementation here
    return [];
  }

  private async fetchLegislators(): Promise<Representative[]> {
    // Your implementation here
    return [];
  }
}
```

### Step 3: Export the Provider

Create `src/index.ts`:

```typescript
export { CaliforniaRegionProvider } from './providers/california.provider';
```

### Step 4: Register the Provider

Update `packages/region-provider/src/region.module.ts` to include your provider:

```typescript
import { CaliforniaRegionProvider } from '@opuspopuli/region-provider-california';

// In the factory function:
switch (config.provider) {
  case 'california':
    return new CaliforniaRegionProvider();
  case 'example':
  default:
    return new ExampleRegionProvider();
}
```

### Step 5: Configure Environment

Update your `.env` file:

```bash
REGION_PROVIDER=california
REGION_PORT=3004
REGION_SYNC_ENABLED=true
REGION_SYNC_SCHEDULE='0 2 * * *'  # Daily at 2 AM

# Provider-specific configuration
CALIFORNIA_API_KEY=your-api-key
```

### Step 6: Add to Workspace

Add to `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

Run install:

```bash
pnpm install
```

## Data Types

### Proposition

```typescript
interface Proposition {
  externalId: string;    // Unique ID from source (e.g., "prop-2024-1")
  title: string;         // Proposition title
  summary: string;       // Brief summary
  fullText?: string;     // Full text of the proposition
  status: PropositionStatus;  // 'pending' | 'passed' | 'failed' | 'withdrawn'
  electionDate?: Date;   // Election date
  sourceUrl?: string;    // Link to official source
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
  externalId: string;    // Unique ID from source
  name: string;          // Full name
  chamber: string;       // Legislative chamber
  district: string;      // District identifier
  party: string;         // Political party
  photoUrl?: string;     // URL to photo
  contactInfo?: ContactInfo;  // Contact details
}

interface ContactInfo {
  email?: string;
  phone?: string;
  office?: string;
  website?: string;
}
```

## Data Sync

The region microservice includes a scheduler that automatically syncs data:

- **Default schedule**: Daily at 2 AM (configurable via `REGION_SYNC_SCHEDULE`)
- **On startup**: Syncs all data when the service starts (if `REGION_SYNC_ENABLED=true`)

You can also trigger a manual sync via GraphQL:

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

Or sync a specific data type:

```graphql
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

## Best Practices

### 1. Use External IDs

Always use stable external IDs from your data source. This allows the sync process to correctly update existing records.

### 2. Use ExtractionProvider for Web Fetching

**Always** use `ExtractionProvider` from `@opuspopuli/extraction-provider` for fetching web content. It provides:

- **Rate Limiting**: Token bucket algorithm prevents overwhelming data sources
- **Caching**: Automatic caching with configurable TTL
- **Retry Logic**: Exponential backoff with jitter for transient failures
- **HTML Parsing**: Built-in cheerio integration for DOM selection

```typescript
import { ExtractionProvider } from '@opuspopuli/extraction-provider';

export class CaliforniaRegionProvider implements IRegionProvider {
  constructor(private readonly extraction: ExtractionProvider) {}

  async fetchPropositions(): Promise<Proposition[]> {
    // Fetch with automatic rate limiting, caching, and retry
    const result = await this.extraction.fetchUrl(
      'https://www.sos.ca.gov/elections/ballot-measures'
    );

    // Parse HTML with cheerio
    const $ = this.extraction.parseHtml(result.content);

    // Select and parse elements
    return $('table.ballot-measures tr')
      .map((_, row) => ({
        id: $(row).find('td:nth-child(1)').text().trim(),
        title: $(row).find('td:nth-child(2)').text().trim(),
        // ...
      }))
      .get();
  }

  async fetchPdfProposition(url: string): Promise<string> {
    // Fetch PDF with retry logic
    const result = await this.extraction.fetchWithRetry(url);
    const buffer = Buffer.from(result.content);
    return this.extraction.extractPdfText(buffer);
  }
}
```

### 3. Configure Extraction for Your Needs

Customize extraction settings via environment variables:

```bash
# Higher rate limit for APIs that allow it
EXTRACTION_RATE_LIMIT_RPS=5

# Longer cache for infrequently changing data
EXTRACTION_CACHE_TTL_MS=3600000  # 1 hour

# More retries for unreliable sources
EXTRACTION_RETRY_MAX_ATTEMPTS=5
```

### 4. Log Progress

Use the NestJS logger for sync progress:

```typescript
private readonly logger = new Logger(CaliforniaRegionProvider.name);

async fetchPropositions(): Promise<Proposition[]> {
  this.logger.log('Fetching California propositions...');
  const props = await this.scrapePropositions();
  this.logger.log(`Fetched ${props.length} propositions`);
  return props;
}
```

### 5. Test Your Scraper

Create unit tests for your scraping logic:

```typescript
describe('CaliforniaRegionProvider', () => {
  let provider: CaliforniaRegionProvider;

  beforeEach(() => {
    provider = new CaliforniaRegionProvider();
  });

  it('should return region info', () => {
    const info = provider.getRegionInfo();
    expect(info.id).toBe('california');
    expect(info.name).toBe('California');
  });

  it('should fetch propositions', async () => {
    const props = await provider.fetchPropositions();
    expect(Array.isArray(props)).toBe(true);
  });
});
```

## Troubleshooting

### Provider Not Loading

1. Verify `REGION_PROVIDER` is set correctly in `.env`
2. Check that the provider package is installed: `pnpm install`
3. Verify the provider is exported correctly from the package
4. Check the region service logs for errors

### Sync Failing

1. Check the sync result for errors in the GraphQL response
2. Review the region service logs: `pnpm start:region`
3. Verify external API access (network, API keys, rate limits)

### Data Not Appearing

1. Verify the sync completed successfully
2. Check the database for the records
3. Verify the GraphQL queries are returning data
4. Check frontend console for GraphQL errors

## Example Providers

- **Example Provider** (`packages/region-provider/src/providers/example.provider.ts`) - Mock data for development

## Contributing

When contributing a new region provider:

1. Follow the IRegionProvider interface strictly
2. Include comprehensive tests
3. Document data sources and any API requirements
4. Update the plan file if adding new data types
