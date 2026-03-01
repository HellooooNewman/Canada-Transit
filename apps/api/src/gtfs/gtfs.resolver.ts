import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import { GtfsService } from './gtfs.service';
import { RealtimeService } from './realtime.service';

@Resolver()
export class GtfsResolver {
  constructor(
    private readonly gtfsService: GtfsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  @Query(() => [GraphQLJSON], { name: 'agencies' })
  agencies(@Args('limit', { type: () => Int, nullable: true, defaultValue: 300 }) limit?: number) {
    return this.gtfsService.getAgencies(limit);
  }

  @Query(() => [GraphQLJSON], { name: 'gtfsRoutes' })
  gtfsRoutes(
    @Args('agencyId', { type: () => String }) agencyId: string,
    @Args('feedVersionId', { type: () => String, nullable: true }) feedVersionId?: string,
    @Args('routeType', { type: () => Int, nullable: true }) routeType?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 1000 }) limit?: number,
  ) {
    return this.gtfsService.getRoutes({ agencyId, feedVersionId, routeType, limit });
  }

  @Query(() => [GraphQLJSON], { name: 'gtfsStops' })
  gtfsStops(
    @Args('agencyId', { type: () => String }) agencyId: string,
    @Args('feedVersionId', { type: () => String, nullable: true }) feedVersionId?: string,
    @Args('bbox', { type: () => String, nullable: true }) bbox?: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 2000 }) limit?: number,
  ) {
    return this.gtfsService.getStops({ agencyId, feedVersionId, bbox, limit });
  }

  @Query(() => [GraphQLJSON], { name: 'gtfsTrips' })
  gtfsTrips(
    @Args('agencyId', { type: () => String }) agencyId: string,
    @Args('feedVersionId', { type: () => String, nullable: true }) feedVersionId?: string,
    @Args('routeId', { type: () => String, nullable: true }) routeId?: string,
    @Args('serviceId', { type: () => String, nullable: true }) serviceId?: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 2000 }) limit?: number,
  ) {
    return this.gtfsService.getTrips({ agencyId, feedVersionId, routeId, serviceId, limit });
  }

  @Query(() => [GraphQLJSON], { name: 'gtfsStopTimes' })
  gtfsStopTimes(
    @Args('agencyId', { type: () => String }) agencyId: string,
    @Args('tripId', { type: () => String }) tripId: string,
    @Args('feedVersionId', { type: () => String, nullable: true }) feedVersionId?: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 5000 }) limit?: number,
  ) {
    return this.gtfsService.getStopTimes({ agencyId, feedVersionId, tripId, limit });
  }

  @Query(() => [GraphQLJSON], { name: 'gtfsShapes' })
  gtfsShapes(
    @Args('agencyId', { type: () => String }) agencyId: string,
    @Args('feedVersionId', { type: () => String, nullable: true }) feedVersionId?: string,
    @Args('routeId', { type: () => String, nullable: true }) routeId?: string,
    @Args('bbox', { type: () => String, nullable: true }) bbox?: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 10000 }) limit?: number,
  ) {
    return this.gtfsService.getShapes({ agencyId, feedVersionId, routeId, bbox, limit });
  }

  @Query(() => [GraphQLJSON], { name: 'gtfsTableRows' })
  gtfsTableRows(
    @Args('agencyId', { type: () => String }) agencyId: string,
    @Args('tableName', { type: () => String }) tableName: string,
    @Args('feedVersionId', { type: () => String, nullable: true }) feedVersionId?: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 200 }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true, defaultValue: 0 }) offset?: number,
  ) {
    return this.gtfsService.getTableRows({ agencyId, tableName, feedVersionId, limit, offset });
  }

  @Query(() => GraphQLJSON, { name: 'mapDiscovery' })
  mapDiscovery(
    @Args('bbox', { type: () => String }) bbox: string,
    @Args('zoom', { type: () => Int, nullable: true, defaultValue: 11 }) zoom?: number,
    @Args('routeLimit', { type: () => Int, nullable: true, defaultValue: 4000 }) routeLimit?: number,
    @Args('stopLimit', { type: () => Int, nullable: true, defaultValue: 3000 }) stopLimit?: number,
  ) {
    return this.gtfsService.getMapDiscovery({ bbox, zoom, routeLimit, stopLimit });
  }

  @Query(() => GraphQLJSON, { name: 'mapStops' })
  mapStops(
    @Args('bbox', { type: () => String }) bbox: string,
    @Args('zoom', { type: () => Int, nullable: true, defaultValue: 11 }) zoom?: number,
    @Args('stopLimit', { type: () => Int, nullable: true, defaultValue: 3000 }) stopLimit?: number,
  ) {
    return this.gtfsService.getMapStops({ bbox, zoom, stopLimit });
  }

  @Query(() => GraphQLJSON, { name: 'mapRouteLines' })
  mapRouteLines(
    @Args('bbox', { type: () => String }) bbox: string,
    @Args('zoom', { type: () => Int, nullable: true, defaultValue: 10 }) zoom?: number,
    @Args('routeLimit', { type: () => Int, nullable: true, defaultValue: 1200 }) routeLimit?: number,
    @Args('shapeLimit', { type: () => Int, nullable: true, defaultValue: 300 }) shapeLimit?: number,
  ) {
    return this.gtfsService.getMapRouteLines({ bbox, zoom, routeLimit, shapeLimit });
  }

  @Query(() => GraphQLJSON, { name: 'mapRouteDetails' })
  mapRouteDetails(
    @Args('feedVersionId', { type: () => String }) feedVersionId: string,
    @Args('routeId', { type: () => String }) routeId: string,
  ) {
    return this.gtfsService.getMapRouteDetails({ feedVersionId, routeId });
  }

  @Query(() => GraphQLJSON, { name: 'mapRouteServiceStats' })
  mapRouteServiceStats(
    @Args('feedVersionId', { type: () => String }) feedVersionId: string,
    @Args('routeId', { type: () => String }) routeId: string,
    @Args('serviceDate', { type: () => String, nullable: true }) serviceDate?: string,
  ) {
    return this.gtfsService.getMapRouteServiceStats({ feedVersionId, routeId, serviceDate });
  }

  @Query(() => GraphQLJSON, { name: 'mapStopDetails' })
  mapStopDetails(
    @Args('feedVersionId', { type: () => String }) feedVersionId: string,
    @Args('stopId', { type: () => String }) stopId: string,
  ) {
    return this.gtfsService.getMapStopDetails({ feedVersionId, stopId });
  }

  @Query(() => GraphQLJSON, { name: 'mapRouteRealtime' })
  mapRouteRealtime(
    @Args('feedVersionId', { type: () => String }) feedVersionId: string,
    @Args('routeId', { type: () => String }) routeId: string,
    @Args('agencySlug', { type: () => String, nullable: true }) agencySlug?: string,
  ) {
    return this.realtimeService.getMapRouteRealtime({ feedVersionId, routeId, agencySlug });
  }

  @Query(() => GraphQLJSON, { name: 'agencyRealtimeHealth' })
  agencyRealtimeHealth(@Args('slug', { type: () => String }) slug: string) {
    return this.realtimeService.getAgencyRealtimeHealth(slug);
  }

  @Query(() => GraphQLJSON, { name: 'mapStopRealtime' })
  mapStopRealtime(
    @Args('feedVersionId', { type: () => String }) feedVersionId: string,
    @Args('stopId', { type: () => String }) stopId: string,
    @Args('agencySlug', { type: () => String, nullable: true }) agencySlug?: string,
  ) {
    return this.realtimeService.getMapStopRealtimeWithAgency({ feedVersionId, stopId, agencySlug });
  }
}
