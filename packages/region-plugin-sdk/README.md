# @opuspopuli/region-plugin-sdk

SDK for building [Opus Populi](https://github.com/OpusPopuli/opuspopuli) region plugins. Region plugins provide civic data (propositions, meetings, representatives) from specific geographic regions.

## Installation

```bash
npm install @opuspopuli/region-plugin-sdk --registry https://npm.pkg.github.com
```

## Quick Start

```typescript
import { BaseRegionPlugin, CivicDataType } from "@opuspopuli/region-plugin-sdk";
import type {
  RegionInfo,
  Proposition,
  Meeting,
  Representative,
} from "@opuspopuli/region-plugin-sdk";

export default class MyRegionPlugin extends BaseRegionPlugin {
  constructor() {
    super("my-region");
  }

  getName(): string {
    return "my-region";
  }

  getVersion(): string {
    return "0.1.0";
  }

  getRegionInfo(): RegionInfo {
    return {
      id: "my-region",
      name: "My Region",
      description: "Civic data for My Region",
      timezone: "America/New_York",
      dataSourceUrls: ["https://example.gov/data"],
    };
  }

  getSupportedDataTypes(): CivicDataType[] {
    return [
      CivicDataType.PROPOSITIONS,
      CivicDataType.MEETINGS,
      CivicDataType.REPRESENTATIVES,
    ];
  }

  async fetchPropositions(): Promise<Proposition[]> {
    // Scrape or fetch proposition data from your region
    return [];
  }

  async fetchMeetings(): Promise<Meeting[]> {
    // Scrape or fetch meeting data from your region
    return [];
  }

  async fetchRepresentatives(): Promise<Representative[]> {
    // Scrape or fetch representative data from your region
    return [];
  }
}
```

## Exports

### Classes

| Export | Description |
|--------|-------------|
| `BaseRegionPlugin` | Abstract base class with default lifecycle implementations. Extend this to create a plugin. |
| `RegionError` | Error class wrapping data-fetch failures with region and data type context. |

### Interfaces

| Export | Description |
|--------|-------------|
| `IRegionPlugin` | Full plugin interface with lifecycle hooks (`initialize`, `healthCheck`, `destroy`). |
| `PluginHealth` | Return type for `healthCheck()` — `{ healthy, message, lastCheck, metadata }`. |
| `IRegionProvider` | Base data provider interface (extended by `IRegionPlugin`). |
| `RegionInfo` | Region metadata — `{ id, name, description, timezone, dataSourceUrls }`. |

### Data Types

| Export | Description |
|--------|-------------|
| `Proposition` | Ballot measure — `{ externalId, title, summary, status, electionDate, sourceUrl, fullText }` |
| `Meeting` | Legislative meeting — `{ externalId, title, body, scheduledAt, location, agendaUrl, videoUrl }` |
| `Representative` | Legislator — `{ externalId, name, chamber, district, party, photoUrl, contactInfo }` |
| `ContactInfo` | Contact details — `{ email, phone, address, website }` |
| `SyncResult` | Result of a data sync operation — `{ dataType, itemCount, errors }` |

### Enums

| Export | Values | Description |
|--------|--------|-------------|
| `CivicDataType` | `PROPOSITIONS`, `MEETINGS`, `REPRESENTATIVES` | Types of civic data a plugin can provide |
| `PropositionStatus` | `PENDING`, `PASSED`, `FAILED`, `WITHDRAWN` | Ballot measure status |

## Plugin Lifecycle

1. **`initialize(config?)`** — Called once when the plugin is loaded. Set up API clients, validate config.
2. **`healthCheck()`** — Called periodically. Return `{ healthy: false }` if data sources are unreachable.
3. **`fetchPropositions()`** / **`fetchMeetings()`** / **`fetchRepresentatives()`** — Called during data sync.
4. **`destroy()`** — Called on shutdown. Close connections, flush caches.

## Plugin Loader Convention

The platform discovers plugins by:
1. Default export: `export default class MyPlugin extends BaseRegionPlugin {}`
2. Named export: `export { MyRegionPlugin }` — matches `{PascalCase(name)}RegionPlugin`

## Template Repository

Use [OpusPopuli/region-template](https://github.com/OpusPopuli/region-template) as a starting point:

```bash
gh repo create MyOrg/region-my-region --template OpusPopuli/region-template --private
```

## License

AGPL-3.0
