import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CensusBoundaryService } from './census-boundary.service';

type Bbox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

type MapRouteLine = {
  feedVersionId: string;
  shapeId: string;
  routeId: string;
  routeType?: number | null;
  routeShortName?: string | null;
  routeLongName?: string | null;
  routeColor?: string | null;
  agencyId?: string | null;
  agencySlug?: string | null;
  agencyName?: string | null;
  points: [number, number][];
};

type MapRouteRef = {
  feedVersionId: string;
  routeId: string;
  routeType?: number | null;
  routeShortName?: string | null;
  routeLongName?: string | null;
  routeColor?: string | null;
  agencySlug?: string | null;
  agencyName?: string | null;
};

type AgencyRidership = {
  sourceTableId: string;
  agencyName: string;
  latestPassengerTripsThousands: number | null;
  latestPassengerTripsMonth: string | null;
  latestRevenueThousandsCad: number | null;
  latestRevenueMonth: string | null;
  series?: {
    passengerTripsThousands?: Array<{ month: string; value: number }>;
    revenueThousandsCad?: Array<{ month: string; value: number }>;
  };
};

type RouteServiceTimeBand = {
  key: string;
  label: string;
  startHour: number;
  endHour: number;
};

type DistanceSource = 'stop_times_shape_dist' | 'shape_dist' | 'shape_geometry' | 'stop_geometry' | 'unknown';

type TripStopTimeForStats = {
  tripId: string;
  stopId: string;
  stopSequence: number;
  arrivalTime: string | null;
  departureTime: string | null;
  shapeDistTraveled: number | null;
  stop: {
    stopLat: number | null;
    stopLon: number | null;
  };
};

type MapRouteLinesStageTimings = {
  activeFeedsMs: number;
  bboxStopsMs: number;
  bboxShapeKeysMs: number;
  routesMs: number;
  tripShapeStatsMs: number;
  shapePointsMs: number;
  simplifyMs: number;
  totalMs: number;
};

type MapRouteLinesCacheEntry = {
  key: string;
  expiresAt: number;
  createdAt: number;
  value: Record<string, unknown>;
};

type MapTransitHeatCell = {
  lat: number;
  lon: number;
  intensity: number;
  rawScore: number;
  cellLatSpan: number;
  cellLonSpan: number;
};

type MapTransitHeatCacheEntry = {
  key: string;
  expiresAt: number;
  createdAt: number;
  value: Record<string, unknown>;
};

const SECONDS_PER_DAY = 24 * 60 * 60;
const STATS_TIME_BANDS: RouteServiceTimeBand[] = [
  { key: 'early_am', label: 'Early AM (03:00-06:00)', startHour: 3, endHour: 6 },
  { key: 'am_peak', label: 'AM Peak (06:00-09:00)', startHour: 6, endHour: 9 },
  { key: 'midday', label: 'Midday (09:00-15:00)', startHour: 9, endHour: 15 },
  { key: 'pm_peak', label: 'PM Peak (15:00-19:00)', startHour: 15, endHour: 19 },
  { key: 'evening', label: 'Evening (19:00-24:00)', startHour: 19, endHour: 24 },
  { key: 'night', label: 'Night (00:00-03:00)', startHour: 0, endHour: 3 },
];

@Injectable()
export class GtfsService {
  private readonly logger = new Logger(GtfsService.name);
  private readonly mapRouteLinesCache = new Map<string, MapRouteLinesCacheEntry>();
  private readonly mapRouteLinesCacheTtlMs = 30_000;
  private readonly mapRouteLinesCacheMaxEntries = 120;
  private readonly mapTransitHeatCache = new Map<string, MapTransitHeatCacheEntry>();
  private readonly mapTransitHeatCacheTtlMs = 20_000;
  private readonly mapTransitHeatCacheMaxEntries = 140;

  constructor(
    private readonly prisma: PrismaService,
    private readonly censusBoundaryService: CensusBoundaryService,
  ) {}

