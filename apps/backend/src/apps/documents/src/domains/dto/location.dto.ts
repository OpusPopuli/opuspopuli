import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsUUID, IsNumber, IsOptional, Min, Max } from 'class-validator';

/**
 * Geographic coordinate types for location tracking
 *
 * Privacy-preserving implementation: coordinates are fuzzed to ~100m accuracy
 * before storage to protect user location privacy.
 * See issues #290, #296 for details.
 */

@ObjectType()
export class GeoLocation {
  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;
}

@InputType()
export class GeoLocationInput {
  @Field(() => Float)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Field(() => Float)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

@InputType()
export class SetDocumentLocationInput {
  @Field()
  @IsUUID()
  documentId!: string;

  @Field(() => GeoLocationInput)
  location!: GeoLocationInput;
}

@ObjectType()
export class SetDocumentLocationResult {
  @Field()
  success!: boolean;

  @Field(() => GeoLocation, { nullable: true })
  fuzzedLocation?: GeoLocation;
}

@ObjectType()
export class PetitionMapMarker {
  @Field()
  id!: string;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field({ nullable: true })
  documentType?: string;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class PetitionMapStats {
  @Field(() => Int)
  totalPetitions!: number;

  @Field(() => Int)
  totalWithLocation!: number;

  @Field(() => Int)
  recentPetitions!: number;
}

@InputType()
export class MapBoundsInput {
  @Field(() => Float)
  @IsNumber()
  @Min(-90)
  @Max(90)
  swLat!: number;

  @Field(() => Float)
  @IsNumber()
  @Min(-180)
  @Max(180)
  swLng!: number;

  @Field(() => Float)
  @IsNumber()
  @Min(-90)
  @Max(90)
  neLat!: number;

  @Field(() => Float)
  @IsNumber()
  @Min(-180)
  @Max(180)
  neLng!: number;
}

@InputType()
export class MapFiltersInput {
  @Field(() => MapBoundsInput, { nullable: true })
  @IsOptional()
  bounds?: MapBoundsInput;

  @Field({ nullable: true })
  @IsOptional()
  documentType?: string;

  @Field({ nullable: true })
  @IsOptional()
  startDate?: Date;

  @Field({ nullable: true })
  @IsOptional()
  endDate?: Date;
}

/**
 * Privacy-preserving location fuzzing
 *
 * Adds random offset to coordinates (approximately +/- 100 meters)
 * to prevent exact location tracking while still enabling
 * proximity-based features like "see where this petition is circulating".
 *
 * Based on: ~0.001 degrees ≈ 111 meters at equator
 * Uses uniform random offset within a circle for better privacy.
 *
 * @param latitude - Original latitude (-90 to 90)
 * @param longitude - Original longitude (-180 to 180)
 * @returns Fuzzed coordinates with ~100m accuracy
 */
export function fuzzLocation(latitude: number, longitude: number): GeoLocation {
  // Fuzzing radius in degrees (~100 meters at equator)
  const FUZZ_RADIUS_DEGREES = 0.001;

  // Generate random angle and distance within the radius
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * FUZZ_RADIUS_DEGREES;

  // Apply offset (cos/sin for uniform distribution in circle)
  const latOffset = distance * Math.cos(angle);
  const lonOffset = distance * Math.sin(angle);

  // Clamp to valid ranges
  const fuzzedLat = Math.max(-90, Math.min(90, latitude + latOffset));
  const fuzzedLon = Math.max(-180, Math.min(180, longitude + lonOffset));

  return {
    latitude: fuzzedLat,
    longitude: fuzzedLon,
  };
}

/**
 * Generates a PostGIS POINT geography value for SQL queries
 *
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns SQL fragment for inserting geography point
 */
export function toPostGISPoint(latitude: number, longitude: number): string {
  // PostGIS uses POINT(longitude latitude) format (note order!)
  return `ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
}
