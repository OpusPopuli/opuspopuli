import { Args, Query, Resolver } from '@nestjs/graphql';
import { Extensions } from '@nestjs/graphql';
import { Public } from 'src/common/decorators/public.decorator';
import { SkipAudit } from 'src/common/decorators/audit.decorator';
import { CountyShapesModel, RegionShapesModel } from './models/map-shape.model';
import { CountyShapesArgs, RegionShapesArgs } from './shapes.args';
import { ShapesQueryService } from './shapes-query.service';

/**
 * The map pages' shapes (#1475). Public: the map is how a visitor without an
 * account finds their county, and its geometry is government boundaries.
 */
@Resolver()
export class ShapesResolver {
  constructor(private readonly shapes: ShapesQueryService) {}

  @Public()
  @Query(() => RegionShapesModel, {
    nullable: true,
    description:
      'Layers of the active region drawn in one frame, as SVG paths. Null before the region sync first builds them.',
  })
  @Extensions({ complexity: 10 })
  regionShapes(
    @Args() { types }: RegionShapesArgs,
  ): Promise<RegionShapesModel | null> {
    return this.shapes.regionShapes(types);
  }

  /**
   * `@SkipAudit`: a reader whose location is known lands on their own county
   * (plan Q5), so the county asked for is often where they live. An audit row
   * would keep it beside their IP — the record #1456's privacy notice says
   * isn't kept, and the reason `jurisdictionsByIds` skips the audit too.
   * `regionShapes` takes only a layer type, so it stays audited.
   */
  @Public()
  @SkipAudit()
  @Query(() => CountyShapesModel, {
    nullable: true,
    description:
      "One county's outline and districts, as SVG paths, with how well the districts fit. Null for an unknown county.",
  })
  @Extensions({ complexity: 10 })
  countyShapes(
    @Args() { fips }: CountyShapesArgs,
  ): Promise<CountyShapesModel | null> {
    return this.shapes.countyShapes(fips);
  }
}