  private extractAgencyRidership(raw: Prisma.JsonValue | null): AgencyRidership | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rawObject = raw as Record<string, unknown>;
    const ridership = rawObject.ridership;
    if (!ridership || typeof ridership !== 'object' || Array.isArray(ridership)) return null;
    return ridership as AgencyRidership;
  }

  async getAgencies(limit = 300) {
    const agencies = await this.prisma.agency.findMany({
      where: {
        status: 'EXISTING',
      },
      orderBy: [{ displayName: 'asc' }],
      take: Math.min(limit, 500),
      include: {
        feedVersions: {
          where: { isActive: true },
          orderBy: { importedAt: 'desc' },
          take: 1,
          select: { id: true, importedAt: true },
        },
      },
    });

    return agencies.map((agency) => ({
      id: agency.id,
      slug: agency.slug,
      displayName: agency.displayName,
      countryCode: agency.countryCode,
      subdivisionCode: agency.subdivisionCode,
      timezone: agency.timezone,
      website: agency.website,
      activeFeedVersionId: agency.feedVersions[0]?.id ?? null,
      activeFeedImportedAt: agency.feedVersions[0]?.importedAt ?? null,
      ridership: this.extractAgencyRidership(agency.raw),
    }));
  }

  private async resolveFeedVersionId(agencyId: string, feedVersionId?: string) {
    if (feedVersionId) return feedVersionId;
    const active = await this.prisma.gtfsFeedVersion.findFirst({
      where: {
        agencyId,
        isActive: true,
      },
      orderBy: { importedAt: 'desc' },
      select: { id: true },
    });
    return active?.id ?? null;
  }

  private parseBbox(bbox?: string): Bbox | null {
    if (!bbox) return null;
    const rawValues = bbox.split(',').map((value) => Number.parseFloat(value.trim()));
    if (rawValues.length !== 4 || rawValues.some((value) => !Number.isFinite(value))) return null;
    const minLat = rawValues[0] as number;
    const minLon = rawValues[1] as number;
    const maxLat = rawValues[2] as number;
    const maxLon = rawValues[3] as number;
    if (minLat > maxLat || minLon > maxLon) return null;
    return { minLat, minLon, maxLat, maxLon };
  }

  private quantizeForCache(value: number, step: number) {
    return Math.round(value / step) * step;
  }

  private bboxQuantizationStepForZoom(zoom: number) {
    if (zoom <= 6) return 0.75;
    if (zoom <= 8) return 0.4;
    if (zoom <= 11) return 0.15;
    if (zoom <= 14) return 0.05;
    return 0.015;
  }

  private quantizedBboxKey(bbox: Bbox, zoom: number) {
    const step = this.bboxQuantizationStepForZoom(zoom);
    return [
      this.quantizeForCache(bbox.minLat, step).toFixed(4),
      this.quantizeForCache(bbox.minLon, step).toFixed(4),
      this.quantizeForCache(bbox.maxLat, step).toFixed(4),
      this.quantizeForCache(bbox.maxLon, step).toFixed(4),
    ].join(',');
  }

  private activeFeedFingerprint(rows: Array<{ id: string; importedAt: Date }>) {
    return rows
      .map((row) => `${row.id}:${row.importedAt.getTime()}`)
      .sort()
      .join('|');
  }

  private buildMapRouteLinesCacheKey(params: { bbox: Bbox; zoom: number; routeLimit: number; shapeLimit: number; activeFeeds: string }) {
    return [
      `bbox=${this.quantizedBboxKey(params.bbox, params.zoom)}`,
      `zoom=${params.zoom}`,
      `routeLimit=${params.routeLimit}`,
      `shapeLimit=${params.shapeLimit}`,
      `feeds=${params.activeFeeds}`,
    ].join(';');
  }

  private readMapRouteLinesCache(key: string) {
    const now = Date.now();
    const hit = this.mapRouteLinesCache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.mapRouteLinesCache.delete(key);
      return null;
    }
    return hit.value;
  }

  private writeMapRouteLinesCache(key: string, value: Record<string, unknown>) {
    const now = Date.now();
    this.mapRouteLinesCache.set(key, {
      key,
      createdAt: now,
      expiresAt: now + this.mapRouteLinesCacheTtlMs,
      value,
    });
    this.pruneMapRouteLinesCache(now);
  }

  private pruneMapRouteLinesCache(now = Date.now()) {
    for (const [key, entry] of this.mapRouteLinesCache.entries()) {
      if (entry.expiresAt <= now) {
        this.mapRouteLinesCache.delete(key);
      }
    }
    if (this.mapRouteLinesCache.size <= this.mapRouteLinesCacheMaxEntries) return;
    const sorted = [...this.mapRouteLinesCache.values()].sort((a, b) => a.createdAt - b.createdAt);
    const excess = this.mapRouteLinesCache.size - this.mapRouteLinesCacheMaxEntries;
    for (const entry of sorted.slice(0, excess)) {
      this.mapRouteLinesCache.delete(entry.key);
    }
  }

  private heatGridSizeForZoom(zoom: number) {
    if (zoom <= 7) return 32;
    if (zoom <= 10) return 44;
    if (zoom <= 13) return 56;
    return 68;
  }

  private buildMapTransitHeatCacheKey(params: {
    bbox: Bbox;
    zoom: number;
    gridSize: number;
    routeLimit: number;
    shapeLimit: number;
    stopLimit: number;
    serviceAware: boolean;
    activeFeeds: string;
  }) {
    return [
      `bbox=${this.quantizedBboxKey(params.bbox, params.zoom)}`,
      `zoom=${params.zoom}`,
      `grid=${params.gridSize}`,
      `routeLimit=${params.routeLimit}`,
      `shapeLimit=${params.shapeLimit}`,
      `stopLimit=${params.stopLimit}`,
      `serviceAware=${params.serviceAware}`,
      `feeds=${params.activeFeeds}`,
    ].join(';');
  }

  private readMapTransitHeatCache(key: string) {
    const now = Date.now();
    const hit = this.mapTransitHeatCache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.mapTransitHeatCache.delete(key);
      return null;
    }
    return hit.value;
  }

  private writeMapTransitHeatCache(key: string, value: Record<string, unknown>) {
    const now = Date.now();
    this.mapTransitHeatCache.set(key, {
      key,
      createdAt: now,
      expiresAt: now + this.mapTransitHeatCacheTtlMs,
      value,
    });
    this.pruneMapTransitHeatCache(now);
  }

  private pruneMapTransitHeatCache(now = Date.now()) {
    for (const [key, entry] of this.mapTransitHeatCache.entries()) {
      if (entry.expiresAt <= now) {
        this.mapTransitHeatCache.delete(key);
      }
    }
    if (this.mapTransitHeatCache.size <= this.mapTransitHeatCacheMaxEntries) return;
    const sorted = [...this.mapTransitHeatCache.values()].sort((a, b) => a.createdAt - b.createdAt);
    const excess = this.mapTransitHeatCache.size - this.mapTransitHeatCacheMaxEntries;
    for (const entry of sorted.slice(0, excess)) {
      this.mapTransitHeatCache.delete(entry.key);
    }
  }

  async getLatestTransitHeatVersion() {
    const latest = await this.prisma.transitHeatTile.findFirst({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }],
      select: { versionKey: true },
    });
    if (!latest) {
      return {
        versionKey: null,
        tileCount: 0,
        minZoom: null,
        maxZoom: null,
      };
    }
    const stats = await this.prisma.transitHeatTile.aggregate({
      where: { isActive: true, versionKey: latest.versionKey },
      _count: { _all: true },
      _min: { z: true },
      _max: { z: true },
    });
    return {
      versionKey: latest.versionKey,
      tileCount: stats._count._all,
      minZoom: stats._min.z ?? null,
      maxZoom: stats._max.z ?? null,
    };
  }

  async getTransitHeatHealth() {
    const latest = await this.prisma.transitHeatTile.findFirst({
      where: { isActive: true },
      orderBy: [{ createdAt: 'desc' }],
      select: { versionKey: true },
    });
    if (!latest) {
      return {
        versionKey: null,
        tileCount: 0,
        minZoom: null,
        maxZoom: null,
        generatedAt: null,
        tilesByZoom: [],
      };
    }
    const [aggregate, tilesByZoom] = await Promise.all([
      this.prisma.transitHeatTile.aggregate({
        where: { isActive: true, versionKey: latest.versionKey },
        _count: { _all: true },
        _min: { z: true },
        _max: { z: true, createdAt: true },
      }),
      this.prisma.transitHeatTile.groupBy({
        by: ['z'],
        where: { isActive: true, versionKey: latest.versionKey },
        _count: { _all: true },
        orderBy: [{ z: 'asc' }],
      }),
    ]);
    return {
      versionKey: latest.versionKey,
      tileCount: aggregate._count._all,
      minZoom: aggregate._min.z ?? null,
      maxZoom: aggregate._max.z ?? null,
      generatedAt: aggregate._max.createdAt ?? null,
      tilesByZoom: tilesByZoom.map((row) => ({
        zoom: row.z,
        tiles: row._count._all,
      })),
    };
  }

  async getTransitHeatTile(params: {
    z: number;
    x: number;
    y: number;
    versionKey?: string;
  }) {
    const resolvedVersion =
      params.versionKey && params.versionKey.trim().length > 0
        ? params.versionKey.trim()
        : (
            await this.prisma.transitHeatTile.findFirst({
              where: { isActive: true },
              orderBy: [{ createdAt: 'desc' }],
              select: { versionKey: true },
            })
          )?.versionKey;
    if (!resolvedVersion) return null;
    const exact = await this.prisma.transitHeatTile.findFirst({
      where: {
        isActive: true,
        versionKey: resolvedVersion,
        z: params.z,
        x: params.x,
        y: params.y,
      },
      select: {
        tileData: true,
        gridSize: true,
      },
    });
    if (exact) {
      return {
        tileData: this.normalizeTransitHeatBytes(exact.tileData),
        gridSize: exact.gridSize,
      };
    }

    // Fallback: if an exact tile isn't available (e.g. deeper zoom than precomputed),
    // project the nearest parent tile into the requested child tile footprint.
    for (let depth = 1; depth <= params.z; depth += 1) {
      const scale = 1 << depth;
      const parentZ = params.z - depth;
      const parentX = Math.floor(params.x / scale);
      const parentY = Math.floor(params.y / scale);
      const parent = await this.prisma.transitHeatTile.findFirst({
        where: {
          isActive: true,
          versionKey: resolvedVersion,
          z: parentZ,
          x: parentX,
          y: parentY,
        },
        select: {
          tileData: true,
          gridSize: true,
        },
      });
      if (!parent) continue;
      const childTileX = params.x - parentX * scale;
      const childTileY = params.y - parentY * scale;
      const projected = this.projectTransitHeatTileToChild({
        tileData: new Uint8Array(this.normalizeTransitHeatBytes(parent.tileData)),
        gridSize: parent.gridSize,
        depth,
        childTileX,
        childTileY,
      });
      return {
        tileData: Buffer.from(projected),
        gridSize: parent.gridSize,
      };
    }

    return null;
  }

  private normalizeTransitHeatBytes(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('\\x')) {
        return Buffer.from(trimmed.slice(2), 'hex');
      }
      return Buffer.from(trimmed, 'binary');
    }
    return Buffer.alloc(0);
  }

  private projectTransitHeatTileToChild(params: {
    tileData: Uint8Array;
    gridSize: number;
    depth: number;
    childTileX: number;
    childTileY: number;
  }) {
    const { tileData, gridSize, depth, childTileX, childTileY } = params;
    const scale = 1 << depth;
    const output = new Uint8Array(gridSize * gridSize);
    const childOffsetX = childTileX * gridSize;
    const childOffsetY = childTileY * gridSize;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const parentCol = Math.max(0, Math.min(gridSize - 1, Math.floor((childOffsetX + col) / scale)));
        const parentRow = Math.max(0, Math.min(gridSize - 1, Math.floor((childOffsetY + row) / scale)));
        const sourceIndex = parentRow * gridSize + parentCol;
        const targetIndex = row * gridSize + col;
        output[targetIndex] = tileData[sourceIndex] ?? 0;
      }
    }
    return output;
  }

  private routeTypeHeatWeight(routeType?: number | null) {
    if (routeType === 1 || routeType === 2) return 1.2;
    if (routeType === 0) return 0.86;
    if (routeType === 4) return 0.68;
    if (routeType === 3) return 0.42;
    return 0.5;
  }

  private addHeatKernel(params: {
    grid: Float32Array;
    gridSize: number;
    x: number;
    y: number;
    amount: number;
    radius: number;
  }) {
    const { grid, gridSize, x, y, amount, radius } = params;
    const radiusSquared = radius * radius;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= gridSize) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= gridSize) continue;
        const distSquared = dx * dx + dy * dy;
        if (distSquared > radiusSquared) continue;
        const falloff = Math.exp(-distSquared / (Math.max(radiusSquared, 1) * 0.9));
        const index = yy * gridSize + xx;
        const existing = grid[index];
        if (existing === undefined) continue;
        grid[index] = existing + amount * falloff;
      }
    }
  }

  private latLonToCell(bbox: Bbox, gridSize: number, lat: number, lon: number) {
    const latSpan = Math.max(1e-9, bbox.maxLat - bbox.minLat);
    const lonSpan = Math.max(1e-9, bbox.maxLon - bbox.minLon);
    if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLon || lon > bbox.maxLon) return null;
    const xRatio = (lon - bbox.minLon) / lonSpan;
    const yRatio = (lat - bbox.minLat) / latSpan;
    const x = Math.max(0, Math.min(gridSize - 1, Math.floor(xRatio * gridSize)));
    // Invert rows so larger latitudes are at smaller row indices.
    const y = Math.max(0, Math.min(gridSize - 1, gridSize - 1 - Math.floor(yRatio * gridSize)));
    return { x, y };
  }

  async getRoutes(params: {
    agencyId: string;
    feedVersionId?: string;
    routeType?: number;
    limit?: number;
  }) {
    const resolvedFeedVersionId = await this.resolveFeedVersionId(params.agencyId, params.feedVersionId);
    if (!resolvedFeedVersionId) return [];
    return this.prisma.gtfsRoute.findMany({
      where: {
        feedVersionId: resolvedFeedVersionId,
        ...(params.routeType === undefined ? {} : { routeType: params.routeType }),
      },
      orderBy: [{ routeType: 'asc' }, { routeShortName: 'asc' }, { routeLongName: 'asc' }],
      take: Math.min(params.limit ?? 1000, 5000),
    });
  }

  async getStops(params: {
    agencyId: string;
    feedVersionId?: string;
    bbox?: string;
    limit?: number;
  }) {
    const resolvedFeedVersionId = await this.resolveFeedVersionId(params.agencyId, params.feedVersionId);
    if (!resolvedFeedVersionId) return [];
    const bbox = this.parseBbox(params.bbox);
    const latFilter = bbox
      ? {
          gte: bbox.minLat,
          lte: bbox.maxLat,
        }
      : undefined;
    const lonFilter = bbox
      ? {
          gte: bbox.minLon,
          lte: bbox.maxLon,
        }
      : undefined;

    return this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: resolvedFeedVersionId,
        ...(bbox
          ? {
              stopLat: latFilter,
              stopLon: lonFilter,
            }
          : {}),
      },
      orderBy: [{ stopName: 'asc' }],
      take: Math.min(params.limit ?? 2000, 10000),
    });
  }

  async getTrips(params: {
    agencyId: string;
    feedVersionId?: string;
    routeId?: string;
    serviceId?: string;
    limit?: number;
  }) {
    const resolvedFeedVersionId = await this.resolveFeedVersionId(params.agencyId, params.feedVersionId);
    if (!resolvedFeedVersionId) return [];
    return this.prisma.gtfsTrip.findMany({
      where: {
        feedVersionId: resolvedFeedVersionId,
        ...(params.routeId ? { routeId: params.routeId } : {}),
        ...(params.serviceId ? { serviceId: params.serviceId } : {}),
      },
      orderBy: [{ routeId: 'asc' }, { directionId: 'asc' }, { tripId: 'asc' }],
      take: Math.min(params.limit ?? 2000, 10000),
    });
  }

  async getStopTimes(params: {
    agencyId: string;
    feedVersionId?: string;
    tripId: string;
    limit?: number;
  }) {
    const resolvedFeedVersionId = await this.resolveFeedVersionId(params.agencyId, params.feedVersionId);
    if (!resolvedFeedVersionId) return [];
    return this.prisma.gtfsStopTime.findMany({
      where: {
        feedVersionId: resolvedFeedVersionId,
        tripId: params.tripId,
      },
      orderBy: [{ stopSequence: 'asc' }],
      take: Math.min(params.limit ?? 5000, 15000),
    });
  }

  async getShapes(params: {
    agencyId: string;
    feedVersionId?: string;
    routeId?: string;
    bbox?: string;
    limit?: number;
  }) {
    const resolvedFeedVersionId = await this.resolveFeedVersionId(params.agencyId, params.feedVersionId);
    if (!resolvedFeedVersionId) return [];
    const shapeFilter: Prisma.GtfsShapePointWhereInput = { feedVersionId: resolvedFeedVersionId };
    const bbox = this.parseBbox(params.bbox);
    if (bbox) {
      shapeFilter.shapePtLat = { gte: bbox.minLat, lte: bbox.maxLat };
      shapeFilter.shapePtLon = { gte: bbox.minLon, lte: bbox.maxLon };
    }

    if (params.routeId) {
      const trips = await this.prisma.gtfsTrip.findMany({
        where: {
          feedVersionId: resolvedFeedVersionId,
          routeId: params.routeId,
          shapeId: { not: null },
        },
        distinct: ['shapeId'],
        select: { shapeId: true },
      });
      const shapeIds = trips.map((trip) => trip.shapeId).filter((value): value is string => Boolean(value));
      if (shapeIds.length === 0) return [];
      shapeFilter.shapeId = { in: shapeIds };
    }

    return this.prisma.gtfsShapePoint.findMany({
      where: shapeFilter,
      orderBy: [{ shapeId: 'asc' }, { shapePtSequence: 'asc' }],
      take: Math.min(params.limit ?? 10_000, 50_000),
    });
  }

  async getTableRows(params: {
    agencyId: string;
    tableName: string;
    feedVersionId?: string;
    limit?: number;
    offset?: number;
  }) {
    const resolvedFeedVersionId = await this.resolveFeedVersionId(params.agencyId, params.feedVersionId);
    if (!resolvedFeedVersionId) return [];
    const tableName = params.tableName.trim().toLowerCase();
    const take = Math.min(Math.max(params.limit ?? 200, 1), 5000);
    const skip = Math.max(params.offset ?? 0, 0);

    switch (tableName) {
      case 'fare_attributes':
        return this.prisma.gtfsFareAttribute.findMany({
          where: { feedVersionId: resolvedFeedVersionId },
          orderBy: [{ fareId: 'asc' }],
          take,
          skip,
        });
      case 'fare_rules':
        return this.prisma.gtfsFareRule.findMany({
          where: { feedVersionId: resolvedFeedVersionId },
          orderBy: [{ fareId: 'asc' }],
          take,
          skip,
        });
      case 'frequencies':
        return this.prisma.gtfsFrequency.findMany({
          where: { feedVersionId: resolvedFeedVersionId },
          orderBy: [{ tripId: 'asc' }],
          take,
          skip,
        });
      case 'transfers':
        return this.prisma.gtfsTransfer.findMany({
          where: { feedVersionId: resolvedFeedVersionId },
          orderBy: [{ fromStopId: 'asc' }, { toStopId: 'asc' }],
          take,
          skip,
        });
      case 'levels':
        return this.prisma.gtfsLevel.findMany({
          where: { feedVersionId: resolvedFeedVersionId },
          orderBy: [{ levelId: 'asc' }],
          take,
          skip,
        });
      case 'pathways':
        return this.prisma.gtfsPathway.findMany({
          where: { feedVersionId: resolvedFeedVersionId },
          orderBy: [{ pathwayId: 'asc' }],
          take,
          skip,
        });
      default:
        return this.prisma.gtfsRawTableRow.findMany({
          where: {
            feedVersionId: resolvedFeedVersionId,
            tableName,
          },
          orderBy: [{ rowIndex: 'asc' }],
          take,
          skip,
        });
    }
  }

  async getMapDiscovery(params: {
    bbox: string;
    zoom?: number;
    routeLimit?: number;
    stopLimit?: number;
  }) {
    const bbox = this.parseBbox(params.bbox);
    if (!bbox) {
      return {
        bbox: params.bbox,
        zoom: params.zoom ?? null,
        agencies: [],
        routes: [],
        stops: [],
        counts: { agencies: 0, routes: 0, stops: 0 },
      };
    }

    const zoom = params.zoom ?? 11;
    const activeFeedVersions = await this.prisma.gtfsFeedVersion.findMany({
      where: { isActive: true },
      select: {
        id: true,
        agency: {
          select: {
            id: true,
            slug: true,
            displayName: true,
          },
        },
      },
    });
    if (activeFeedVersions.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        agencies: [],
        routes: [],
        stops: [],
        counts: { agencies: 0, routes: 0, stops: 0 },
      };
    }

    const feedVersionById = new Map(activeFeedVersions.map((row) => [row.id, row]));
    const activeFeedVersionIds = activeFeedVersions.map((row) => row.id);

    const sampleStops = await this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: { in: activeFeedVersionIds },
        stopLat: { gte: bbox.minLat, lte: bbox.maxLat },
        stopLon: { gte: bbox.minLon, lte: bbox.maxLon },
      },
      select: {
        feedVersionId: true,
      },
      take: 5000,
    });

    const feedVersionsInView = [...new Set(sampleStops.map((row) => row.feedVersionId))];
    if (feedVersionsInView.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        agencies: [],
        routes: [],
        stops: [],
        counts: { agencies: 0, routes: 0, stops: 0 },
      };
    }

    const agencyMap = new Map<string, { id: string; slug: string; displayName: string }>();
    for (const feedVersionId of feedVersionsInView) {
      const feed = feedVersionById.get(feedVersionId);
      if (!feed) continue;
      agencyMap.set(feed.agency.id, {
        id: feed.agency.id,
        slug: feed.agency.slug,
        displayName: feed.agency.displayName,
      });
    }

    const routeTypes = this.routeTypesForZoom(zoom);
    const routeWhere: Prisma.GtfsRouteWhereInput = {
      feedVersionId: { in: feedVersionsInView },
      ...(routeTypes.length > 0 ? { routeType: { in: routeTypes } } : {}),
    };
    const routes = await this.prisma.gtfsRoute.findMany({
      where: routeWhere,
      orderBy: [{ routeType: 'asc' }, { routeShortName: 'asc' }, { routeLongName: 'asc' }],
      take: Math.min(params.routeLimit ?? 4000, 10000),
    });

    const shouldRestrictStopsByRouteType = !this.includesAllPrimaryRouteTypes(routeTypes);
    const defaultStopLimit =
      zoom <= 7 ? 250 : zoom <= 10 ? 900 : zoom <= 12 ? 2200 : zoom <= 14 ? 5000 : 10_000;
    const stops = await this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: { in: feedVersionsInView },
        stopLat: { gte: bbox.minLat, lte: bbox.maxLat },
        stopLon: { gte: bbox.minLon, lte: bbox.maxLon },
        ...(shouldRestrictStopsByRouteType
          ? {
              stopTimes: {
                some: {
                  trip: {
                    route: {
                      routeType: { in: routeTypes },
                    },
                  },
                },
              },
            }
          : {}),
      },
      orderBy: [{ stopName: 'asc' }],
      take: Math.min(params.stopLimit ?? defaultStopLimit, 15_000),
    });

    return {
      bbox: params.bbox,
      zoom,
      agencies: [...agencyMap.values()],
      routes,
      stops,
      counts: {
        agencies: agencyMap.size,
        routes: routes.length,
        stops: stops.length,
      },
    };
  }

  async getMapStops(params: {
    bbox: string;
    zoom?: number;
    stopLimit?: number;
  }) {
    const bbox = this.parseBbox(params.bbox);
    if (!bbox) {
      return {
        bbox: params.bbox,
        zoom: params.zoom ?? null,
        stops: [],
        count: 0,
      };
    }

    const zoom = params.zoom ?? 11;
    const activeFeedVersions = await this.prisma.gtfsFeedVersion.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (activeFeedVersions.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        stops: [],
        count: 0,
      };
    }

    const activeFeedVersionIds = activeFeedVersions.map((row) => row.id);
    const sampleStops = await this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: { in: activeFeedVersionIds },
        stopLat: { gte: bbox.minLat, lte: bbox.maxLat },
        stopLon: { gte: bbox.minLon, lte: bbox.maxLon },
      },
      select: {
        feedVersionId: true,
      },
      take: 5000,
    });

    const feedVersionsInView = [...new Set(sampleStops.map((row) => row.feedVersionId))];
    if (feedVersionsInView.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        stops: [],
        count: 0,
      };
    }

    const routeTypes = this.routeTypesForZoom(zoom);
    const shouldRestrictStopsByRouteType = !this.includesAllPrimaryRouteTypes(routeTypes);
    const defaultStopLimit =
      zoom <= 7 ? 250 : zoom <= 10 ? 900 : zoom <= 12 ? 2200 : zoom <= 14 ? 5000 : 10_000;
    type MapStopRow = {
      feedVersionId: string;
      stopId: string;
      stopName: string | null;
      stopLat: number;
      stopLon: number;
      wheelchairBoarding: number | null;
      feedVersion: {
        agency: {
          id: string;
          slug: string;
          displayName: string;
        };
      };
    };
    const candidateStops = (await this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: { in: feedVersionsInView },
        stopLat: { gte: bbox.minLat, lte: bbox.maxLat },
        stopLon: { gte: bbox.minLon, lte: bbox.maxLon },
      },
      orderBy: [{ stopName: 'asc' }],
      take: Math.min(params.stopLimit ?? defaultStopLimit, 15_000),
      select: {
        feedVersionId: true,
        stopId: true,
        stopName: true,
        stopLat: true,
        stopLon: true,
        wheelchairBoarding: true,
        feedVersion: {
          select: {
            agency: {
              select: {
                id: true,
                slug: true,
                displayName: true,
              },
            },
          },
        },
      },
    })) as MapStopRow[];

    if (!shouldRestrictStopsByRouteType || candidateStops.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        stops: candidateStops.map((stop: MapStopRow) => ({
          feedVersionId: stop.feedVersionId,
          stopId: stop.stopId,
          stopName: stop.stopName,
          stopLat: stop.stopLat,
          stopLon: stop.stopLon,
          wheelchairBoarding: stop.wheelchairBoarding,
          agencyId: stop.feedVersion.agency.id,
          agencySlug: stop.feedVersion.agency.slug,
          agencyName: stop.feedVersion.agency.displayName,
        })),
        count: candidateStops.length,
      };
    }

    const distinctStopIds = [...new Set(candidateStops.map((stop: MapStopRow) => stop.stopId))];
    type StopKey = { feedVersionId: string; stopId: string };
    const matchedStopKeys = (await this.prisma.gtfsStopTime.findMany({
      where: {
        feedVersionId: { in: feedVersionsInView },
        stopId: { in: distinctStopIds },
        trip: {
          route: {
            routeType: { in: routeTypes },
          },
        },
      },
      distinct: ['feedVersionId', 'stopId'],
      select: {
        feedVersionId: true,
        stopId: true,
      },
      take: 80_000,
    })) as StopKey[];

    const matchedStopKeySet = new Set(matchedStopKeys.map((row: StopKey) => `${row.feedVersionId}::${row.stopId}`));
    const stops = candidateStops
      .filter((stop: MapStopRow) => matchedStopKeySet.has(`${stop.feedVersionId}::${stop.stopId}`))
      .map((stop: MapStopRow) => ({
        feedVersionId: stop.feedVersionId,
        stopId: stop.stopId,
        stopName: stop.stopName,
        stopLat: stop.stopLat,
        stopLon: stop.stopLon,
        wheelchairBoarding: stop.wheelchairBoarding,
        agencyId: stop.feedVersion.agency.id,
        agencySlug: stop.feedVersion.agency.slug,
        agencyName: stop.feedVersion.agency.displayName,
      }));

    return {
      bbox: params.bbox,
      zoom,
      stops,
      count: stops.length,
    };
  }

  async getMapTransitHeat(params: {
    bbox: string;
    zoom?: number;
    gridSize?: number;
    routeLimit?: number;
    shapeLimit?: number;
    stopLimit?: number;
    serviceAware?: boolean;
  }) {
    const zoom = params.zoom ?? 11;
    const bbox = this.parseBbox(params.bbox);
    if (!bbox) {
      return {
        bbox: params.bbox,
        zoom,
        gridSize: params.gridSize ?? this.heatGridSizeForZoom(zoom),
        cells: [],
        count: 0,
        maxScore: 0,
      };
    }

    const activeFeedVersions = await this.prisma.gtfsFeedVersion.findMany({
      where: { isActive: true },
      select: { id: true, importedAt: true },
    });
    if (activeFeedVersions.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        gridSize: params.gridSize ?? this.heatGridSizeForZoom(zoom),
        cells: [],
        count: 0,
        maxScore: 0,
      };
    }

    const routeLimit = Math.min(params.routeLimit ?? 1200, 5000);
    const shapeLimit = Math.min(params.shapeLimit ?? 500, 2500);
    const stopLimit = Math.min(params.stopLimit ?? 3000, 15_000);
    const serviceAware = params.serviceAware === true;
    const gridSize = Math.max(24, Math.min(params.gridSize ?? this.heatGridSizeForZoom(zoom), 96));
    const activeFeeds = this.activeFeedFingerprint(activeFeedVersions);
    const cacheKey = this.buildMapTransitHeatCacheKey({
      bbox,
      zoom,
      gridSize,
      routeLimit,
      shapeLimit,
      stopLimit,
      serviceAware,
      activeFeeds,
    });
    const cached = this.readMapTransitHeatCache(cacheKey);
    if (cached) return cached;

    const routePayload = (await this.getMapRouteLines({
      bbox: params.bbox,
      zoom,
      routeLimit,
      shapeLimit,
    })) as {
      lines?: MapRouteLine[];
      counts?: { routes?: number; lines?: number };
    };
    const stopPayload = (await this.getMapStops({
      bbox: params.bbox,
      zoom,
      stopLimit,
    })) as {
      stops?: Array<{ stopLat: number; stopLon: number }>;
      count?: number;
    };
    const lines = routePayload.lines ?? [];

    const routeServiceBoostByKey = new Map<string, number>();
    if (serviceAware && lines.length > 0) {
      const routePairs = [...new Set(lines.map((line) => `${line.feedVersionId}::${line.routeId}`))].map((routeKey) => {
        const [feedVersionId, routeId] = routeKey.split('::');
        return { feedVersionId: feedVersionId as string, routeId: routeId as string };
      });
      if (routePairs.length > 0) {
        const tripCounts = await this.prisma.gtfsTrip.groupBy({
          by: ['feedVersionId', 'routeId'],
          where: { OR: routePairs },
          orderBy: [{ feedVersionId: 'asc' }, { routeId: 'asc' }],
          _count: { _all: true },
          take: 120_000,
        });
        let maxTripCount = 0;
        for (const row of tripCounts) {
          const count = row._count?._all ?? 0;
          if (count > maxTripCount) maxTripCount = count;
        }
        if (maxTripCount > 0) {
          for (const row of tripCounts) {
            const count = row._count?._all ?? 0;
            const normalized = Math.max(0, Math.min(1, count / maxTripCount));
            const boost = 1 + 0.65 * Math.pow(normalized, 0.62);
            routeServiceBoostByKey.set(`${row.feedVersionId}::${row.routeId}`, boost);
          }
        }
      }
    }

    const grid = new Float32Array(gridSize * gridSize);
    for (const line of lines) {
      if (!line.points || line.points.length < 2) continue;
      const routeKey = `${line.feedVersionId}::${line.routeId}`;
      const serviceBoost = routeServiceBoostByKey.get(routeKey) ?? 1;
      const routeWeight = this.routeTypeHeatWeight(line.routeType) * serviceBoost;
      for (let index = 1; index < line.points.length; index += 1) {
        const previous = line.points[index - 1];
        const current = line.points[index];
        if (!previous || !current) continue;
        const latDelta = Math.abs(current[0] - previous[0]);
        const lonDelta = Math.abs(current[1] - previous[1]);
        const steps = Math.max(1, Math.ceil(Math.max(latDelta, lonDelta) * gridSize * 1.9));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const sampleLat = previous[0] + (current[0] - previous[0]) * t;
          const sampleLon = previous[1] + (current[1] - previous[1]) * t;
          const cell = this.latLonToCell(bbox, gridSize, sampleLat, sampleLon);
          if (!cell) continue;
          this.addHeatKernel({
            grid,
            gridSize,
            x: cell.x,
            y: cell.y,
            amount: routeWeight * 0.26,
            radius: routeWeight >= 1 ? 2 : 1,
          });
        }
      }
    }

    const stops = stopPayload.stops ?? [];
    for (const stop of stops) {
      const cell = this.latLonToCell(bbox, gridSize, stop.stopLat, stop.stopLon);
      if (!cell) continue;
      this.addHeatKernel({
        grid,
        gridSize,
        x: cell.x,
        y: cell.y,
        amount: 0.3,
        radius: 1,
      });
    }

    let maxScore = 0;
    for (const score of grid) {
      if (score > maxScore) maxScore = score;
    }

    const latSpan = bbox.maxLat - bbox.minLat;
    const lonSpan = bbox.maxLon - bbox.minLon;
    const cellLatSpan = latSpan / gridSize;
    const cellLonSpan = lonSpan / gridSize;
    const cells: MapTransitHeatCell[] = [];
    if (maxScore > 0) {
      const minVisibleScore = maxScore * 0.07;
      for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
          const rawScore = grid[row * gridSize + col] ?? 0;
          if (rawScore < minVisibleScore) continue;
          const normalized = rawScore / maxScore;
          // Gamma curve keeps medium-intensity corridors visible on dark basemaps.
          const intensity = Math.pow(normalized, 0.74);
          const centerLat = bbox.maxLat - (row + 0.5) * cellLatSpan;
          const centerLon = bbox.minLon + (col + 0.5) * cellLonSpan;
          cells.push({
            lat: centerLat,
            lon: centerLon,
            intensity,
            rawScore,
            cellLatSpan,
            cellLonSpan,
          });
        }
      }
    }

    const payload: Record<string, unknown> = {
      bbox: params.bbox,
      zoom,
      gridSize,
      serviceAware,
      maxScore: Number(maxScore.toFixed(6)),
      cells,
      count: cells.length,
      sourceCounts: {
        routes: routePayload.counts?.routes ?? 0,
        lines: routePayload.counts?.lines ?? lines.length,
        stops: stopPayload.count ?? stops.length,
      },
    };
    this.writeMapTransitHeatCache(cacheKey, payload);
    return payload;
  }

  async getMapRouteDetails(params: { feedVersionId: string; routeId: string }) {
    const route = await this.prisma.gtfsRoute.findUnique({
      where: {
        feedVersionId_routeId: {
          feedVersionId: params.feedVersionId,
          routeId: params.routeId,
        },
      },
      select: {
        feedVersionId: true,
        routeId: true,
        routeType: true,
        routeShortName: true,
        routeLongName: true,
        routeDesc: true,
        routeUrl: true,
        routeColor: true,
        routeTextColor: true,
        agencyId: true,
        feedVersion: {
          select: {
            agency: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                countryCode: true,
                subdivisionCode: true,
                timezone: true,
                raw: true,
              },
            },
          },
        },
      },
    });
    if (!route) return null;

    type RouteTripRow = {
      tripId: string;
      tripHeadsign: string | null;
      tripShortName: string | null;
      directionId: number | null;
    };
    const trips = (await this.prisma.gtfsTrip.findMany({
      where: {
        feedVersionId: params.feedVersionId,
        routeId: params.routeId,
      },
      select: {
        tripId: true,
        tripHeadsign: true,
        tripShortName: true,
        directionId: true,
      },
      take: 5000,
    })) as RouteTripRow[];

    const representativeTrip = await this.prisma.gtfsTrip.findFirst({
      where: {
        feedVersionId: params.feedVersionId,
        routeId: params.routeId,
      },
      orderBy: [{ directionId: 'asc' }, { tripId: 'asc' }],
      select: {
        tripId: true,
        directionId: true,
        tripHeadsign: true,
      },
    });
    type PathStopTimeRow = {
      stopSequence: number;
      stopId: string;
      stop: {
        stopName: string | null;
        platformCode: string | null;
        wheelchairBoarding: number | null;
        stopLat: number | null;
        stopLon: number | null;
      };
    };
    const routePathStopTimes: PathStopTimeRow[] = representativeTrip
      ? await this.prisma.gtfsStopTime.findMany({
          where: {
            feedVersionId: params.feedVersionId,
            tripId: representativeTrip.tripId,
          },
          orderBy: [{ stopSequence: 'asc' }],
          select: {
            stopSequence: true,
            stopId: true,
            stop: {
              select: {
                stopName: true,
                platformCode: true,
                wheelchairBoarding: true,
                stopLat: true,
                stopLon: true,
              },
            },
          },
          take: 500,
        })
      : [];

    const tripIds = trips.map((trip) => trip.tripId);
    const routeStopRows =
      tripIds.length > 0
        ? await this.prisma.gtfsStopTime.findMany({
            where: {
              feedVersionId: params.feedVersionId,
              tripId: { in: tripIds },
            },
            select: {
              stopId: true,
            },
            distinct: ['stopId'],
            take: 12_000,
          })
        : [];

    const distinctDirectionIds = [
      ...new Set(trips.map((trip) => trip.directionId).filter((value): value is number => value !== null)),
    ].sort((a, b) => a - b);
    const uniqueHeadsigns = [...new Set(trips.map((trip) => trip.tripHeadsign).filter((value): value is string => Boolean(value)))];
    const sampleTripNames = [
      ...new Set(
        trips
          .map((trip) => trip.tripShortName || trip.tripHeadsign || trip.tripId)
          .filter((value): value is string => Boolean(value)),
      ),
    ].slice(0, 8);

    return {
      feedVersionId: route.feedVersionId,
      routeId: route.routeId,
      routeType: route.routeType,
      routeShortName: route.routeShortName,
      routeLongName: route.routeLongName,
      routeDesc: route.routeDesc,
      routeUrl: route.routeUrl,
      routeColor: route.routeColor,
      routeTextColor: route.routeTextColor,
      agencyId: route.agencyId,
      agency: {
        ...route.feedVersion.agency,
        ridership: this.extractAgencyRidership(route.feedVersion.agency.raw),
      },
      counts: {
        trips: trips.length,
        distinctStops: routeStopRows.length,
        directions: distinctDirectionIds.length,
      },
      directionIds: distinctDirectionIds,
      headsigns: uniqueHeadsigns.slice(0, 10),
      sampleTrips: sampleTripNames,
      censusContext: null,
      routePath: representativeTrip
        ? {
            tripId: representativeTrip.tripId,
            directionId: representativeTrip.directionId,
            headsign: representativeTrip.tripHeadsign,
            stops: routePathStopTimes.map((stopTime) => ({
              stopSequence: stopTime.stopSequence,
              stopId: stopTime.stopId,
              stopName: stopTime.stop.stopName,
              platformCode: stopTime.stop.platformCode,
              wheelchairBoarding: stopTime.stop.wheelchairBoarding,
            })),
          }
        : null,
    };
  }

  async getMapRouteServiceStats(params: { feedVersionId: string; routeId: string; serviceDate?: string }) {
    const route = await this.prisma.gtfsRoute.findUnique({
      where: {
        feedVersionId_routeId: {
          feedVersionId: params.feedVersionId,
          routeId: params.routeId,
        },
      },
      select: {
        feedVersionId: true,
        routeId: true,
      },
    });
    if (!route) return null;

    const serviceDate = this.normalizeServiceDate(params.serviceDate);
    const serviceProfile = await this.resolveActiveServiceProfile(route.feedVersionId, serviceDate);
    const notes: string[] = [...serviceProfile.notes];

    const tripWhere: Prisma.GtfsTripWhereInput = {
      feedVersionId: route.feedVersionId,
      routeId: route.routeId,
      ...(serviceProfile.activeServiceIds ? { serviceId: { in: [...serviceProfile.activeServiceIds] } } : {}),
    };

    const trips = await this.prisma.gtfsTrip.findMany({
      where: tripWhere,
      select: {
        tripId: true,
        directionId: true,
        shapeId: true,
      },
      take: 12_000,
    });
    const tripIds = trips.map((trip) => trip.tripId);
    if (tripIds.length === 0) {
      return {
        feedVersionId: route.feedVersionId,
        routeId: route.routeId,
        serviceDate,
        scheduledTrips: 0,
        headwaysByTimeBand: STATS_TIME_BANDS.map((band) => ({
          ...band,
          tripDepartures: 0,
          avgHeadwayMinutes: null,
          tripsPerHour: 0,
        })),
        spanOfService: {
          firstDeparture: null,
          lastDeparture: null,
          firstDepartureSeconds: null,
          lastDepartureSeconds: null,
          spanHours: 0,
        },
        stopCoverage: {
          distinctStops: 0,
          routeCoverageKm: 0,
          stopsPerKm: null,
          avgStopSpacingMeters: null,
        },
        supply: {
          serviceHoursApprox: 0,
          serviceKmApprox: 0,
          vrhApprox: 0,
          vrkApprox: 0,
        },
        methodology: {
          calendarApplied: serviceProfile.calendarApplied,
          frequencyFallbackUsed: false,
          distanceSources: {
            stop_times_shape_dist: 0,
            shape_dist: 0,
            shape_geometry: 0,
            stop_geometry: 0,
            unknown: 0,
          },
          notes,
        },
      };
    }

    const stopTimes = await this.prisma.gtfsStopTime.findMany({
      where: {
        feedVersionId: route.feedVersionId,
        tripId: { in: tripIds },
      },
      orderBy: [{ tripId: 'asc' }, { stopSequence: 'asc' }],
      select: {
        tripId: true,
        stopId: true,
        stopSequence: true,
        arrivalTime: true,
        departureTime: true,
        shapeDistTraveled: true,
        stop: {
          select: {
            stopLat: true,
            stopLon: true,
          },
        },
      },
      take: 250_000,
    });

    const frequencies = await this.prisma.gtfsFrequency.findMany({
      where: {
        feedVersionId: route.feedVersionId,
        tripId: { in: tripIds },
      },
      select: {
        tripId: true,
        startTime: true,
        endTime: true,
        headwaySecs: true,
      },
      take: 30_000,
    });

    const shapeIds = [...new Set(trips.map((trip) => trip.shapeId).filter((value): value is string => Boolean(value)))];
    const shapePoints =
      shapeIds.length > 0
        ? await this.prisma.gtfsShapePoint.findMany({
            where: {
              feedVersionId: route.feedVersionId,
              shapeId: { in: shapeIds },
            },
            orderBy: [{ shapeId: 'asc' }, { shapePtSequence: 'asc' }],
            select: {
              shapeId: true,
              shapePtLat: true,
              shapePtLon: true,
              shapeDistTraveled: true,
            },
            take: 350_000,
          })
        : [];

    const stopTimesByTripId = new Map<string, TripStopTimeForStats[]>();
    for (const stopTime of stopTimes as TripStopTimeForStats[]) {
      const list = stopTimesByTripId.get(stopTime.tripId) ?? [];
      list.push(stopTime);
      stopTimesByTripId.set(stopTime.tripId, list);
    }

    const frequenciesByTripId = new Map<string, Array<{ startTime: string | null; endTime: string | null; headwaySecs: number | null }>>();
    for (const row of frequencies) {
      const list = frequenciesByTripId.get(row.tripId) ?? [];
      list.push({
        startTime: row.startTime,
        endTime: row.endTime,
        headwaySecs: row.headwaySecs,
      });
      frequenciesByTripId.set(row.tripId, list);
    }

    const shapePointsByShapeId = new Map<string, Array<{ lat: number; lon: number; shapeDistTraveled: number | null }>>();
    for (const row of shapePoints) {
      const list = shapePointsByShapeId.get(row.shapeId) ?? [];
      list.push({
        lat: row.shapePtLat,
        lon: row.shapePtLon,
        shapeDistTraveled: row.shapeDistTraveled,
      });
      shapePointsByShapeId.set(row.shapeId, list);
    }

    const departures: number[] = [];
    const arrivals: number[] = [];
    const distanceSources = {
      stop_times_shape_dist: 0,
      shape_dist: 0,
      shape_geometry: 0,
      stop_geometry: 0,
      unknown: 0,
    };
    const distanceSamplesKm: number[] = [];
    const distinctStopIds = new Set<string>();
    let totalRuntimeSeconds = 0;
    let totalDistanceKm = 0;

    for (const trip of trips) {
      const tripStopTimes = stopTimesByTripId.get(trip.tripId) ?? [];
      if (tripStopTimes.length === 0) continue;
      for (const stopTime of tripStopTimes) {
        distinctStopIds.add(stopTime.stopId);
      }

      const firstStop = tripStopTimes[0];
      const lastStop = tripStopTimes[tripStopTimes.length - 1];
      if (!firstStop || !lastStop) continue;
      const departureSeconds = this.parseGtfsTimeToSeconds(firstStop.departureTime ?? firstStop.arrivalTime);
      const arrivalSeconds = this.parseGtfsTimeToSeconds(lastStop.arrivalTime ?? lastStop.departureTime);

      if (departureSeconds !== null) departures.push(departureSeconds);
      if (arrivalSeconds !== null) arrivals.push(arrivalSeconds);
      if (departureSeconds !== null && arrivalSeconds !== null && arrivalSeconds >= departureSeconds) {
        totalRuntimeSeconds += arrivalSeconds - departureSeconds;
      }

      const distanceEstimate = this.estimateTripDistanceKm(tripStopTimes, trip.shapeId, shapePointsByShapeId);
      distanceSources[distanceEstimate.source] += 1;
      if (distanceEstimate.km !== null && distanceEstimate.km > 0) {
        totalDistanceKm += distanceEstimate.km;
        distanceSamplesKm.push(distanceEstimate.km);
      }
    }

    const firstDepartureSeconds = departures.length > 0 ? Math.min(...departures) : null;
    const latestSeenSeconds = [...departures, ...arrivals];
    const lastDepartureSeconds = latestSeenSeconds.length > 0 ? Math.max(...latestSeenSeconds) : null;
    const spanHours =
      firstDepartureSeconds !== null && lastDepartureSeconds !== null && lastDepartureSeconds >= firstDepartureSeconds
        ? (lastDepartureSeconds - firstDepartureSeconds) / 3600
        : 0;

    const routeCoverageKm = distanceSamplesKm.length > 0 ? Math.max(...distanceSamplesKm) : 0;
    const stopsPerKm = routeCoverageKm > 0 ? distinctStopIds.size / routeCoverageKm : null;
    const avgStopSpacingMeters =
      routeCoverageKm > 0 && distinctStopIds.size > 1 ? (routeCoverageKm * 1000) / (distinctStopIds.size - 1) : null;

    const headwayBreakdown = this.buildHeadwayBreakdown({
      departures,
      frequenciesByTripId,
      includeTripIds: new Set(tripIds),
    });

    if (headwayBreakdown.some((band) => band.fallbackCount > 0)) {
      notes.push('Frequency-based headways were used as fallback where explicit departures were sparse.');
    }

    return {
      feedVersionId: route.feedVersionId,
      routeId: route.routeId,
      serviceDate,
      scheduledTrips: trips.length,
      headwaysByTimeBand: headwayBreakdown.map((band) => ({
        key: band.key,
        label: band.label,
        startHour: band.startHour,
        endHour: band.endHour,
        tripDepartures: band.tripDepartures,
        avgHeadwayMinutes: band.avgHeadwayMinutes,
        tripsPerHour: band.tripsPerHour,
      })),
      spanOfService: {
        firstDeparture: this.formatGtfsSeconds(firstDepartureSeconds),
        lastDeparture: this.formatGtfsSeconds(lastDepartureSeconds),
        firstDepartureSeconds,
        lastDepartureSeconds,
        spanHours: this.roundTo(spanHours, 2),
      },
      stopCoverage: {
        distinctStops: distinctStopIds.size,
        routeCoverageKm: this.roundTo(routeCoverageKm, 2),
        stopsPerKm: stopsPerKm === null ? null : this.roundTo(stopsPerKm, 2),
        avgStopSpacingMeters: avgStopSpacingMeters === null ? null : Math.round(avgStopSpacingMeters),
      },
      supply: {
        serviceHoursApprox: this.roundTo(totalRuntimeSeconds / 3600, 2),
        serviceKmApprox: this.roundTo(totalDistanceKm, 2),
        vrhApprox: this.roundTo(totalRuntimeSeconds / 3600, 2),
        vrkApprox: this.roundTo(totalDistanceKm, 2),
      },
      methodology: {
        calendarApplied: serviceProfile.calendarApplied,
        frequencyFallbackUsed: headwayBreakdown.some((band) => band.fallbackCount > 0),
        distanceSources,
        notes,
      },
    };
  }

  async getMapStopDetails(params: { feedVersionId: string; stopId: string }) {
    const stop = await this.prisma.gtfsStop.findUnique({
      where: {
        feedVersionId_stopId: {
          feedVersionId: params.feedVersionId,
          stopId: params.stopId,
        },
      },
      select: {
        feedVersionId: true,
        stopId: true,
        stopCode: true,
        stopName: true,
        stopDesc: true,
        stopLat: true,
        stopLon: true,
        zoneId: true,
        stopUrl: true,
        locationType: true,
        parentStation: true,
        wheelchairBoarding: true,
        platformCode: true,
        feedVersion: {
          select: {
            agency: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                countryCode: true,
                subdivisionCode: true,
                timezone: true,
                raw: true,
              },
            },
          },
        },
      },
    });
    if (!stop) return null;

    const stopTimes = await this.prisma.gtfsStopTime.findMany({
      where: {
        feedVersionId: params.feedVersionId,
        stopId: params.stopId,
      },
      select: {
        tripId: true,
      },
      distinct: ['tripId'],
      take: 12_000,
    });
    const tripIds = stopTimes.map((row) => row.tripId);

    type ServingTripRow = {
      tripId: string;
      tripHeadsign: string | null;
      route: {
        routeId: string;
        routeType: number;
        routeShortName: string | null;
        routeLongName: string | null;
        routeColor: string | null;
      };
    };
    const servingTrips: ServingTripRow[] =
      tripIds.length > 0
        ? await this.prisma.gtfsTrip.findMany({
            where: {
              feedVersionId: params.feedVersionId,
              tripId: { in: tripIds },
            },
            select: {
              tripId: true,
              tripHeadsign: true,
              route: {
                select: {
                  routeId: true,
                  routeType: true,
                  routeShortName: true,
                  routeLongName: true,
                  routeColor: true,
                },
              },
            },
            take: 12_000,
          })
        : [];

    const routesById = new Map<string, ServingTripRow['route']>();
    const headsigns: string[] = [];
    for (const trip of servingTrips) {
      routesById.set(trip.route.routeId, trip.route);
      if (trip.tripHeadsign) headsigns.push(trip.tripHeadsign);
    }

    const routeTripCounts = new Map<string, number>();
    for (const trip of servingTrips) {
      const routeId = trip.route.routeId;
      routeTripCounts.set(routeId, (routeTripCounts.get(routeId) ?? 0) + 1);
    }
    const sortedRouteIds = [...routeTripCounts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map((entry) => entry[0]);
    const primaryRouteId = sortedRouteIds[0] ?? null;
    const primaryTrip = primaryRouteId
      ? [...servingTrips]
          .filter((trip) => trip.route.routeId === primaryRouteId)
          .sort((a, b) => a.tripId.localeCompare(b.tripId))[0]
      : undefined;
    const primaryRoutePathStopTimes: Array<{
      stopSequence: number;
      stopId: string;
      stop: {
        stopName: string | null;
        platformCode: string | null;
        wheelchairBoarding: number | null;
      };
    }> = primaryTrip
      ? await this.prisma.gtfsStopTime.findMany({
          where: {
            feedVersionId: params.feedVersionId,
            tripId: primaryTrip.tripId,
          },
          orderBy: [{ stopSequence: 'asc' }],
          select: {
            stopSequence: true,
            stopId: true,
            stop: {
              select: {
                stopName: true,
                platformCode: true,
                wheelchairBoarding: true,
              },
            },
          },
          take: 500,
        })
      : [];
    const currentStopSequence = primaryRoutePathStopTimes.find((row) => row.stopId === params.stopId)?.stopSequence ?? null;
    const censusContext = await this.censusBoundaryService.lookupByLatLon(stop.stopLat, stop.stopLon);

    return {
      feedVersionId: stop.feedVersionId,
      stopId: stop.stopId,
      stopCode: stop.stopCode,
      stopName: stop.stopName,
      stopDesc: stop.stopDesc,
      stopLat: stop.stopLat,
      stopLon: stop.stopLon,
      zoneId: stop.zoneId,
      stopUrl: stop.stopUrl,
      locationType: stop.locationType,
      parentStation: stop.parentStation,
      wheelchairBoarding: stop.wheelchairBoarding,
      platformCode: stop.platformCode,
      agency: {
        ...stop.feedVersion.agency,
        ridership: this.extractAgencyRidership(stop.feedVersion.agency.raw),
      },
      censusContext,
      counts: {
        trips: tripIds.length,
        routes: routesById.size,
      },
      routes: [...routesById.values()].sort((a, b) =>
        `${a.routeShortName ?? ''} ${a.routeLongName ?? ''}`.localeCompare(`${b.routeShortName ?? ''} ${b.routeLongName ?? ''}`),
      ),
      headsigns: [...new Set(headsigns)].slice(0, 10),
      primaryRoutePath:
        primaryTrip && primaryRouteId
          ? {
              route: routesById.get(primaryRouteId) ?? null,
              tripId: primaryTrip.tripId,
              headsign: primaryTrip.tripHeadsign,
              currentStopId: params.stopId,
              currentStopSequence,
              stops: primaryRoutePathStopTimes.map((stopTime) => ({
                stopSequence: stopTime.stopSequence,
                stopId: stopTime.stopId,
                stopName: stopTime.stop.stopName,
                platformCode: stopTime.stop.platformCode,
                wheelchairBoarding: stopTime.stop.wheelchairBoarding,
              })),
            }
          : null,
    };
  }

  private normalizeServiceDate(value?: string) {
    if (value && /^\d{8}$/.test(value)) return value;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private weekdayCalendarField(date: Date): keyof Prisma.GtfsCalendarWhereInput {
    const day = date.getDay();
    if (day === 0) return 'sunday';
    if (day === 1) return 'monday';
    if (day === 2) return 'tuesday';
    if (day === 3) return 'wednesday';
    if (day === 4) return 'thursday';
    if (day === 5) return 'friday';
    return 'saturday';
  }

  private parseServiceDate(value: string) {
    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(4, 6), 10);
    const day = Number.parseInt(value.slice(6, 8), 10);
    return new Date(year, month - 1, day);
  }

  private async resolveActiveServiceProfile(feedVersionId: string, serviceDate: string) {
    const date = this.parseServiceDate(serviceDate);
    const weekdayField = this.weekdayCalendarField(date);

    const calendarRows = await this.prisma.gtfsCalendar.findMany({
      where: {
        feedVersionId,
        startDate: { lte: serviceDate },
        endDate: { gte: serviceDate },
      },
      select: {
        serviceId: true,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true,
      },
      take: 20_000,
    });

    const calendarDates = await this.prisma.gtfsCalendarDate.findMany({
      where: {
        feedVersionId,
        date: serviceDate,
      },
      select: {
        serviceId: true,
        exceptionType: true,
      },
      take: 20_000,
    });

    const active = new Set<string>();
    for (const row of calendarRows) {
      const runs = row[weekdayField as keyof typeof row];
      if (runs === true) {
        active.add(row.serviceId);
      }
    }
    for (const exception of calendarDates) {
      if (exception.exceptionType === 1) active.add(exception.serviceId);
      if (exception.exceptionType === 2) active.delete(exception.serviceId);
    }

    const notes: string[] = [];
    const hasCalendarSignal = calendarRows.length > 0 || calendarDates.length > 0;
    if (!hasCalendarSignal) {
      notes.push('No calendar records found for this feed/date; metrics include all trips on the route.');
      return {
        activeServiceIds: null as Set<string> | null,
        calendarApplied: false,
        notes,
      };
    }
    if (active.size === 0) {
      notes.push('No active service IDs on this date after calendar rules and exceptions.');
    }
    return {
      activeServiceIds: active,
      calendarApplied: true,
      notes,
    };
  }

  private parseGtfsTimeToSeconds(value?: string | null) {
    if (!value) return null;
    const parsed = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!parsed) return null;
    const hours = Number.parseInt(parsed[1] ?? '', 10);
    const minutes = Number.parseInt(parsed[2] ?? '', 10);
    const seconds = Number.parseInt(parsed[3] ?? '0', 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59 || hours < 0) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  private formatGtfsSeconds(value: number | null) {
    if (value === null) return null;
    const wholeSeconds = Math.max(0, Math.floor(value));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private roundTo(value: number, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  private bandForSeconds(seconds: number): RouteServiceTimeBand {
    const normalized = ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    const hour = Math.floor(normalized / 3600);
    const matched = STATS_TIME_BANDS.find((band) =>
      band.startHour <= band.endHour
        ? hour >= band.startHour && hour < band.endHour
        : hour >= band.startHour || hour < band.endHour,
    );
    return matched ?? STATS_TIME_BANDS[0]!;
  }

  private bandDurationHours(band: RouteServiceTimeBand) {
    return band.startHour <= band.endHour ? band.endHour - band.startHour : 24 - band.startHour + band.endHour;
  }

  private average(values: number[]) {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private toDistanceKm(rawDistance: number) {
    if (!Number.isFinite(rawDistance) || rawDistance <= 0) return null;
    if (rawDistance > 250) return rawDistance / 1000;
    return rawDistance;
  }

  private haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const earthRadiusKm = 6371;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  private estimateTripDistanceKm(
    tripStopTimes: TripStopTimeForStats[],
    shapeId: string | null,
    shapePointsByShapeId: Map<string, Array<{ lat: number; lon: number; shapeDistTraveled: number | null }>>,
  ): { km: number | null; source: DistanceSource } {
    const shapeDistValues = tripStopTimes
      .map((row) => row.shapeDistTraveled)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b);
    if (shapeDistValues.length >= 2) {
      const firstValue = shapeDistValues[0];
      const lastValue = shapeDistValues[shapeDistValues.length - 1];
      if (firstValue !== undefined && lastValue !== undefined) {
        const candidate = this.toDistanceKm(lastValue - firstValue);
        if (candidate !== null && candidate > 0) {
          return { km: candidate, source: 'stop_times_shape_dist' };
        }
      }
    }

    if (shapeId) {
      const shapePoints = shapePointsByShapeId.get(shapeId) ?? [];
      const shapeDistanceValues = shapePoints
        .map((row) => row.shapeDistTraveled)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        .sort((a, b) => a - b);
      if (shapeDistanceValues.length >= 2) {
        const firstValue = shapeDistanceValues[0];
        const lastValue = shapeDistanceValues[shapeDistanceValues.length - 1];
        if (firstValue !== undefined && lastValue !== undefined) {
          const candidate = this.toDistanceKm(lastValue - firstValue);
          if (candidate !== null && candidate > 0) {
            return { km: candidate, source: 'shape_dist' };
          }
        }
      }

      if (shapePoints.length >= 2) {
        let distanceKm = 0;
        for (let index = 1; index < shapePoints.length; index += 1) {
          const prev = shapePoints[index - 1];
          const next = shapePoints[index];
          if (!prev || !next) continue;
          distanceKm += this.haversineDistanceKm(prev.lat, prev.lon, next.lat, next.lon);
        }
        if (distanceKm > 0) {
          return { km: distanceKm, source: 'shape_geometry' };
        }
      }
    }

    const stopPoints = tripStopTimes
      .map((row) =>
        row.stop.stopLat !== null && row.stop.stopLon !== null ? { lat: row.stop.stopLat, lon: row.stop.stopLon } : null,
      )
      .filter((value): value is { lat: number; lon: number } => value !== null);
    if (stopPoints.length >= 2) {
      let distanceKm = 0;
      for (let index = 1; index < stopPoints.length; index += 1) {
        const prev = stopPoints[index - 1];
        const next = stopPoints[index];
        if (!prev || !next) continue;
        distanceKm += this.haversineDistanceKm(prev.lat, prev.lon, next.lat, next.lon);
      }
      if (distanceKm > 0) {
        return { km: distanceKm, source: 'stop_geometry' };
      }
    }

    return { km: null, source: 'unknown' };
  }

  private buildHeadwayBreakdown(params: {
    departures: number[];
    frequenciesByTripId: Map<string, Array<{ startTime: string | null; endTime: string | null; headwaySecs: number | null }>>;
    includeTripIds: Set<string>;
  }) {
    const departuresByBand = new Map<string, number[]>();
    for (const band of STATS_TIME_BANDS) {
      departuresByBand.set(band.key, []);
    }
    for (const departureSeconds of params.departures) {
      const band = this.bandForSeconds(departureSeconds);
      departuresByBand.get(band.key)?.push(departureSeconds);
    }

    const fallbackHeadwaysByBand = new Map<string, number[]>();
    for (const band of STATS_TIME_BANDS) {
      fallbackHeadwaysByBand.set(band.key, []);
    }
    for (const [tripId, rows] of params.frequenciesByTripId.entries()) {
      if (!params.includeTripIds.has(tripId)) continue;
      for (const row of rows) {
        if (!row.headwaySecs || row.headwaySecs <= 0) continue;
        const startSeconds = this.parseGtfsTimeToSeconds(row.startTime);
        const endSeconds = this.parseGtfsTimeToSeconds(row.endTime);
        if (startSeconds === null || endSeconds === null) continue;
        for (const band of STATS_TIME_BANDS) {
          const overlapSeconds = this.overlapSecondsWithinServiceDay(startSeconds, endSeconds, band.startHour * 3600, band.endHour * 3600);
          if (overlapSeconds > 0) {
            fallbackHeadwaysByBand.get(band.key)?.push(row.headwaySecs / 60);
          }
        }
      }
    }

    return STATS_TIME_BANDS.map((band) => {
      const departures = [...(departuresByBand.get(band.key) ?? [])].sort((a, b) => a - b);
      const scheduledHeadways: number[] = [];
      for (let index = 1; index < departures.length; index += 1) {
        const currentDeparture = departures[index];
        const previousDeparture = departures[index - 1];
        if (currentDeparture === undefined || previousDeparture === undefined) continue;
        const headwayMinutes = (currentDeparture - previousDeparture) / 60;
        if (headwayMinutes > 0) scheduledHeadways.push(headwayMinutes);
      }
      const fallbackHeadways = fallbackHeadwaysByBand.get(band.key) ?? [];
      const combined = [...scheduledHeadways, ...fallbackHeadways];
      const avgHeadway = this.average(combined);
      const durationHours = this.bandDurationHours(band);
      const tripsPerHour = avgHeadway && avgHeadway > 0 ? 60 / avgHeadway : departures.length / Math.max(durationHours, 1);
      return {
        key: band.key,
        label: band.label,
        startHour: band.startHour,
        endHour: band.endHour,
        tripDepartures: departures.length,
        avgHeadwayMinutes: avgHeadway === null ? null : this.roundTo(avgHeadway, 1),
        tripsPerHour: this.roundTo(tripsPerHour, 2),
        fallbackCount: fallbackHeadways.length,
      };
    });
  }

  private overlapSecondsWithinServiceDay(start: number, end: number, bandStart: number, bandEnd: number) {
    const normalizeWindow = (windowStart: number, windowEnd: number): Array<[number, number]> => {
      const normalizedStart = ((windowStart % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
      const normalizedEndRaw = ((windowEnd % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
      return normalizedEndRaw > normalizedStart
        ? ([[normalizedStart, normalizedEndRaw]] as Array<[number, number]>)
        : [
            [normalizedStart, SECONDS_PER_DAY],
            [0, normalizedEndRaw],
          ];
    };
    const left = normalizeWindow(start, end);
    const right = normalizeWindow(bandStart, bandEnd);
    let overlap = 0;
    for (const [leftStart, leftEnd] of left) {
      for (const [rightStart, rightEnd] of right) {
        const startPoint = Math.max(leftStart, rightStart);
        const endPoint = Math.min(leftEnd, rightEnd);
        if (endPoint > startPoint) overlap += endPoint - startPoint;
      }
    }
    return overlap;
  }

  private routeTypesForZoom(zoom: number) {
    const routeTypes = new Set<number>([1, 2]);
    if (zoom >= 10) {
      routeTypes.add(0);
      routeTypes.add(4);
    }
    if (zoom >= 13) {
      routeTypes.add(3);
    }
    return [...routeTypes];
  }

  private includesAllPrimaryRouteTypes(routeTypes: number[]) {
    return [0, 1, 2, 3, 4].every((routeType) => routeTypes.includes(routeType));
  }

  private routeTypePriority(routeType?: number | null, zoom?: number) {
    if (routeType === 2) return 0;
    if (routeType === 1) return 1;
    if (routeType === 0) return 2;
    if (routeType === 3) return zoom !== undefined && zoom >= 13 ? 3 : 6;
    if (routeType === 4) return 4;
    return 5;
  }

  private maxShapesPerRouteForType(zoom: number, routeType?: number | null) {
    if (routeType === 1 || routeType === 2) {
      return zoom <= 9 ? 3 : 4;
    }
    if (routeType === 3) {
      // Keep bus shape fan-out conservative so local routes aren't crowded out
      // by a few routes consuming the global shape budget at higher zoom.
      return zoom >= 16 ? 2 : 1;
    }
    return zoom <= 10 ? 1 : 2;
  }

  private renderModeForZoom(zoom: number) {
    if (zoom <= 11) return 'corridor';
    if (zoom <= 14) return 'mixed';
    return 'detailed';
  }

  private quantizeCoord(value: number, decimals = 4) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  private corridorLineKey(points: [number, number][]) {
    const serialized = points.map(([lat, lon]) => `${this.quantizeCoord(lat)}:${this.quantizeCoord(lon)}`).join('|');
    const reversed = [...points]
      .reverse()
      .map(([lat, lon]) => `${this.quantizeCoord(lat)}:${this.quantizeCoord(lon)}`)
      .join('|');
    return serialized <= reversed ? serialized : reversed;
  }

  private buildCorridorsFromLines(lines: MapRouteLine[]) {
    const byCorridor = new Map<
      string,
      {
        points: [number, number][];
        routeRefs: Map<string, MapRouteRef>;
        routeTypes: Set<number>;
      }
    >();

    for (const line of lines) {
      if (!line.points || line.points.length < 2) continue;
      const corridorKey = this.corridorLineKey(line.points);
      const existing = byCorridor.get(corridorKey) ?? {
        points: line.points,
        routeRefs: new Map<string, MapRouteRef>(),
        routeTypes: new Set<number>(),
      };
      const routeKey = `${line.feedVersionId}::${line.routeId}`;
      existing.routeRefs.set(routeKey, {
        feedVersionId: line.feedVersionId,
        routeId: line.routeId,
        routeType: line.routeType,
        routeShortName: line.routeShortName,
        routeLongName: line.routeLongName,
        routeColor: line.routeColor,
        agencySlug: line.agencySlug,
        agencyName: line.agencyName,
      });
      if (typeof line.routeType === 'number') {
        existing.routeTypes.add(line.routeType);
      }
      byCorridor.set(corridorKey, existing);
    }

    const corridors = [...byCorridor.entries()].map(([corridorId, entry]) => {
      const routeRefs = [...entry.routeRefs.values()].sort((a, b) => {
        const byType = this.routeTypePriority(a.routeType) - this.routeTypePriority(b.routeType);
        if (byType !== 0) return byType;
        const byFeed = a.feedVersionId.localeCompare(b.feedVersionId);
        if (byFeed !== 0) return byFeed;
        return `${a.routeShortName ?? ''} ${a.routeLongName ?? ''}`.localeCompare(
          `${b.routeShortName ?? ''} ${b.routeLongName ?? ''}`,
        );
      });
      return {
        corridorId,
        points: entry.points,
        routeRefs,
        routeCount: routeRefs.length,
        routeTypes: [...entry.routeTypes].sort((a, b) => a - b),
      };
    });

    corridors.sort((a, b) => {
      if (b.routeCount !== a.routeCount) return b.routeCount - a.routeCount;
      if (b.points.length !== a.points.length) return b.points.length - a.points.length;
      return a.corridorId.localeCompare(b.corridorId);
    });
    return corridors;
  }

  private simplifyConfigForZoom(zoom: number) {
    // Continuous zoom curve to avoid abrupt geometry changes between adjacent zooms.
    const clampedZoom = Math.max(5, Math.min(16, zoom));
    const zoomDelta = 16 - clampedZoom;
    const epsilon = 0.00008 * Math.pow(1.55, zoomDelta);
    const detailRatio = (clampedZoom - 5) / 11;
    const maxPoints = Math.round(180 + detailRatio * 5820);
    return { epsilon, maxPoints };
  }

  private perpendicularDistance(point: [number, number], start: [number, number], end: [number, number]) {
    const [x, y] = point;
    const [x1, y1] = start;
    const [x2, y2] = end;
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
      const px = x - x1;
      const py = y - y1;
      return Math.sqrt(px * px + py * py);
    }
    const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const distX = x - projX;
    const distY = y - projY;
    return Math.sqrt(distX * distX + distY * distY);
  }

  private rdpSimplify(points: [number, number][], epsilon: number): [number, number][] {
    if (points.length <= 2) return points;
    let maxDist = 0;
    let splitIndex = -1;
    const first = points[0] as [number, number];
    const last = points[points.length - 1] as [number, number];
    for (let index = 1; index < points.length - 1; index += 1) {
      const dist = this.perpendicularDistance(points[index] as [number, number], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        splitIndex = index;
      }
    }
    if (splitIndex === -1 || maxDist <= epsilon) {
      return [first, last];
    }
    const left = this.rdpSimplify(points.slice(0, splitIndex + 1), epsilon);
    const right = this.rdpSimplify(points.slice(splitIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  private capPolylinePoints(points: [number, number][], maxPoints: number): [number, number][] {
    if (points.length <= maxPoints) return points;
    if (maxPoints <= 2) return [points[0] as [number, number], points[points.length - 1] as [number, number]];
    const result: [number, number][] = [points[0] as [number, number]];
    const interiorCount = maxPoints - 2;
    const step = (points.length - 2) / interiorCount;
    for (let index = 0; index < interiorCount; index += 1) {
      const sourceIndex = 1 + Math.floor(index * step);
      result.push(points[sourceIndex] as [number, number]);
    }
    result.push(points[points.length - 1] as [number, number]);
    return result;
  }

  private simplifyPolylineForZoom(points: [number, number][], zoom: number): [number, number][] {
    if (points.length <= 2) return points;
    const { epsilon, maxPoints } = this.simplifyConfigForZoom(zoom);
    const simplified = this.rdpSimplify(points, epsilon);
    return this.capPolylinePoints(simplified, maxPoints);
  }

  async getMapRouteLines(params: {
    bbox: string;
    zoom?: number;
    routeLimit?: number;
    shapeLimit?: number;
  }) {
    const requestStartedAt = performance.now();
    const stageTimings: MapRouteLinesStageTimings = {
      activeFeedsMs: 0,
      bboxStopsMs: 0,
      bboxShapeKeysMs: 0,
      routesMs: 0,
      tripShapeStatsMs: 0,
      shapePointsMs: 0,
      simplifyMs: 0,
      totalMs: 0,
    };
    const zoom = params.zoom ?? 10;
    const renderMode = this.renderModeForZoom(zoom);
    const routeLimit = Math.min(params.routeLimit ?? 1200, 5000);
    const shapeLimit = Math.min(params.shapeLimit ?? 300, 2500);
    const finalize = (payload: Record<string, unknown>, options?: { cacheKey?: string; cacheHit?: boolean }) => {
      stageTimings.totalMs = Math.round(performance.now() - requestStartedAt);
      if (options?.cacheKey && !options.cacheHit) {
        this.writeMapRouteLinesCache(options.cacheKey, payload);
      }
      if (stageTimings.totalMs >= 1000) {
        this.logger.log(
          `[mapRouteLines] zoom=${zoom} routes=${routeLimit} shapes=${shapeLimit} cacheHit=${options?.cacheHit === true} totalMs=${stageTimings.totalMs} stages=${JSON.stringify(
            stageTimings,
          )}`,
        );
      }
      return payload;
    };

    const bbox = this.parseBbox(params.bbox);
    if (!bbox) {
      return finalize({
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      });
    }

    const activeFeedsStartedAt = performance.now();
    const activeFeedVersions = await this.prisma.gtfsFeedVersion.findMany({
      where: { isActive: true },
      select: {
        id: true,
        importedAt: true,
        agency: {
          select: {
            id: true,
            slug: true,
            displayName: true,
          },
        },
      },
    });
    stageTimings.activeFeedsMs = Math.round(performance.now() - activeFeedsStartedAt);

    if (activeFeedVersions.length === 0) {
      return finalize({
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      });
    }

    const activeFeeds = this.activeFeedFingerprint(activeFeedVersions);
    const cacheKey = this.buildMapRouteLinesCacheKey({ bbox, zoom, routeLimit, shapeLimit, activeFeeds });
    const cached = this.readMapRouteLinesCache(cacheKey);
    if (cached) {
      return finalize(cached, { cacheKey, cacheHit: true });
    }

    const feedVersionById = new Map(activeFeedVersions.map((row) => [row.id, row]));
    const activeFeedVersionIds = activeFeedVersions.map((row) => row.id);
    const stopsStartedAt = performance.now();
    const stopsInView = await this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: { in: activeFeedVersionIds },
        stopLat: { gte: bbox.minLat, lte: bbox.maxLat },
        stopLon: { gte: bbox.minLon, lte: bbox.maxLon },
      },
      select: { feedVersionId: true },
      distinct: ['feedVersionId'],
    });
    stageTimings.bboxStopsMs = Math.round(performance.now() - stopsStartedAt);

    const shapeKeysStartedAt = performance.now();
    const shapeSamplesInView =
      activeFeedVersionIds.length === 0
        ? []
        : await this.prisma.$queryRaw<Array<{ feedVersionId: string; shapeId: string }>>(Prisma.sql`
            SELECT DISTINCT
              "feedVersionId",
              "shapeId"
            FROM "GtfsShapePoint"
            WHERE "feedVersionId" IN (${Prisma.join(activeFeedVersionIds)})
              AND "shapePtLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
              AND "shapePtLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
            ORDER BY "feedVersionId", "shapeId"
          `);
    stageTimings.bboxShapeKeysMs = Math.round(performance.now() - shapeKeysStartedAt);

    const feedVersionsInView = [
      ...new Set([...stopsInView.map((row) => row.feedVersionId), ...shapeSamplesInView.map((row) => row.feedVersionId)]),
    ];
    if (feedVersionsInView.length === 0) {
      return finalize({
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      }, { cacheKey });
    }

    const focusViaOnly = zoom <= 7;
    const routesStartedAt = performance.now();
    const routeTypes = this.routeTypesForZoom(zoom);
    const viaFeedVersionIds = activeFeedVersions
      .filter((row) => {
        const slug = row.agency.slug?.toLowerCase() ?? '';
        const name = row.agency.displayName?.toLowerCase() ?? '';
        return slug.includes('via') || name.includes('via rail');
      })
      .map((row) => row.id)
      .filter((feedVersionId) => feedVersionsInView.includes(feedVersionId));

    const baseRoutes = focusViaOnly
      ? []
      : await this.prisma.gtfsRoute.findMany({
          where: {
            feedVersionId: { in: feedVersionsInView },
            ...(routeTypes ? { routeType: { in: routeTypes } } : {}),
          },
          orderBy: [{ routeType: 'asc' }, { routeShortName: 'asc' }, { routeLongName: 'asc' }],
          take: routeLimit,
          select: {
            id: true,
            feedVersionId: true,
            routeId: true,
            routeType: true,
            routeShortName: true,
            routeLongName: true,
            routeColor: true,
          },
        });

    const viaRoutes =
      viaFeedVersionIds.length > 0
        ? await this.prisma.gtfsRoute.findMany({
            where: {
              feedVersionId: { in: viaFeedVersionIds },
            },
            orderBy: [{ routeShortName: 'asc' }, { routeLongName: 'asc' }],
            take: 500,
            select: {
              id: true,
              feedVersionId: true,
              routeId: true,
              routeType: true,
              routeShortName: true,
              routeLongName: true,
              routeColor: true,
            },
          })
        : [];

    const routeByPrimaryId = new Map([...baseRoutes, ...viaRoutes].map((route) => [route.id, route]));
    const allRoutes = focusViaOnly ? [...viaRoutes] : [...routeByPrimaryId.values()];
    const viaRouteIds = new Set(viaRoutes.map((route) => route.id));
    const forcedRoutes = allRoutes.filter((route) => viaRouteIds.has(route.id));
    const remainingRoutes = allRoutes
      .filter((route) => !viaRouteIds.has(route.id))
      .sort((a, b) => {
        const typeOrder = this.routeTypePriority(a.routeType, zoom) - this.routeTypePriority(b.routeType, zoom);
        if (typeOrder !== 0) return typeOrder;
        const feedOrder = a.feedVersionId.localeCompare(b.feedVersionId);
        if (feedOrder !== 0) return feedOrder;
        return `${a.routeShortName ?? ''} ${a.routeLongName ?? ''}`.localeCompare(`${b.routeShortName ?? ''} ${b.routeLongName ?? ''}`);
      });

    const byFeedVersionId = new Map<string, typeof remainingRoutes>();
    for (const route of remainingRoutes) {
      const bucket = byFeedVersionId.get(route.feedVersionId) ?? [];
      bucket.push(route);
      byFeedVersionId.set(route.feedVersionId, bucket);
    }

    const routes: typeof allRoutes = [...forcedRoutes];
    const feedIds = [...byFeedVersionId.keys()].sort();
    while (routes.length < routeLimit && feedIds.length > 0) {
      let appendedInRound = 0;
      for (const feedVersionId of feedIds) {
        const bucket = byFeedVersionId.get(feedVersionId);
        if (!bucket || bucket.length === 0) continue;
        const next = bucket.shift();
        if (!next) continue;
        routes.push(next);
        appendedInRound += 1;
        if (routes.length >= routeLimit) break;
      }
      if (appendedInRound === 0) break;
    }
    stageTimings.routesMs = Math.round(performance.now() - routesStartedAt);

    if (routes.length === 0) {
      return finalize({
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      }, { cacheKey });
    }

    const routeByFeedAndRouteId = new Map(routes.map((route) => [`${route.feedVersionId}::${route.routeId}`, route]));
    const routeFeedAndIdPairs = routes.map((route) => ({
      feedVersionId: route.feedVersionId,
      routeId: route.routeId,
    }));
    const tripStatsStartedAt = performance.now();
    const tripShapeStats = await this.prisma.gtfsTrip.groupBy({
      by: ['feedVersionId', 'routeId', 'shapeId'],
      where: {
        OR: routeFeedAndIdPairs,
        shapeId: { not: null },
      },
      _count: { _all: true },
      orderBy: [{ feedVersionId: 'asc' }, { routeId: 'asc' }, { _count: { shapeId: 'desc' } }, { shapeId: 'asc' }],
      take: 120_000,
    });
    stageTimings.tripShapeStatsMs = Math.round(performance.now() - tripStatsStartedAt);

    const shapeKeysByRouteKey = new Map<string, string[]>();
    for (const row of tripShapeStats) {
      const shapeId = row.shapeId;
      if (!shapeId) continue;
      const routeKey = `${row.feedVersionId}::${row.routeId}`;
      if (!routeByFeedAndRouteId.has(routeKey)) continue;
      const shapeKey = `${row.feedVersionId}::${shapeId}`;
      // Don't filter shapes based on viewport position - include all shapes for selected routes
      // This ensures routes that extend beyond the visible area are rendered completely
      const existing = shapeKeysByRouteKey.get(routeKey) ?? [];
      if (!existing.includes(shapeKey)) {
        existing.push(shapeKey);
      }
      shapeKeysByRouteKey.set(routeKey, existing);
    }

    const prioritizedRoutes = [...routes].sort((a, b) => {
      const typeOrder = this.routeTypePriority(a.routeType, zoom) - this.routeTypePriority(b.routeType, zoom);
      if (typeOrder !== 0) return typeOrder;
      const viaA = viaRouteIds.has(a.id) ? -1 : 0;
      const viaB = viaRouteIds.has(b.id) ? -1 : 0;
      if (viaA !== viaB) return viaA - viaB;
      return `${a.routeShortName ?? ''} ${a.routeLongName ?? ''}`.localeCompare(`${b.routeShortName ?? ''} ${b.routeLongName ?? ''}`);
    });

    const shapeKeyToRouteKey = new Map<string, string>();
    for (const route of prioritizedRoutes) {
      const routeKey = `${route.feedVersionId}::${route.routeId}`;
      const shapeKeysForRoute = shapeKeysByRouteKey.get(routeKey) ?? [];
      const maxShapesPerRoute = this.maxShapesPerRouteForType(zoom, route.routeType);
      let added = 0;
      for (const shapeKey of shapeKeysForRoute) {
        if (added >= maxShapesPerRoute) break;
        if (shapeKeyToRouteKey.has(shapeKey)) continue;
        shapeKeyToRouteKey.set(shapeKey, routeKey);
        added += 1;
        if (shapeKeyToRouteKey.size >= shapeLimit) break;
      }
      if (shapeKeyToRouteKey.size >= shapeLimit) break;
    }

    const selectedShapeKeys = [...shapeKeyToRouteKey.keys()];
    if (selectedShapeKeys.length === 0) {
      return finalize({
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: routes.length, lines: 0 },
      }, { cacheKey });
    }

    const selectedShapeKeySet = new Set(selectedShapeKeys);
    const selectedShapePairs = selectedShapeKeys.map((shapeKey) => {
      const [feedVersionId, shapeId] = shapeKey.split('::');
      return { feedVersionId: feedVersionId as string, shapeId: shapeId as string };
    });
    const selectedFeedVersionIds = [...new Set(selectedShapePairs.map((pair) => pair.feedVersionId))];
    const selectedShapeIds = [...new Set(selectedShapePairs.map((pair) => pair.shapeId))];
    const shapePointWhere =
      selectedShapePairs.length <= 800
        ? { OR: selectedShapePairs }
        : {
            feedVersionId: { in: selectedFeedVersionIds },
            shapeId: { in: selectedShapeIds },
          };

    const shapePointsStartedAt = performance.now();
    const shapePoints = await this.prisma.gtfsShapePoint.findMany({
      where: shapePointWhere,
      orderBy: [{ feedVersionId: 'asc' }, { shapeId: 'asc' }, { shapePtSequence: 'asc' }],
      take: 500_000,
      select: {
        feedVersionId: true,
        shapeId: true,
        shapePtLat: true,
        shapePtLon: true,
        shapePtSequence: true,
      },
    });
    stageTimings.shapePointsMs = Math.round(performance.now() - shapePointsStartedAt);

    const pointsByShapeKey = new Map<string, Array<{ lat: number; lon: number; seq: number }>>();
    for (const point of shapePoints) {
      const shapeKey = `${point.feedVersionId}::${point.shapeId}`;
      if (!selectedShapeKeySet.has(shapeKey)) continue;
      const existing = pointsByShapeKey.get(shapeKey) ?? [];
      existing.push({
        lat: point.shapePtLat,
        lon: point.shapePtLon,
        seq: point.shapePtSequence,
      });
      pointsByShapeKey.set(shapeKey, existing);
    }

    const simplifyStartedAt = performance.now();
    const lines: MapRouteLine[] = [];
    const agencyIds = new Set<string>();
    for (const [shapeKey, points] of pointsByShapeKey.entries()) {
      if (points.length < 2) continue;
      const routeKey = shapeKeyToRouteKey.get(shapeKey);
      if (!routeKey) continue;
      const route = routeByFeedAndRouteId.get(routeKey);
      if (!route) continue;
      const feed = feedVersionById.get(route.feedVersionId);
      const agency = feed?.agency;
      if (agency) agencyIds.add(agency.id);
      const shapeId = shapeKey.split('::')[1] ?? shapeKey;
      const simplifiedPoints = this.simplifyPolylineForZoom(
        points.sort((a, b) => a.seq - b.seq).map((point) => [point.lat, point.lon] as [number, number]),
        zoom,
      );
      lines.push({
        feedVersionId: route.feedVersionId,
        shapeId,
        routeId: route.routeId,
        routeType: route.routeType,
        routeShortName: route.routeShortName,
        routeLongName: route.routeLongName,
        routeColor: route.routeColor,
        agencyId: agency?.id ?? null,
        agencySlug: agency?.slug ?? null,
        agencyName: agency?.displayName ?? null,
        points: simplifiedPoints,
      });
    }

    const corridors = this.buildCorridorsFromLines(lines);
    stageTimings.simplifyMs = Math.round(performance.now() - simplifyStartedAt);

    return finalize({
      bbox: params.bbox,
      zoom,
      mode: renderMode,
      lines,
      corridors,
      counts: {
        agencies: agencyIds.size,
        routes: routes.length,
        lines: lines.length,
        corridors: corridors.length,
      },
    }, { cacheKey });
  }
}
