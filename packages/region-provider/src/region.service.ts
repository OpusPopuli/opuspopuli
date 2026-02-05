import { Injectable, Logger } from "@nestjs/common";
import {
  IRegionProvider,
  RegionInfo,
  CivicDataType,
  Proposition,
  Meeting,
  Representative,
  SyncResult,
} from "@opuspopuli/common";

/**
 * Region Service
 *
 * Orchestrates region data fetching using the injected provider.
 * The provider implementation determines where data comes from (example, California, etc.).
 */
@Injectable()
export class RegionService {
  private readonly logger = new Logger(RegionService.name);

  constructor(private readonly provider: IRegionProvider) {
    const info = provider.getRegionInfo();
    this.logger.log(
      `Initialized Region Service with ${provider.getName()} provider (${info.name})`,
    );
  }

  /**
   * Get region information
   */
  getRegionInfo(): RegionInfo {
    return this.provider.getRegionInfo();
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.provider.getName();
  }

  /**
   * Get supported data types
   */
  getSupportedDataTypes(): CivicDataType[] {
    return this.provider.getSupportedDataTypes();
  }

  /**
   * Fetch propositions from the provider
   */
  async fetchPropositions(): Promise<Proposition[]> {
    this.logger.log("Fetching propositions from provider");
    const startTime = Date.now();

    const propositions = await this.provider.fetchPropositions();

    const duration = Date.now() - startTime;
    this.logger.log(
      `Fetched ${propositions.length} propositions in ${duration}ms`,
    );

    return propositions;
  }

  /**
   * Fetch meetings from the provider
   */
  async fetchMeetings(): Promise<Meeting[]> {
    this.logger.log("Fetching meetings from provider");
    const startTime = Date.now();

    const meetings = await this.provider.fetchMeetings();

    const duration = Date.now() - startTime;
    this.logger.log(`Fetched ${meetings.length} meetings in ${duration}ms`);

    return meetings;
  }

  /**
   * Fetch representatives from the provider
   */
  async fetchRepresentatives(): Promise<Representative[]> {
    this.logger.log("Fetching representatives from provider");
    const startTime = Date.now();

    const representatives = await this.provider.fetchRepresentatives();

    const duration = Date.now() - startTime;
    this.logger.log(
      `Fetched ${representatives.length} representatives in ${duration}ms`,
    );

    return representatives;
  }

  /**
   * Sync all supported data types
   * Returns sync results for each data type
   */
  async syncAll(): Promise<SyncResult[]> {
    this.logger.log("Starting full data sync");
    const results: SyncResult[] = [];
    const supportedTypes = this.getSupportedDataTypes();

    for (const dataType of supportedTypes) {
      try {
        const result = await this.syncDataType(dataType);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync ${dataType}:`, error);
        results.push({
          dataType,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          errors: [(error as Error).message],
          syncedAt: new Date(),
        });
      }
    }

    this.logger.log(`Sync complete. Processed ${results.length} data types.`);
    return results;
  }

  /**
   * Sync a specific data type
   */
  async syncDataType(dataType: CivicDataType): Promise<SyncResult> {
    this.logger.log(`Syncing ${dataType}`);
    const startTime = Date.now();

    let itemsProcessed = 0;

    switch (dataType) {
      case CivicDataType.PROPOSITIONS:
        const propositions = await this.fetchPropositions();
        itemsProcessed = propositions.length;
        break;

      case CivicDataType.MEETINGS:
        const meetings = await this.fetchMeetings();
        itemsProcessed = meetings.length;
        break;

      case CivicDataType.REPRESENTATIVES:
        const representatives = await this.fetchRepresentatives();
        itemsProcessed = representatives.length;
        break;
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Synced ${dataType}: ${itemsProcessed} items in ${duration}ms`,
    );

    // Note: itemsCreated and itemsUpdated would be set by the microservice
    // after comparing with database records
    return {
      dataType,
      itemsProcessed,
      itemsCreated: 0,
      itemsUpdated: 0,
      errors: [],
      syncedAt: new Date(),
    };
  }

  /**
   * Get service information for health checks
   */
  getServiceInfo() {
    const regionInfo = this.getRegionInfo();
    return {
      provider: this.getProviderName(),
      region: regionInfo.name,
      supportedDataTypes: this.getSupportedDataTypes(),
      timezone: regionInfo.timezone,
    };
  }
}
