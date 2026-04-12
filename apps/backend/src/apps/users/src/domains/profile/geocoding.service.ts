import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Geocoding result from Census Geocoder API
 */
export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  congressionalDistrict?: string;
  stateSenatorialDistrict?: string;
  stateAssemblyDistrict?: string;
  county?: string;
  municipality?: string;
  timezone?: string;
}

/**
 * Geocoding service using the US Census Geocoder API.
 *
 * Free, no API key required. Returns lat/lng + civic districts
 * (congressional, state senate, state assembly, county).
 */
const DEFAULT_GEOCODER_URL =
  'https://geocoding.geo.census.gov/geocoder/geographies/address';

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly baseUrl: string;

  constructor(@Optional() configService?: ConfigService) {
    this.baseUrl =
      configService?.get<string>('GEOCODER_URL') || DEFAULT_GEOCODER_URL;
  }

  /**
   * Geocode a US address and return coordinates + civic districts.
   * Returns null if the address cannot be geocoded.
   */
  async geocode(
    addressLine1: string,
    city: string,
    state: string,
    postalCode: string,
  ): Promise<GeocodingResult | null> {
    const params = new URLSearchParams({
      street: addressLine1,
      city,
      state,
      zip: postalCode,
      benchmark: 'Public_AR_Current',
      vintage: 'Current_Current',
      format: 'json',
    });

    const url = `${this.baseUrl}?${params}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.warn(
          `Census Geocoder returned ${response.status} for ${addressLine1}, ${city}, ${state}`,
        );
        return null;
      }

      const data = await response.json();
      const matches = data?.result?.addressMatches;

      if (!matches || matches.length === 0) {
        this.logger.debug(
          `No geocoding match for ${addressLine1}, ${city}, ${state}`,
        );
        return null;
      }

      const match = matches[0];
      const geographies = match.geographies || {};

      return {
        latitude: match.coordinates?.y,
        longitude: match.coordinates?.x,
        formattedAddress: match.matchedAddress || '',
        congressionalDistrict: this.extractGeography(
          geographies,
          '119th Congressional Districts',
          'NAME',
        ),
        stateSenatorialDistrict: this.extractGeography(
          geographies,
          '2024 State Legislative Districts - Upper',
          'NAME',
        ),
        stateAssemblyDistrict: this.extractGeography(
          geographies,
          '2024 State Legislative Districts - Lower',
          'NAME',
        ),
        county: this.extractGeography(geographies, 'Counties', 'NAME'),
        municipality: this.extractGeography(
          geographies,
          'Incorporated Places',
          'NAME',
        ),
        timezone: this.deriveTimezone(match.coordinates?.x),
      };
    } catch (error) {
      this.logger.warn(
        `Geocoding failed for ${addressLine1}, ${city}, ${state}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Extract a geography name from the Census response.
   */
  private extractGeography(
    geographies: Record<string, unknown[]>,
    key: string,
    field: string,
  ): string | undefined {
    const entries = geographies[key] as Record<string, string>[] | undefined;
    return entries?.[0]?.[field] || undefined;
  }

  /**
   * Derive timezone from longitude (simple US-only approximation).
   * For production, use a proper timezone lookup library.
   */
  private deriveTimezone(longitude?: number): string | undefined {
    if (longitude === undefined || longitude === null) return undefined;

    // US timezone boundaries (approximate, by longitude)
    if (longitude > -67.5) return 'America/New_York'; // Eastern + Atlantic
    if (longitude > -82.5) return 'America/New_York'; // Eastern
    if (longitude > -97.5) return 'America/Chicago'; // Central
    if (longitude > -112.5) return 'America/Denver'; // Mountain
    if (longitude > -127.5) return 'America/Los_Angeles'; // Pacific
    if (longitude > -145) return 'America/Anchorage'; // Alaska
    return 'Pacific/Honolulu'; // Hawaii
  }
}
