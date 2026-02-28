import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class GtfsService {
  constructor(private readonly prisma: PrismaService) {}

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
      agency: route.feedVersion.agency,
      counts: {
        trips: trips.length,
        distinctStops: routeStopRows.length,
        directions: distinctDirectionIds.length,
      },
      directionIds: distinctDirectionIds,
      headsigns: uniqueHeadsigns.slice(0, 10),
      sampleTrips: sampleTripNames,
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
      agency: stop.feedVersion.agency,
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
    const bbox = this.parseBbox(params.bbox);
    const zoom = params.zoom ?? 10;
    const renderMode = this.renderModeForZoom(zoom);
    if (!bbox) {
      return {
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      };
    }

    const routeLimit = Math.min(params.routeLimit ?? 1200, 5000);
    const shapeLimit = Math.min(params.shapeLimit ?? 300, 2500);
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
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      };
    }

    const feedVersionById = new Map(activeFeedVersions.map((row) => [row.id, row]));
    const activeFeedVersionIds = activeFeedVersions.map((row) => row.id);
    const stopsInView = await this.prisma.gtfsStop.findMany({
      where: {
        feedVersionId: { in: activeFeedVersionIds },
        stopLat: { gte: bbox.minLat, lte: bbox.maxLat },
        stopLon: { gte: bbox.minLon, lte: bbox.maxLon },
      },
      select: { feedVersionId: true },
      distinct: ['feedVersionId'],
    });

    const shapeSamplesInView = await this.prisma.gtfsShapePoint.findMany({
      where: {
        feedVersionId: { in: activeFeedVersionIds },
        shapePtLat: { gte: bbox.minLat, lte: bbox.maxLat },
        shapePtLon: { gte: bbox.minLon, lte: bbox.maxLon },
      },
      select: { feedVersionId: true, shapeId: true },
      distinct: ['feedVersionId', 'shapeId'],
    });

    const feedVersionsInView = [
      ...new Set([...stopsInView.map((row) => row.feedVersionId), ...shapeSamplesInView.map((row) => row.feedVersionId)]),
    ];
    const shapeKeysInView = new Set(shapeSamplesInView.map((row) => `${row.feedVersionId}::${row.shapeId}`));
    if (feedVersionsInView.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      };
    }

    const routeTypes = this.routeTypesForZoom(zoom);
    const viaFeedVersionIds = activeFeedVersions
      .filter((row) => {
        const slug = row.agency.slug?.toLowerCase() ?? '';
        const name = row.agency.displayName?.toLowerCase() ?? '';
        return slug.includes('via') || name.includes('via rail');
      })
      .map((row) => row.id)
      .filter((feedVersionId) => feedVersionsInView.includes(feedVersionId));

    const baseRoutes = await this.prisma.gtfsRoute.findMany({
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
    const allRoutes = zoom <= 7 ? [...viaRoutes] : [...routeByPrimaryId.values()];
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

    if (routes.length === 0) {
      return {
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: 0, lines: 0 },
      };
    }

    const routeByFeedAndRouteId = new Map(routes.map((route) => [`${route.feedVersionId}::${route.routeId}`, route]));
    const routeFeedAndIdPairs = routes.map((route) => ({
      feedVersionId: route.feedVersionId,
      routeId: route.routeId,
    }));
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

    const shapeKeysByRouteKey = new Map<string, string[]>();
    for (const row of tripShapeStats) {
      const shapeId = row.shapeId;
      if (!shapeId) continue;
      const routeKey = `${row.feedVersionId}::${row.routeId}`;
      if (!routeByFeedAndRouteId.has(routeKey)) continue;
      const shapeKey = `${row.feedVersionId}::${shapeId}`;
      if (!shapeKeysInView.has(shapeKey)) continue;
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
      return {
        bbox: params.bbox,
        zoom,
        mode: renderMode,
        lines: [],
        corridors: [],
        counts: { agencies: 0, routes: routes.length, lines: 0 },
      };
    }

    const selectedFeedVersionIds = [...new Set(selectedShapeKeys.map((shapeKey) => shapeKey.split('::')[0] as string))];
    const selectedShapeIds = [...new Set(selectedShapeKeys.map((shapeKey) => shapeKey.split('::')[1] as string))];
    const selectedShapeKeySet = new Set(selectedShapeKeys);

    const shapePoints = await this.prisma.gtfsShapePoint.findMany({
      where: {
        feedVersionId: { in: selectedFeedVersionIds },
        shapeId: { in: selectedShapeIds },
      },
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

    return {
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
    };
  }
}
