import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { PrismaService } from '../prisma/prisma.service';

type RealtimeBuckets = {
  service_alerts: string | null;
  trip_updates: string | null;
  vehicle_positions: string | null;
};

type AgencyRealtimeConfig = {
  slug: string;
  realtime: RealtimeBuckets;
};

type FeedBucketState = {
  url: string | null;
  status: 'idle' | 'ok' | 'error';
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  entityCount: number;
};

type GroupPollState = {
  endpoints: RealtimeBuckets;
  agencySlugs: string[];
  alerts: AlertSnapshot[];
  tripUpdates: TripUpdateSnapshot[];
  vehicles: VehicleSnapshot[];
  buckets: Record<keyof RealtimeBuckets, FeedBucketState>;
  lastRefreshAt: string | null;
  lastSuccessAt: string | null;
};

type AlertSnapshot = {
  id: string;
  routeIds: string[];
  stopIds: string[];
  tripIds: string[];
  headerText: string | null;
  descriptionText: string | null;
  url: string | null;
  cause: string | null;
  effect: string | null;
  severityLevel: string | null;
  activePeriodStart: string | null;
  activePeriodEnd: string | null;
};

type TripUpdateSnapshot = {
  tripId: string | null;
  routeId: string | null;
  vehicleId: string | null;
  timestamp: string | null;
  delaySeconds: number | null;
  stopTimeUpdates: Array<{
    stopId: string | null;
    stopSequence: number | null;
    arrivalDelaySeconds: number | null;
    departureDelaySeconds: number | null;
  }>;
};

type VehicleSnapshot = {
  vehicleId: string | null;
  tripId: string | null;
  routeId: string | null;
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  bearing: number | null;
  speed: number | null;
  occupancyStatus: string | null;
  timestamp: string | null;
};

