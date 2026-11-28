import { Injectable } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type { JurisdictionTypeGQL } from '../models/jurisdiction.model';
import type {
  CountyShapesModel,
  MapShapeModel,
  RegionShapesModel,
} from './models/map-shape.model';
import { REGION_FRAME, countyFrameKey } from './shapes-builder.service';

const SHAPE_INCLUDE = {
  jurisdiction: {
    select: { id: true, name: true, type: true, fipsCode: true },
  },
} as const;

/** A stored shape with the jurisdiction it draws, as Prisma returns it. */
type ShapeRow = Prisma.JurisdictionShapeGetPayload<{
  include: typeof SHAPE_INCLUDE;
}>;

/**
 * Read side of the map shapes (#1475). Public geography only: built from
 * government boundaries, never joined to anything about a reader.
 */
@Injectable()
export class ShapesQueryService {
  constructor(private readonly db: DbService) {}

  /** The region frame's shapes of these types, or null before the first build. */
  async regionShapes(
    types: JurisdictionTypeGQL[],
  ): Promise<RegionShapesModel | null> {
    const frame = await this.db.shapeFrame.findUnique({
      where: { frameKey: REGION_FRAME },
      include: {
        shapes: {
          where: { jurisdiction: { type: { in: types } } },
          include: SHAPE_INCLUDE,
          orderBy: { jurisdictionId: 'asc' },
        },
      },
    });
    if (!frame) return null;
    return { viewBox: frame.viewBox, shapes: frame.shapes.map(toShape) };
  }

  /** One county's frame, or null when the county or its shapes don't exist. */
  async countyShapes(fips: string): Promise<CountyShapesModel | null> {
    const county = await this.db.jurisdiction.findFirst({
      where: { fipsCode: fips, type: 'COUNTY' },
      select: { id: true },
    });
    if (!county) return null;
    const frame = await this.db.shapeFrame.findUnique({
      where: { frameKey: countyFrameKey(county.id) },
      include: { shapes: { include: SHAPE_INCLUDE } },
    });
    const outline = frame?.shapes.find((s) => s.jurisdictionId === county.id);
    if (!frame || !outline) return null;

    const districts = frame.shapes
      .filter((s) => s.jurisdictionId !== county.id)
      .map(toShape)
      .sort((a, b) =>
        (a.fipsCode ?? a.name).localeCompare(b.fipsCode ?? b.name, undefined, {
          numeric: true,
        }),
      );
    return {
      fips,
      viewBox: frame.viewBox,
      outline: toShape(outline),
      districts,
      fit:
        frame.bestEffort === null ||
        frame.gapShare === null ||
        frame.overlapShare === null
          ? null
          : {
              gapShare: frame.gapShare,
              overlapShare: frame.overlapShare,
              bestEffort: frame.bestEffort,
            },
    };
  }
}

function toShape(row: ShapeRow): MapShapeModel {
  return {
    jurisdictionId: row.jurisdictionId,
    fipsCode: row.jurisdiction.fipsCode,
    name: row.jurisdiction.name,
    type: row.jurisdiction.type as JurisdictionTypeGQL,
    path: row.path,
    source: {
      name: row.sourceName,
      url: row.sourceUrl,
      retrievedAt: row.retrievedAt,
    },
  };
}
