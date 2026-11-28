import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { JurisdictionTypeGQL } from '../../models/jurisdiction.model';
import { BEST_EFFORT_TOLERANCE } from '../shape-quality';

/**
 * Map shapes (#1475): ready-to-draw SVG path data the region sync built from
 * each layer's display geometry. A reader's district is never worked out
 * from these — that's the full boundaries, in PostGIS.
 */

@ObjectType({
  description: "Where a shape's lines come from: shown beside the map.",
})
export class ShapeSourceModel {
  @Field(() => String, { description: 'Layer or publisher name.' })
  name!: string;

  @Field(() => String)
  url!: string;

  @Field(() => Date, { description: 'When the shapes were built from it.' })
  retrievedAt!: Date;
}

@ObjectType({ description: 'One jurisdiction drawn in a frame.' })
export class MapShapeModel {
  @Field(() => ID)
  jurisdictionId!: string;

  @Field(() => String, { nullable: true })
  fipsCode?: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => JurisdictionTypeGQL)
  type!: JurisdictionTypeGQL;

  @Field(() => String, {
    description: "SVG path data in the frame's viewBox units: `<path d>`.",
  })
  path!: string;

  @Field(() => ShapeSourceModel)
  source!: ShapeSourceModel;
}

@ObjectType({
  description:
    "How well a county's district plan fits its outline, as shares of the county's area.",
})
export class ShapeFitModel {
  @Field(() => Float, { description: 'Land no district covers.' })
  gapShare!: number;

  @Field(() => Float, { description: 'Land two or more districts both claim.' })
  overlapShare!: number;

  @Field(() => Boolean, {
    description: `Either passes the tolerance (${BEST_EFFORT_TOLERANCE * 100}% of the county's area): draw the districts with a note that the map is a best effort.`,
  })
  bestEffort!: boolean;
}

@ObjectType({
  description: 'Every requested layer, drawn in one shared frame.',
})
export class RegionShapesModel {
  @Field(() => [Int], { description: '[minX, minY, width, height].' })
  viewBox!: number[];

  @Field(() => [MapShapeModel])
  shapes!: MapShapeModel[];
}

@ObjectType({
  description: "One county's own drawing: its outline and its districts.",
})
export class CountyShapesModel {
  @Field(() => String)
  fips!: string;

  @Field(() => [Int], { description: '[minX, minY, width, height].' })
  viewBox!: number[];

  @Field(() => MapShapeModel)
  outline!: MapShapeModel;

  @Field(() => [MapShapeModel], {
    description:
      'Districts inside the county, clipped to its outline. Empty when none are loaded.',
  })
  districts!: MapShapeModel[];

  @Field(() => ShapeFitModel, {
    nullable: true,
    description: 'Null when the county has no districts to fit.',
  })
  fit?: ShapeFitModel | null;
}