@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly agencyRealtime = new Map<string, AgencyRealtimeConfig>();
  private readonly agencyToGroupKey = new Map<string, string>();
  private readonly groupStates = new Map<string, GroupPollState>();
  private readonly routeTripIdsCache = new Map<string, { tripIds: Set<string>; expiresAt: number }>();
  private pollingInFlight = false;
  private initialized = false;
  private realtimeConfigPath: string | null = null;
  private realtimeConfigMtimeMs = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const startTime = Date.now();
    this.logger.log('[RealtimeService] Initializing realtime service...');

    const reloadStartTime = Date.now();
    await this.reloadRealtimeConfig();
    const reloadDurationMs = Date.now() - reloadStartTime;
    this.logger.log(`[RealtimeService] Realtime config loaded in ${reloadDurationMs}ms`);

    const pollStartTime = Date.now();
    await this.pollRealtimeFeeds();
    const pollDurationMs = Date.now() - pollStartTime;
    this.logger.log(`[RealtimeService] Initial realtime feed poll completed in ${pollDurationMs}ms`);

    const totalDurationMs = Date.now() - startTime;
    this.logger.log(`[RealtimeService] Initialization complete (total: ${totalDurationMs}ms)`);
    this.initialized = true;
  }

  @Interval(20_000)
  async pollRealtimeFeeds() {
    if (!this.initialized) {
      this.logger.debug('[RealtimeService] Polling skipped - service not yet initialized');
      return;
    }
    if (this.pollingInFlight) {
      this.logger.debug('[RealtimeService] Polling skipped - poll already in flight');
      return;
    }
    const pollStartTime = Date.now();
    this.pollingInFlight = true;
    try {
      const reloadStartTime = Date.now();
      await this.reloadRealtimeConfigIfChanged();
      const reloadDurationMs = Date.now() - reloadStartTime;

      const tasksStartTime = Date.now();
      const tasks = [...this.groupStates.entries()].map(async ([groupKey, state]) => {
        await this.pollGroup(groupKey, state);
      });
      await Promise.all(tasks);
      const tasksDurationMs = Date.now() - tasksStartTime;

      const totalDurationMs = Date.now() - pollStartTime;
      this.logger.debug(`[RealtimeService] Poll cycle completed (reload: ${reloadDurationMs}ms, polls: ${tasksDurationMs}ms, total: ${totalDurationMs}ms)`);
    } catch (error) {
      this.logger.warn(`Realtime polling cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pollingInFlight = false;
    }
  }

  async getMapRouteRealtime(params: { feedVersionId: string; routeId: string; agencySlug?: string | null }) {
    const resolvedAgency = await this.resolveAgencyForRealtime(params.feedVersionId, params.agencySlug ?? null);
    if (!resolvedAgency?.slug) {
      return {
        feedVersionId: params.feedVersionId,
        routeId: params.routeId,
        agencySlug: null,
        agencyDisplayName: null,
        refreshedAt: null,
        counts: { vehicles: 0, tripUpdates: 0, alerts: 0 },
        vehicles: [],
        tripUpdates: [],
        alerts: [],
        notes: 'No agency mapped to feed version.',
      };
    }

    const groupKey = this.agencyToGroupKey.get(resolvedAgency.slug);
    if (!groupKey) {
      return {
        feedVersionId: params.feedVersionId,
        routeId: params.routeId,
        agencySlug: resolvedAgency.slug,
        agencyDisplayName: resolvedAgency.displayName,
        refreshedAt: null,
        counts: { vehicles: 0, tripUpdates: 0, alerts: 0 },
        vehicles: [],
        tripUpdates: [],
        alerts: [],
        notes: 'No realtime endpoint set configured for agency.',
      };
    }

    const state = this.groupStates.get(groupKey);
    if (!state) {
      return {
        feedVersionId: params.feedVersionId,
        routeId: params.routeId,
        agencySlug: resolvedAgency.slug,
        agencyDisplayName: resolvedAgency.displayName,
        refreshedAt: null,
        counts: { vehicles: 0, tripUpdates: 0, alerts: 0 },
        vehicles: [],
        tripUpdates: [],
        alerts: [],
        notes: 'Realtime group state not initialized.',
      };
    }

    const routeTripIds = await this.getRouteTripIds(params.feedVersionId, params.routeId);
    const strictVehicles = state.vehicles
      .filter((vehicle) => vehicle.routeId === params.routeId || (vehicle.tripId ? routeTripIds.has(vehicle.tripId) : false))
      .slice(0, 60);
    let vehicles = strictVehicles;
    let fallbackNote = '';
    const canFallbackToAgencyVehicles =
      strictVehicles.length === 0 &&
      state.vehicles.length > 0 &&
      state.vehicles.every((vehicle) => !vehicle.routeId && !vehicle.tripId);
    if (canFallbackToAgencyVehicles) {
      vehicles = state.vehicles.slice(0, 60);
      fallbackNote =
        ' Vehicle feed does not include route_id/trip_id, so showing agency-wide vehicle positions for context.';
    }
    const tripUpdates = state.tripUpdates
      .filter((update) => update.routeId === params.routeId || (update.tripId ? routeTripIds.has(update.tripId) : false))
      .slice(0, 60);
    const alerts = state.alerts
      .filter(
        (alert) =>
          alert.routeIds.includes(params.routeId) ||
          alert.tripIds.some((tripId) => routeTripIds.has(tripId)) ||
          alert.routeIds.length === 0,
      )
      .slice(0, 40);

    return {
      feedVersionId: params.feedVersionId,
      routeId: params.routeId,
      agencySlug: resolvedAgency.slug,
      agencyDisplayName: resolvedAgency.displayName,
      refreshedAt: state.lastRefreshAt,
      counts: { vehicles: vehicles.length, tripUpdates: tripUpdates.length, alerts: alerts.length },
      vehicles,
      tripUpdates,
      alerts,
      notes:
        state.lastSuccessAt === null
          ? 'Realtime feeds have not completed a successful poll yet.'
          : `Realtime feeds last success at ${state.lastSuccessAt}.${fallbackNote}`,
    };
  }

  async getMapStopRealtime(params: { feedVersionId: string; stopId: string }) {
    return this.getMapStopRealtimeWithAgency({ ...params, agencySlug: null });
  }

  async getMapStopRealtimeWithAgency(params: { feedVersionId: string; stopId: string; agencySlug?: string | null }) {
    const resolvedAgency = await this.resolveAgencyForRealtime(params.feedVersionId, params.agencySlug ?? null);
    if (!resolvedAgency?.slug) {
      return {
        feedVersionId: params.feedVersionId,
        stopId: params.stopId,
        agencySlug: null,
        agencyDisplayName: null,
        refreshedAt: null,
        counts: { vehicles: 0, tripUpdates: 0, alerts: 0 },
        vehicles: [],
        tripUpdates: [],
        alerts: [],
        notes: 'No agency mapped to feed version.',
      };
    }

    const groupKey = this.agencyToGroupKey.get(resolvedAgency.slug);
    if (!groupKey) {
      return {
        feedVersionId: params.feedVersionId,
        stopId: params.stopId,
        agencySlug: resolvedAgency.slug,
        agencyDisplayName: resolvedAgency.displayName,
        refreshedAt: null,
        counts: { vehicles: 0, tripUpdates: 0, alerts: 0 },
        vehicles: [],
        tripUpdates: [],
        alerts: [],
        notes: 'No realtime endpoint set configured for agency.',
      };
    }

    const state = this.groupStates.get(groupKey);
    if (!state) {
      return {
        feedVersionId: params.feedVersionId,
        stopId: params.stopId,
        agencySlug: resolvedAgency.slug,
        agencyDisplayName: resolvedAgency.displayName,
        refreshedAt: null,
        counts: { vehicles: 0, tripUpdates: 0, alerts: 0 },
        vehicles: [],
        tripUpdates: [],
        alerts: [],
        notes: 'Realtime group state not initialized.',
      };
    }

    const tripIds = await this.getStopTripIds(params.feedVersionId, params.stopId);
    let vehicles = state.vehicles
      .filter((vehicle) => (vehicle.tripId ? tripIds.has(vehicle.tripId) : false))
      .slice(0, 60);
    let tripUpdates = state.tripUpdates
      .filter(
        (update) =>
          (update.tripId ? tripIds.has(update.tripId) : false) ||
          update.stopTimeUpdates.some((stopUpdate) => stopUpdate.stopId === params.stopId),
      )
      .slice(0, 60);
    let fallbackNote = '';
    if (tripIds.size === 0 && state.vehicles.length > 0) {
      vehicles = state.vehicles.slice(0, 60);
      tripUpdates = state.tripUpdates.slice(0, 60);
      fallbackNote =
        ' Could not map selected stop to current trip IDs (feed version may have rotated), so showing agency-wide realtime context.';
    }
    const alerts = state.alerts
      .filter(
        (alert) =>
          alert.stopIds.includes(params.stopId) ||
          alert.tripIds.some((tripId) => tripIds.has(tripId)) ||
          alert.stopIds.length === 0,
      )
      .slice(0, 40);

    return {
      feedVersionId: params.feedVersionId,
      stopId: params.stopId,
      agencySlug: resolvedAgency.slug,
      agencyDisplayName: resolvedAgency.displayName,
      refreshedAt: state.lastRefreshAt,
      counts: { vehicles: vehicles.length, tripUpdates: tripUpdates.length, alerts: alerts.length },
      vehicles,
      tripUpdates,
      alerts,
      notes:
        state.lastSuccessAt === null
          ? 'Realtime feeds have not completed a successful poll yet.'
          : `Realtime feeds last success at ${state.lastSuccessAt}.${fallbackNote}`,
    };
  }

  getAgencyRealtimeHealth(slug: string) {
    const groupKey = this.agencyToGroupKey.get(slug);
    if (!groupKey) {
      return {
        agencySlug: slug,
        configured: false,
        hasAnyRealtimeEndpoint: false,
        endpointSet: {
          service_alerts: null,
          trip_updates: null,
          vehicle_positions: null,
        },
        buckets: {
          service_alerts: this.emptyBucketState(null),
          trip_updates: this.emptyBucketState(null),
          vehicle_positions: this.emptyBucketState(null),
        },
        lastRefreshAt: null,
        lastSuccessAt: null,
        memberCount: 0,
        notes: 'Agency has no realtime endpoint mapping.',
      };
    }
    const groupState = this.groupStates.get(groupKey);
    if (!groupState) {
      return {
        agencySlug: slug,
        configured: true,
        hasAnyRealtimeEndpoint: true,
        endpointSet: {
          service_alerts: null,
          trip_updates: null,
          vehicle_positions: null,
        },
        buckets: {
          service_alerts: this.emptyBucketState(null),
          trip_updates: this.emptyBucketState(null),
          vehicle_positions: this.emptyBucketState(null),
        },
        lastRefreshAt: null,
        lastSuccessAt: null,
        memberCount: 0,
        notes: 'Realtime group state is unavailable.',
      };
    }

    return {
      agencySlug: slug,
      configured: true,
      hasAnyRealtimeEndpoint: Boolean(
        groupState.endpoints.service_alerts || groupState.endpoints.trip_updates || groupState.endpoints.vehicle_positions,
      ),
      endpointSet: groupState.endpoints,
      buckets: groupState.buckets,
      lastRefreshAt: groupState.lastRefreshAt,
      lastSuccessAt: groupState.lastSuccessAt,
      memberCount: groupState.agencySlugs.length,
      notes: groupState.lastSuccessAt ? '' : 'Polling started but no successful refresh yet.',
    };
  }

  private async reloadRealtimeConfig() {
    const startTime = Date.now();
    const filePath = this.realtimeConfigPath ?? this.resolveRealtimeMapPath();
    this.realtimeConfigPath = filePath;
    const rawText = await readFile(filePath, 'utf8');
    const metadata = await stat(filePath);
    this.realtimeConfigMtimeMs = metadata.mtimeMs;
    const parsed = JSON.parse(rawText) as Record<string, { slug?: string; realtime?: RealtimeBuckets }>;
    this.agencyRealtime.clear();
    this.agencyToGroupKey.clear();
    this.groupStates.clear();

    for (const [slug, value] of Object.entries(parsed)) {
      const endpoints = value?.realtime;
      if (!endpoints) continue;
      const normalized: RealtimeBuckets = {
        service_alerts: endpoints.service_alerts ?? null,
        trip_updates: endpoints.trip_updates ?? null,
        vehicle_positions: endpoints.vehicle_positions ?? null,
      };
      this.agencyRealtime.set(slug, { slug, realtime: normalized });
      const groupKey = JSON.stringify(normalized);
      this.agencyToGroupKey.set(slug, groupKey);
      const existing = this.groupStates.get(groupKey);
      if (existing) {
        existing.agencySlugs.push(slug);
      } else {
        this.groupStates.set(groupKey, {
          endpoints: normalized,
          agencySlugs: [slug],
          alerts: [],
          tripUpdates: [],
          vehicles: [],
          buckets: {
            service_alerts: this.emptyBucketState(normalized.service_alerts),
            trip_updates: this.emptyBucketState(normalized.trip_updates),
            vehicle_positions: this.emptyBucketState(normalized.vehicle_positions),
          },
          lastRefreshAt: null,
          lastSuccessAt: null,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `[RealtimeService] Realtime config loaded in ${durationMs}ms from ${filePath}. Agencies=${this.agencyRealtime.size}, endpoint_sets=${this.groupStates.size}`,
    );
  }

  private async reloadRealtimeConfigIfChanged() {
    const filePath = this.realtimeConfigPath ?? this.resolveRealtimeMapPath();
    this.realtimeConfigPath = filePath;
    try {
      const metadata = await stat(filePath);
      if (metadata.mtimeMs <= this.realtimeConfigMtimeMs) return;
      await this.reloadRealtimeConfig();
    } catch (error) {
      this.logger.warn(`Failed checking realtime config mtime: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async pollGroup(groupKey: string, state: GroupPollState) {
    const [alertsResult, tripUpdatesResult, vehiclesResult] = await Promise.all([
      this.fetchAlerts(state.endpoints.service_alerts),
      this.fetchTripUpdates(state.endpoints.trip_updates),
      this.fetchVehiclePositions(state.endpoints.vehicle_positions),
    ]);

    state.alerts = alertsResult.entities;
    state.tripUpdates = tripUpdatesResult.entities;
    state.vehicles = vehiclesResult.entities;
    state.buckets.service_alerts = alertsResult.health;
    state.buckets.trip_updates = tripUpdatesResult.health;
    state.buckets.vehicle_positions = vehiclesResult.health;
    state.lastRefreshAt = new Date().toISOString();
    if (
      alertsResult.health.status === 'ok' ||
      tripUpdatesResult.health.status === 'ok' ||
      vehiclesResult.health.status === 'ok'
    ) {
      state.lastSuccessAt = state.lastRefreshAt;
    }

    this.groupStates.set(groupKey, state);
  }

  private async fetchAlerts(url: string | null): Promise<{ entities: AlertSnapshot[]; health: FeedBucketState }> {
    const empty = this.emptyBucketState(url);
    if (!url) return { entities: [], health: empty };
    try {
      const message = await this.fetchAndDecode(url);
      const entities: AlertSnapshot[] = [];
      for (const entity of message.entity ?? []) {
        if (!entity?.alert) continue;
        const alert = entity.alert;
        const informed = alert.informed_entity ?? [];
        const routeIds = Array.from(
          new Set<string>(
            informed
              .map((row: any) => row?.route_id)
              .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0),
          ),
        );
        const stopIds = Array.from(
          new Set<string>(
            informed
              .map((row: any) => row?.stop_id)
              .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0),
          ),
        );
        const tripIds = Array.from(
          new Set<string>(
            informed
              .map((row: any) => row?.trip?.trip_id)
              .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0),
          ),
        );
        entities.push({
          id: entity.id ?? '',
          routeIds,
          stopIds,
          tripIds,
          headerText: this.translatedText(alert.header_text),
          descriptionText: this.translatedText(alert.description_text),
          url: this.translatedText(alert.url),
          cause: alert.cause ?? null,
          effect: alert.effect ?? null,
          severityLevel: alert.severity_level ?? null,
          activePeriodStart: this.timestampToIso(alert.active_period?.[0]?.start),
          activePeriodEnd: this.timestampToIso(alert.active_period?.[0]?.end),
        });
      }
      return {
        entities,
        health: {
          ...empty,
          status: 'ok',
          lastPolledAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
          entityCount: entities.length,
        },
      };
    } catch (error) {
      return {
        entities: [],
        health: {
          ...empty,
          status: 'error',
          lastPolledAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async fetchTripUpdates(url: string | null): Promise<{ entities: TripUpdateSnapshot[]; health: FeedBucketState }> {
    const empty = this.emptyBucketState(url);
    if (!url) return { entities: [], health: empty };
    try {
      const message = await this.fetchAndDecode(url);
      const entities: TripUpdateSnapshot[] = [];
      for (const entity of message.entity ?? []) {
        const tripUpdate = entity?.trip_update;
        if (!tripUpdate) continue;
        const trip = tripUpdate.trip ?? {};
        const vehicle = tripUpdate.vehicle ?? {};
        entities.push({
          tripId: trip.trip_id ?? null,
          routeId: trip.route_id ?? null,
          vehicleId: vehicle.id ?? null,
          timestamp: this.timestampToIso(tripUpdate.timestamp),
          delaySeconds: this.toNumber(tripUpdate.delay),
          stopTimeUpdates: (tripUpdate.stop_time_update ?? []).slice(0, 8).map((stopTimeUpdate: any) => ({
            stopId: stopTimeUpdate.stop_id ?? null,
            stopSequence: this.toNumber(stopTimeUpdate.stop_sequence),
            arrivalDelaySeconds: this.toNumber(stopTimeUpdate.arrival?.delay),
            departureDelaySeconds: this.toNumber(stopTimeUpdate.departure?.delay),
          })),
        });
      }
      return {
        entities,
        health: {
          ...empty,
          status: 'ok',
          lastPolledAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
          entityCount: entities.length,
        },
      };
    } catch (error) {
      return {
        entities: [],
        health: {
          ...empty,
          status: 'error',
          lastPolledAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async fetchVehiclePositions(url: string | null): Promise<{ entities: VehicleSnapshot[]; health: FeedBucketState }> {
    const empty = this.emptyBucketState(url);
    if (!url) return { entities: [], health: empty };
    try {
      const message = await this.fetchAndDecode(url);
      const entities: VehicleSnapshot[] = [];
      for (const entity of message.entity ?? []) {
        const vehiclePosition = entity?.vehicle;
        if (!vehiclePosition) continue;
        const trip = vehiclePosition.trip ?? {};
        const vehicle = vehiclePosition.vehicle ?? {};
        const position = vehiclePosition.position ?? {};
        entities.push({
          vehicleId: vehicle.id ?? null,
          tripId: trip.trip_id ?? null,
          routeId: trip.route_id ?? null,
          label: vehicle.label ?? null,
          latitude: this.toNumber(position.latitude),
          longitude: this.toNumber(position.longitude),
          bearing: this.toNumber(position.bearing),
          speed: this.toNumber(position.speed),
          occupancyStatus: vehiclePosition.occupancy_status ?? null,
          timestamp: this.timestampToIso(vehiclePosition.timestamp),
        });
      }
      return {
        entities,
        health: {
          ...empty,
          status: 'ok',
          lastPolledAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
          entityCount: entities.length,
        },
      };
    } catch (error) {
      return {
        entities: [],
        health: {
          ...empty,
          status: 'error',
          lastPolledAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async fetchAndDecode(url: string) {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'ttc-viewer-realtime/0.1',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer) as any;
  }

  private translatedText(value: any): string | null {
    const text = value?.translation?.[0]?.text;
    return typeof text === 'string' ? text : null;
  }

  private timestampToIso(value: unknown): string | null {
    const numeric = this.toNumber(value);
    if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) return null;
    return new Date(numeric * 1000).toISOString();
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: () => number }).toNumber === 'function') {
      const parsed = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
      const low = Number((value as { low?: unknown }).low ?? 0);
      const high = Number((value as { high?: unknown }).high ?? 0);
      if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
      return high * 2 ** 32 + low;
    }
    return null;
  }

  private emptyBucketState(url: string | null): FeedBucketState {
    return {
      url,
      status: 'idle',
      lastPolledAt: null,
      lastSuccessAt: null,
      lastError: null,
      entityCount: 0,
    };
  }

  private async getRouteTripIds(feedVersionId: string, routeId: string): Promise<Set<string>> {
    const cacheKey = `${feedVersionId}::${routeId}`;
    const now = Date.now();
    const cached = this.routeTripIdsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.tripIds;
    const rows = await this.prisma.gtfsTrip.findMany({
      where: { feedVersionId, routeId },
      select: { tripId: true },
      take: 20_000,
    });
    const tripIds = new Set(rows.map((row) => row.tripId));
    this.routeTripIdsCache.set(cacheKey, { tripIds, expiresAt: now + 5 * 60 * 1000 });
    return tripIds;
  }

  private async resolveAgencyForRealtime(feedVersionId: string, agencySlug?: string | null) {
    const byFeedVersion = await this.prisma.gtfsFeedVersion.findUnique({
      where: { id: feedVersionId },
      select: { agency: { select: { slug: true, displayName: true } } },
    });
    if (byFeedVersion?.agency?.slug) return byFeedVersion.agency;
    if (!agencySlug) return null;
    const bySlug = await this.prisma.agency.findUnique({
      where: { slug: agencySlug },
      select: { slug: true, displayName: true },
    });
    return bySlug;
  }

  private async getStopTripIds(feedVersionId: string, stopId: string): Promise<Set<string>> {
    const cacheKey = `${feedVersionId}::stop::${stopId}`;
    const now = Date.now();
    const cached = this.routeTripIdsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.tripIds;
    const rows = await this.prisma.gtfsStopTime.findMany({
      where: { feedVersionId, stopId },
      select: { tripId: true },
      distinct: ['tripId'],
      take: 20_000,
    });
    const tripIds = new Set(rows.map((row) => row.tripId));
    this.routeTripIdsCache.set(cacheKey, { tripIds, expiresAt: now + 5 * 60 * 1000 });
    return tripIds;
  }

  private resolveRealtimeMapPath() {
    const envPath = process.env.AGENCY_REALTIME_MAP_PATH;
    if (envPath && existsSync(envPath)) return envPath;
    const candidates = [
      path.resolve(process.cwd(), 'agency_realtime_map.json'),
      path.resolve(process.cwd(), '..', 'agency_realtime_map.json'),
      path.resolve(process.cwd(), '..', '..', 'agency_realtime_map.json'),
      path.resolve(process.cwd(), '..', '..', '..', 'agency_realtime_map.json'),
      path.resolve(__dirname, '..', '..', '..', '..', 'agency_realtime_map.json'),
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'agency_realtime_map.json'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error('Could not locate agency_realtime_map.json. Set AGENCY_REALTIME_MAP_PATH to override.');
  }
}
