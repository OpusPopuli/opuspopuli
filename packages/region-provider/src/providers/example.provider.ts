import { Injectable, Logger } from "@nestjs/common";
import {
  IRegionProvider,
  RegionInfo,
  CivicDataType,
  Proposition,
  Meeting,
  Representative,
  PropositionStatus,
  RegionError,
} from "@opuspopuli/common";

/**
 * Example Region Provider
 *
 * A sample implementation of IRegionProvider that returns mock civic data.
 * Use this as a template when creating your own region provider.
 *
 * To create a custom provider:
 * 1. Create a new package (e.g., @opuspopuli/region-provider-california)
 * 2. Implement IRegionProvider interface
 * 3. Add scrapers/API calls for your region's data sources
 * 4. Set REGION_PROVIDER=your-region in .env
 */
@Injectable()
export class ExampleRegionProvider implements IRegionProvider {
  private readonly logger = new Logger(ExampleRegionProvider.name);

  constructor() {
    this.logger.log("Initialized Example Region Provider");
  }

  getName(): string {
    return "example";
  }

  getRegionInfo(): RegionInfo {
    return {
      id: "example",
      name: "Example Region",
      description:
        "A sample region with mock civic data for development and testing",
      timezone: "America/Los_Angeles",
      dataSourceUrls: ["https://example.com/civic-data"],
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
    this.logger.log("Fetching example propositions");

    try {
      // In a real provider, you would scrape or call an API here
      // For example: await this.scrapePropositionsFromLegislature()

      const propositions: Proposition[] = [
        {
          externalId: "prop-2024-001",
          title: "Example Proposition A",
          summary:
            "This is an example proposition for demonstration purposes. It would contain a summary of what the proposition does.",
          fullText:
            "Full text of the proposition would go here. In a real implementation, this could be thousands of characters containing the complete legal text of the proposition.",
          status: PropositionStatus.PENDING,
          electionDate: new Date("2024-11-05"),
          sourceUrl: "https://example.com/propositions/2024-001",
        },
        {
          externalId: "prop-2024-002",
          title: "Example Proposition B",
          summary:
            "Another example proposition demonstrating the data structure for ballot measures.",
          fullText:
            "Complete text of proposition B. This demonstrates how propositions with different statuses are represented.",
          status: PropositionStatus.PASSED,
          electionDate: new Date("2024-03-05"),
          sourceUrl: "https://example.com/propositions/2024-002",
        },
        {
          externalId: "prop-2024-003",
          title: "Example Proposition C",
          summary:
            "A failed proposition example showing how historical data can be represented.",
          fullText:
            "The full legal text of proposition C which was rejected by voters.",
          status: PropositionStatus.FAILED,
          electionDate: new Date("2024-03-05"),
          sourceUrl: "https://example.com/propositions/2024-003",
        },
      ];

      this.logger.log(`Fetched ${propositions.length} example propositions`);
      return propositions;
    } catch (error) {
      throw new RegionError(
        this.getName(),
        CivicDataType.PROPOSITIONS,
        error as Error,
      );
    }
  }

  async fetchMeetings(): Promise<Meeting[]> {
    this.logger.log("Fetching example meetings");

    try {
      // In a real provider, you would scrape meeting schedules here
      // For example: await this.scrapeMeetingsFromCalendar()

      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const meetings: Meeting[] = [
        {
          externalId: "mtg-2024-001",
          title: "Senate Floor Session",
          body: "Senate",
          scheduledAt: nextWeek,
          location: "Senate Chamber, State Capitol",
          agendaUrl: "https://example.com/meetings/senate-2024-001/agenda",
          videoUrl: "https://example.com/meetings/senate-2024-001/video",
        },
        {
          externalId: "mtg-2024-002",
          title: "Assembly Budget Committee Hearing",
          body: "Assembly",
          scheduledAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          location: "Room 4202, State Capitol",
          agendaUrl: "https://example.com/meetings/assembly-budget-2024/agenda",
        },
        {
          externalId: "mtg-2024-003",
          title: "Joint Legislative Audit Committee",
          body: "Joint",
          scheduledAt: lastWeek,
          location: "Room 113, State Capitol",
          agendaUrl: "https://example.com/meetings/jlac-2024/agenda",
          videoUrl: "https://example.com/meetings/jlac-2024/video",
        },
      ];

      this.logger.log(`Fetched ${meetings.length} example meetings`);
      return meetings;
    } catch (error) {
      throw new RegionError(
        this.getName(),
        CivicDataType.MEETINGS,
        error as Error,
      );
    }
  }

  async fetchRepresentatives(): Promise<Representative[]> {
    this.logger.log("Fetching example representatives");

    try {
      // In a real provider, you would fetch from an official API or scrape
      // For example: await this.fetchFromLegislatorAPI()

      const representatives: Representative[] = [
        {
          externalId: "rep-senate-001",
          name: "Jane Smith",
          chamber: "Senate",
          district: "District 1",
          party: "Democratic",
          photoUrl: "https://example.com/photos/jane-smith.jpg",
          contactInfo: {
            email: "senator.smith@example.gov",
            phone: "(555) 123-4567",
            address: "State Capitol, Room 100",
            website: "https://example.com/senators/smith",
          },
        },
        {
          externalId: "rep-senate-002",
          name: "John Doe",
          chamber: "Senate",
          district: "District 2",
          party: "Republican",
          photoUrl: "https://example.com/photos/john-doe.jpg",
          contactInfo: {
            email: "senator.doe@example.gov",
            phone: "(555) 234-5678",
            address: "State Capitol, Room 101",
            website: "https://example.com/senators/doe",
          },
        },
        {
          externalId: "rep-assembly-001",
          name: "Maria Garcia",
          chamber: "Assembly",
          district: "District 1",
          party: "Democratic",
          photoUrl: "https://example.com/photos/maria-garcia.jpg",
          contactInfo: {
            email: "assembly.garcia@example.gov",
            phone: "(555) 345-6789",
            address: "State Capitol, Room 200",
            website: "https://example.com/assembly/garcia",
          },
        },
        {
          externalId: "rep-assembly-002",
          name: "Robert Johnson",
          chamber: "Assembly",
          district: "District 2",
          party: "Independent",
          photoUrl: "https://example.com/photos/robert-johnson.jpg",
          contactInfo: {
            email: "assembly.johnson@example.gov",
            phone: "(555) 456-7890",
            address: "State Capitol, Room 201",
            website: "https://example.com/assembly/johnson",
          },
        },
      ];

      this.logger.log(
        `Fetched ${representatives.length} example representatives`,
      );
      return representatives;
    } catch (error) {
      throw new RegionError(
        this.getName(),
        CivicDataType.REPRESENTATIVES,
        error as Error,
      );
    }
  }
}
