<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { ChartConfiguration } from 'chart.js';
  import { graphqlRequest } from '$lib/api';
  import { fetchRouteLinesForBbox, fetchStopsForBbox, routeLimitForZoom, shapeLimitForZoom } from './map-data-client';
  import MetricChart from '$lib/components/metric-chart.svelte';
  import { buildDoughnutChartConfig, buildHorizontalBarChartConfig } from '$lib/charts/theme';
  import 'leaflet/dist/leaflet.css';

  type RouteLine = {
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

  type CorridorRouteRef = {
    feedVersionId: string;
    routeId: string;
    routeType?: number | null;
    routeShortName?: string | null;
    routeLongName?: string | null;
    routeColor?: string | null;
    agencySlug?: string | null;
    agencyName?: string | null;
  };

  type RouteCorridor = {
    corridorId: string;
    points: [number, number][];
    routeRefs: CorridorRouteRef[];
    routeCount: number;
    routeTypes: number[];
  };

  type MapRouteLinesPayload = {
    mode?: 'corridor' | 'mixed' | 'detailed';
    lines?: RouteLine[];
    corridors?: RouteCorridor[];
    counts?: {
      agencies?: number;
      routes?: number;
      lines?: number;
      corridors?: number;
    };
  };

  type RouteSummary = {
    key: string;
    feedVersionId: string;
    routeId: string;
    routeShortName?: string | null;
    routeLongName?: string | null;
    routeType?: number | null;
    routeColor?: string | null;
    agencyName?: string | null;
    agencySlug?: string | null;
    segmentCount: number;
    pointCount: number;
    shapesInView: string[];
  };

  type StopPoint = {
    feedVersionId: string;
    stopId?: string | null;
    stopName?: string | null;
    stopLat: number;
    stopLon: number;
    wheelchairBoarding?: number | null;
    agencyId?: string | null;
    agencySlug?: string | null;
    agencyName?: string | null;
  };

  type BboxRect = {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
  };

  type AgencyRidership = {
    sourceTableId?: string | null;
    latestPassengerTripsThousands?: number | null;
    latestPassengerTripsMonth?: string | null;
    latestRevenueThousandsCad?: number | null;
    latestRevenueMonth?: string | null;
  };

  type RouteDetails = {
    feedVersionId: string;
    routeId: string;
    routeType?: number | null;
    routeShortName?: string | null;
    routeLongName?: string | null;
    routeDesc?: string | null;
    routeUrl?: string | null;
    routeColor?: string | null;
    routeTextColor?: string | null;
    agency?: {
      id: string;
      slug: string;
      displayName: string;
      countryCode?: string | null;
      subdivisionCode?: string | null;
      timezone?: string | null;
      ridership?: AgencyRidership | null;
    } | null;
    counts?: {
      trips: number;
      distinctStops: number;
      directions: number;
    } | null;
    directionIds?: number[] | null;
    headsigns?: string[] | null;
    sampleTrips?: string[] | null;
    routePath?: {
      tripId: string;
      directionId?: number | null;
      headsign?: string | null;
      stops: Array<{
        stopSequence: number;
        stopId: string;
        stopName?: string | null;
        platformCode?: string | null;
        wheelchairBoarding?: number | null;
      }>;
    } | null;
  };

  type RouteServiceStats = {
    feedVersionId: string;
    routeId: string;
    serviceDate: string;
    scheduledTrips: number;
    headwaysByTimeBand: Array<{
      key: string;
      label: string;
      startHour: number;
      endHour: number;
      tripDepartures: number;
      avgHeadwayMinutes: number | null;
      tripsPerHour: number;
    }>;
    spanOfService: {
      firstDeparture: string | null;
      lastDeparture: string | null;
      firstDepartureSeconds: number | null;
      lastDepartureSeconds: number | null;
      spanHours: number;
    };
    stopCoverage: {
      distinctStops: number;
      routeCoverageKm: number;
      stopsPerKm: number | null;
      avgStopSpacingMeters: number | null;
    };
    supply: {
      serviceHoursApprox: number;
      serviceKmApprox: number;
      vrhApprox: number;
      vrkApprox: number;
    };
    methodology: {
      calendarApplied: boolean;
      frequencyFallbackUsed: boolean;
      distanceSources: {
        stop_times_shape_dist: number;
        shape_dist: number;
        shape_geometry: number;
        stop_geometry: number;
        unknown: number;
      };
      notes: string[];
    };
  };

  type StopDetails = {
    feedVersionId: string;
    stopId: string;
    stopCode?: string | null;
    stopName?: string | null;
    stopDesc?: string | null;
    stopLat?: number | null;
    stopLon?: number | null;
    zoneId?: string | null;
    stopUrl?: string | null;
    locationType?: number | null;
    parentStation?: string | null;
    wheelchairBoarding?: number | null;
    platformCode?: string | null;
    agency?: {
      id: string;
      slug: string;
      displayName: string;
      countryCode?: string | null;
      subdivisionCode?: string | null;
      timezone?: string | null;
      ridership?: AgencyRidership | null;
    } | null;
    counts?: {
      trips: number;
      routes: number;
    } | null;
    routes?: Array<{
      routeId: string;
      routeType?: number | null;
      routeShortName?: string | null;
      routeLongName?: string | null;
      routeColor?: string | null;
    }> | null;
    headsigns?: string[] | null;
    primaryRoutePath?: {
      route?: {
        routeId: string;
        routeType?: number | null;
        routeShortName?: string | null;
        routeLongName?: string | null;
        routeColor?: string | null;
      } | null;
      tripId: string;
      headsign?: string | null;
      currentStopId: string;
      currentStopSequence?: number | null;
      stops: Array<{
        stopSequence: number;
        stopId: string;
        stopName?: string | null;
        platformCode?: string | null;
        wheelchairBoarding?: number | null;
      }>;
    } | null;
  };

  type RouteRealtime = {
    feedVersionId: string;
    routeId: string;
    agencySlug?: string | null;
    agencyDisplayName?: string | null;
    refreshedAt?: string | null;
    counts?: {
      vehicles: number;
      tripUpdates: number;
      alerts: number;
    } | null;
    vehicles?: Array<{
      vehicleId?: string | null;
      tripId?: string | null;
      label?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      bearing?: number | null;
      timestamp?: string | null;
    }> | null;
    tripUpdates?: Array<{
      tripId?: string | null;
      timestamp?: string | null;
      delaySeconds?: number | null;
    }> | null;
    alerts?: Array<{
      id?: string | null;
      headerText?: string | null;
      effect?: string | null;
    }> | null;
    notes?: string | null;
  };

  type RouteRealtimeVehicle = NonNullable<RouteRealtime['vehicles']>[number];

  type AgencyRealtimeHealth = {
    agencySlug: string;
    configured: boolean;
    hasAnyRealtimeEndpoint: boolean;
    endpointSet?: {
      service_alerts?: string | null;
      trip_updates?: string | null;
      vehicle_positions?: string | null;
    } | null;
    buckets?: {
      service_alerts?: {
        status?: string | null;
        lastSuccessAt?: string | null;
        lastError?: string | null;
        entityCount?: number | null;
      } | null;
      trip_updates?: {
        status?: string | null;
        lastSuccessAt?: string | null;
        lastError?: string | null;
        entityCount?: number | null;
      } | null;
      vehicle_positions?: {
        status?: string | null;
        lastSuccessAt?: string | null;
        lastError?: string | null;
        entityCount?: number | null;
      } | null;
    } | null;
    lastRefreshAt?: string | null;
    lastSuccessAt?: string | null;
    memberCount?: number | null;
    notes?: string | null;
  };

  type StopRealtime = {
    feedVersionId: string;
    stopId: string;
    agencySlug?: string | null;
    agencyDisplayName?: string | null;
    refreshedAt?: string | null;
    counts?: {
      vehicles: number;
      tripUpdates: number;
      alerts: number;
    } | null;
    vehicles?: Array<{
      vehicleId?: string | null;
      tripId?: string | null;
      label?: string | null;
      timestamp?: string | null;
    }> | null;
    tripUpdates?: Array<{
      tripId?: string | null;
      timestamp?: string | null;
      delaySeconds?: number | null;
      stopTimeUpdates?: Array<{
        stopId?: string | null;
        arrivalDelaySeconds?: number | null;
        departureDelaySeconds?: number | null;
      }> | null;
    }> | null;
    alerts?: Array<{
      id?: string | null;
      headerText?: string | null;
      effect?: string | null;
    }> | null;
    notes?: string | null;
  };

  export let data: {
    center: { lat: number; lon: number };
    zoom: number;
    bbox: string;
  };

  const TORONTO_CENTER = { lat: 43.6532, lon: -79.3832 };
  const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const DARK_TILE_ATTRIBUTION =
    '&copy; OpenStreetMap contributors &copy; CARTO';
  const FALLBACK_COLORS = ['#f59e0b', '#60a5fa', '#34d399', '#c084fc', '#fb7185', '#22d3ee'];
  const VEHICLE_ANIMATION_STORAGE_KEY = 'map.animateVehicleMarker';
  const BASE_STOP_MARKER_RADIUS = 2.9;
  const HOVER_STOP_MARKER_RADIUS = 6.2;
  const MIN_STOP_RENDER_ZOOM = 15;
  const ROUTE_GEOMETRY_PANE = 'routeGeometryPane';
  const ROUTE_STOP_PANE = 'routeStopPane';
  const ROUTE_ANIMATION_PANE = 'routeAnimationPane';
  const REALTIME_VEHICLE_PANE = 'realtimeVehiclePane';
  const ROUTE_GEOMETRY_FADE_MS = 220;
  const HASH_ZOOM_DECIMALS = 2;
  const HASH_COORD_DECIMALS = 5;
  const VEHICLE_ROUTE_DISTANCE_THRESHOLD_PIXELS = 18;

  let mapEl: HTMLDivElement;
  let sidebarEl: HTMLDivElement | null = null;
  let loading = false;
  let error = '';
  let modeLabel = 'Rail focus';
  let currentZoom = data.zoom;
  let citySearch = '';
  let citySearchLoading = false;
  let citySearchError = '';
  let renderMode: 'corridor' | 'mixed' | 'detailed' = 'detailed';
  let renderMetrics = {
    routeLoadMs: 0,
    stopLoadMs: 0,
    routePayloadBytes: 0,
    stopPayloadBytes: 0,
  };
  let lastModeShiftZoom = data.zoom;

  let L: any;
  let map: any;
  let routeLayer: any;
  let stopLayer: any;
  let animationLayer: any;
  let realtimeVehicleLayer: any;
  let animationFrameId: number | null = null;
  let animatedRouteStates: Array<{
    routeKey: string;
    marker: any;
    points: [number, number][];
    segmentPixelDistances: number[];
    totalPixelDistance: number;
    phases: Array<
      | { kind: 'move'; startDistance: number; endDistance: number; durationMs: number }
      | { kind: 'pause'; distance: number; durationMs: number }
    >;
    cycleDurationMs: number;
    startAt: number;
  }> = [];
  let animateVehicles = true;
  let latestVisibleLines: RouteLine[] = [];
  let latestVisibleStops: StopPoint[] = [];
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let realtimeRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let inFlightAbort: AbortController | null = null;
  let lastRouteLoadStartedAt = 0;
  let activeRequestId = 0;
  let hasLoadedAtLeastOnce = false;
  let coveredBbox: BboxRect | null = null;
  let lastViewportBbox: BboxRect | null = null;
  let cachedLinesByKey = new Map<string, RouteLine>();
  let cachedCorridorsById = new Map<string, RouteCorridor>();
  let cachedStopsByKey = new Map<string, StopPoint>();
  let cacheMode: 'corridor' | 'mixed' | 'detailed' | null = null;
  let cacheMayBeIncomplete = false;
  let incrementalPanCount = 0;
  let shouldAutoFitInitialRoutes = true;
  let selectedRouteKey: string | null = null;
  let routeSummaries = new Map<string, RouteSummary>();
  let selectedRoute: RouteSummary | null = null;
  let selectedStop: StopPoint | null = null;
  let detailKind: 'route' | 'stop' | 'corridor' | null = null;
  let detailLoading = false;
  let detailError = '';
  let routeDetails: RouteDetails | null = null;
  let routeServiceStats: RouteServiceStats | null = null;
  let routeRealtime: RouteRealtime | null = null;
  let agencyRealtimeHealth: AgencyRealtimeHealth | null = null;
  let stopDetails: StopDetails | null = null;
  let stopRealtime: StopRealtime | null = null;
  let corridorDetailRoutes: CorridorRouteRef[] = [];
  let canReturnToCorridor = false;
  let detailsAbort: AbortController | null = null;
  let activeDetailRequestId = 0;
  let routeRealtimeAbort: AbortController | null = null;
  let activeRealtimeRequestId = 0;
  let routeStopListEl: HTMLOListElement | null = null;
  let hoveredSidebarStopKey: string | null = null;
  let highlightedSidebarStopMarker: any | null = null;
  let visibleStopMarkersByKey = new Map<string, any>();
  let pendingRouteScrollStopId: string | null = null;
  let selectedRouteOverlayStopsByKey = new Map<string, StopPoint>();
  let activeRouteStopOverlayRequestId = 0;
  const routeStopLocationCache = new Map<string, { lat: number; lon: number }>();
  const routeDetailsCache = new Map<
    string,
    {
      routeDetails: RouteDetails | null;
      routeServiceStats: RouteServiceStats | null;
      routeRealtime: RouteRealtime | null;
      agencyRealtimeHealth: AgencyRealtimeHealth | null;
    }
  >();
  const stopDetailsCache = new Map<
    string,
    {
      stopDetails: StopDetails | null;
      stopRealtime: StopRealtime | null;
      agencyRealtimeHealth: AgencyRealtimeHealth | null;
    }
  >();
  let headwayChartConfig: ChartConfiguration<'bar'> | null = null;
  let supplyChartConfig: ChartConfiguration<'bar'> | null = null;
  let distanceQualityChartConfig: ChartConfiguration<'doughnut'> | null = null;
  let hasRouteServiceStatsData = false;

  const MODE_HYSTERESIS_ZOOM = 1;
  const MAX_INCREMENTAL_PANS = 12;
  const LARGE_JUMP_RATIO = 1.8;
  const ROUTE_REFRESH_DEBOUNCE_MS = 450;
  const ROUTE_REFRESH_MIN_INTERVAL_MS = 700;
  $: modePills = modeLabel
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  $: headwayChartConfig =
    routeServiceStats && routeServiceStats.headwaysByTimeBand.length > 0
      ? buildHorizontalBarChartConfig(
          routeServiceStats.headwaysByTimeBand.map((band) => band.label),
          routeServiceStats.headwaysByTimeBand.map((band) => band.avgHeadwayMinutes ?? 0),
          'Avg headway (min)',
        )
      : null;
  $: supplyChartConfig = routeServiceStats
    ? buildHorizontalBarChartConfig(
        ['Service hours', 'VRH-ish', 'Service km', 'VRK-ish'],
        [
          routeServiceStats.supply.serviceHoursApprox,
          routeServiceStats.supply.vrhApprox,
          routeServiceStats.supply.serviceKmApprox,
          routeServiceStats.supply.vrkApprox,
        ],
        'Supply values',
      )
    : null;
  $: distanceQualityChartConfig =
    routeServiceStats &&
    Object.values(routeServiceStats.methodology.distanceSources).reduce((sum, count) => sum + count, 0) > 0
      ? buildDoughnutChartConfig(
          ['Stop time dist', 'Shape dist', 'Shape geometry', 'Stop geometry', 'Unknown'],
          [
            routeServiceStats.methodology.distanceSources.stop_times_shape_dist,
            routeServiceStats.methodology.distanceSources.shape_dist,
            routeServiceStats.methodology.distanceSources.shape_geometry,
            routeServiceStats.methodology.distanceSources.stop_geometry,
            routeServiceStats.methodology.distanceSources.unknown,
          ],
          'Distance source',
        )
      : null;
  $: hasRouteServiceStatsData = Boolean(
    routeServiceStats &&
      (routeServiceStats.scheduledTrips > 0 ||
        routeServiceStats.spanOfService.firstDeparture ||
        routeServiceStats.spanOfService.lastDeparture ||
        routeServiceStats.stopCoverage.distinctStops > 0 ||
        routeServiceStats.stopCoverage.routeCoverageKm > 0 ||
        routeServiceStats.supply.serviceHoursApprox > 0 ||
        routeServiceStats.supply.serviceKmApprox > 0 ||
        routeServiceStats.supply.vrhApprox > 0 ||
        routeServiceStats.supply.vrkApprox > 0 ||
        routeServiceStats.headwaysByTimeBand.some((band) => (band.tripDepartures ?? 0) > 0 || (band.avgHeadwayMinutes ?? 0) > 0)),
  );

  function zoomModeLabel(zoom: number) {
    if (zoom <= 9) return 'subway + regional + VIA';
    if (zoom <= 12) return 'subway + regional + VIA + rapid transit';
    return 'subway + regional + VIA + rapid transit + bus routes';
  }

  function normalizeColor(route: RouteLine, index: number) {
    if (route.routeColor && /^[a-fA-F0-9]{6}$/.test(route.routeColor)) {
      return `#${route.routeColor}`;
    }
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function parseLineWeight(routeType?: number | null, zoom = currentZoom) {
    if (routeType === 1 || routeType === 2) {
      if (zoom >= 14) return 5.2;
      if (zoom >= 12) return 4.4;
      return 3.5;
    }
    if (routeType === 0) {
      if (zoom >= 14) return 3.8;
      if (zoom >= 12) return 3.3;
      return 3;
    }
    if (routeType === 3) {
      if (zoom >= 14) return 2.3;
      return 2.1;
    }
    return 2.4;
  }

  function parseLineOpacity(routeType?: number | null) {
    if (routeType === 3) return 0.48;
    if (routeType === 1 || routeType === 2) return 0.98;
    return 0.86;
  }

  function drawPriority(routeType?: number | null) {
    if (routeType === 3) return 0;
    if (routeType === 0 || routeType === 4) return 1;
    if (routeType === 1 || routeType === 2) return 2;
    return 1;
  }

  function routeTypeLabel(routeType?: number | null) {
    if (routeType === 0) return 'Tram / Streetcar / LRT';
    if (routeType === 1) return 'Subway / Metro';
    if (routeType === 2) return 'Regional / Intercity Rail';
    if (routeType === 3) return 'Bus';
    if (routeType === 4) return 'Ferry';
    return 'Other';
  }

  function inferVehicleMode(routeType?: number | null, label?: string | null) {
    const hint = (label ?? '').trim().toLowerCase();
    if (routeType === 3 || hint.includes('bus') || hint.includes('coach')) return 'bus';
    if (routeType === 0 || hint.includes('tram') || hint.includes('streetcar') || hint.includes('lrt')) return 'tram';
    if (routeType === 1 || hint.includes('subway') || hint.includes('metro')) return 'subway';
    if (routeType === 2 || hint.includes('rail') || hint.includes('train')) return 'rail';
    if (routeType === 4 || hint.includes('ferry') || hint.includes('boat')) return 'ferry';
    return 'other';
  }

  function vehicleModeIcon(mode: string) {
    if (mode === 'bus') return '🚌';
    if (mode === 'tram') return '🚊';
    if (mode === 'subway') return '🚇';
    if (mode === 'rail') return '🚆';
    if (mode === 'ferry') return '⛴';
    return '📍';
  }

  function vehicleModeLabel(mode: string) {
    if (mode === 'bus') return 'Bus';
    if (mode === 'tram') return 'Tram / Streetcar';
    if (mode === 'subway') return 'Subway / Metro';
    if (mode === 'rail') return 'Rail';
    if (mode === 'ferry') return 'Ferry';
    return 'Vehicle';
  }

  function activeRouteRealtimeLabel() {
    const routeName = routeDetails?.routeShortName || selectedRoute?.routeShortName;
    if (routeName) return routeName;
    const routeLongName = routeDetails?.routeLongName || selectedRoute?.routeLongName;
    if (routeLongName) return routeLongName;
    return routeDetails?.routeId || selectedRoute?.routeId || 'Selected route';
  }

  function formatVehicleBearing(bearing?: number | null) {
    if (typeof bearing !== 'number' || !Number.isFinite(bearing)) return 'n/a';
    const normalized = ((bearing % 360) + 360) % 360;
    return `${Math.round(normalized)}°`;
  }

  function realtimeVehicleTooltipHtml(vehicle: RouteRealtimeVehicle, mode: string) {
    const title = escapeHtml(vehicle.label || vehicle.vehicleId || vehicle.tripId || 'Vehicle');
    const modeDisplay = escapeHtml(vehicleModeLabel(mode));
    const routeDisplay = escapeHtml(activeRouteRealtimeLabel());
    const vehicleId = escapeHtml(vehicle.vehicleId || 'n/a');
    const tripId = escapeHtml(vehicle.tripId || 'n/a');
    const bearing = escapeHtml(formatVehicleBearing(vehicle.bearing));
    const updated = escapeHtml(formatTimeLabel(vehicle.timestamp));
    return `<div class="vehicle-tooltip-card">
      <strong class="vehicle-tooltip-title">${title}</strong>
      <div><span class="vehicle-tooltip-label">Mode:</span> ${modeDisplay}</div>
      <div><span class="vehicle-tooltip-label">Route:</span> ${routeDisplay}</div>
      <div><span class="vehicle-tooltip-label">Vehicle ID:</span> ${vehicleId}</div>
      <div><span class="vehicle-tooltip-label">Trip ID:</span> ${tripId}</div>
      <div><span class="vehicle-tooltip-label">Bearing:</span> ${bearing}</div>
      <div><span class="vehicle-tooltip-label">Updated:</span> ${updated}</div>
    </div>`;
  }

  function formatTimeLabel(value?: string | null) {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatRidershipFromThousands(value?: number | null, options?: { currency?: boolean }) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    const actualValue = value * 1000;
    const absoluteValue = Math.abs(actualValue);
    const units: Array<{ threshold: number; suffix: string }> = [
      { threshold: 1_000_000_000_000, suffix: 'T' },
      { threshold: 1_000_000_000, suffix: 'B' },
      { threshold: 1_000_000, suffix: 'M' },
    ];

    for (const unit of units) {
      if (absoluteValue >= unit.threshold) {
        const scaled = actualValue / unit.threshold;
        const compact = scaled.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        });
        return options?.currency ? `$${compact}${unit.suffix} CAD` : `${compact}${unit.suffix}`;
      }
    }

    const expanded = actualValue.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return options?.currency ? `$${expanded} CAD` : expanded;
  }

  function formatServiceDate(value?: string | null) {
    if (!value || value.length !== 8) return 'today';
    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(4, 6), 10);
    const day = Number.parseInt(value.slice(6, 8), 10);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatCount(value?: number | null) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function formatDecimal(value?: number | null, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function asCssRouteColor(routeColor?: string | null) {
    if (routeColor && /^#?[a-fA-F0-9]{6}$/.test(routeColor)) {
      return routeColor.startsWith('#') ? routeColor : `#${routeColor}`;
    }
    return '#f4d73f';
  }

  function routeKeyFor(line: RouteLine) {
    return `${line.feedVersionId}::${line.routeId}`;
  }

  function lineKey(line: RouteLine) {
    return `${routeKeyFor(line)}::${line.shapeId}`;
  }

  function closeDetails() {
    detailKind = null;
    detailLoading = false;
    detailError = '';
    routeDetails = null;
    routeServiceStats = null;
    routeRealtime = null;
    agencyRealtimeHealth = null;
    stopDetails = null;
    stopRealtime = null;
    corridorDetailRoutes = [];
    canReturnToCorridor = false;
    selectedStop = null;
    selectedRoute = null;
    selectedRouteKey = null;
    clearSelectedRouteStopOverlay();
    detailsAbort?.abort();
    routeRealtimeAbort?.abort();
    clearRealtimeVehicleMarkers();
    initializeAnimationPaths(latestVisibleLines);
    applySelectionStyles();
    pendingRouteScrollStopId = null;
    clearSidebarStopHover();
  }

  function stopSelectionKey(feedVersionId: string, stopId: string) {
    return `${feedVersionId}::${stopId}`;
  }

  function routeIncludesStop(route: RouteDetails | null, stopId: string) {
    return route?.routePath?.stops?.some((routeStop) => routeStop.stopId === stopId) === true;
  }

  function selectorEscape(value: string) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/"/g, '\\"');
  }

  function clearSidebarStopHover() {
    hoveredSidebarStopKey = null;
    if (highlightedSidebarStopMarker) {
      const baseStyle = highlightedSidebarStopMarker.__baseStopStyle ?? {
        radius: BASE_STOP_MARKER_RADIUS,
        color: '#f8fafc',
        weight: 1,
        fillColor: '#f8fafc',
        fillOpacity: 0.88,
        opacity: 0.9,
      };
      highlightedSidebarStopMarker.setStyle(baseStyle);
      highlightedSidebarStopMarker = null;
    }
  }

  function applySidebarStopHover(stopKeyValue: string | null) {
    if (stopKeyValue === hoveredSidebarStopKey) return;
    clearSidebarStopHover();
    hoveredSidebarStopKey = stopKeyValue;
    if (!stopKeyValue) return;
    const marker = visibleStopMarkersByKey.get(stopKeyValue);
    if (!marker) return;
    marker.setStyle({
      radius: HOVER_STOP_MARKER_RADIUS,
      color: '#fde047',
      weight: 1.6,
      fillColor: '#facc15',
      fillOpacity: 0.98,
      opacity: 1,
    });
    marker.bringToFront();
    highlightedSidebarStopMarker = marker;
  }

  function stopPointForRouteStopId(stopId: string) {
    const feedVersionId = routeDetails?.feedVersionId ?? selectedRoute?.feedVersionId;
    if (!feedVersionId) return null;
    const key = stopSelectionKey(feedVersionId, stopId);
    const cached = cachedStopsByKey.get(key);
    if (cached) return cached;
    return latestVisibleStops.find((stop) => stop.feedVersionId === feedVersionId && stop.stopId === stopId) ?? null;
  }

  async function resolveRouteStopCoordinates(stopId: string) {
    const local = stopPointForRouteStopId(stopId);
    if (local) return { lat: local.stopLat, lon: local.stopLon };
    const feedVersionId = routeDetails?.feedVersionId ?? selectedRoute?.feedVersionId;
    if (!feedVersionId) return null;
    const key = stopSelectionKey(feedVersionId, stopId);
    const cached = routeStopLocationCache.get(key);
    if (cached) return cached;
    try {
      const result = await graphqlRequest<{ mapStopDetails: StopDetails | null }>(
        fetch,
        `query MapRouteStopCoordinates($feedVersionId: String!, $stopId: String!) {
          mapStopDetails(feedVersionId: $feedVersionId, stopId: $stopId)
        }`,
        { feedVersionId, stopId },
      );
      const lat = result.mapStopDetails?.stopLat;
      const lon = result.mapStopDetails?.stopLon;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }
      const coords = { lat, lon };
      routeStopLocationCache.set(key, coords);
      return coords;
    } catch (err) {
      console.warn('Unable to load route stop coordinates', err);
      return null;
    }
  }

  function onRouteStopRowHover(stopId: string | null) {
    if (!stopId) {
      applySidebarStopHover(null);
      return;
    }
    const stopPoint = stopPointForRouteStopId(stopId);
    if (!stopPoint) {
      applySidebarStopHover(null);
      return;
    }
    applySidebarStopHover(stopKey(stopPoint));
  }

  function sidebarOcclusionWidthPx() {
    if (!sidebarEl) return 0;
    return sidebarEl.getBoundingClientRect().width;
  }

  function isPointVisibleWithSidebar(point: { x: number; y: number }) {
    if (!map) return true;
    const mapSize = map.getSize();
    const sidebarWidth = sidebarOcclusionWidthPx();
    const horizontalPadding = 18;
    const verticalPadding = 18;
    const minX = sidebarWidth + horizontalPadding;
    const maxX = mapSize.x - horizontalPadding;
    const minY = verticalPadding;
    const maxY = mapSize.y - verticalPadding;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  async function centerMapOnRouteStopIfOffscreen(stopId: string) {
    if (!map) return;
    const coords = await resolveRouteStopCoordinates(stopId);
    if (!coords) return;
    const targetLatLng = L.latLng(coords.lat, coords.lon);
    const pointNow = map.latLngToContainerPoint(targetLatLng);
    if (isPointVisibleWithSidebar(pointNow)) return;
    const currentZoom = map.getZoom();
    const sidebarOffsetX = sidebarOcclusionWidthPx() / 2;
    const targetProjected = map.project(targetLatLng, currentZoom);
    const adjustedCenterProjected = L.point(targetProjected.x - sidebarOffsetX, targetProjected.y);
    const adjustedCenter = map.unproject(adjustedCenterProjected, currentZoom);
    map.flyTo(adjustedCenter, currentZoom, {
      duration: 0.65,
      easeLinearity: 0.25,
    });
  }

  async function scrollRouteStopIntoView(stopId: string) {
    await tick();
    if (!routeStopListEl) return false;
    const target = routeStopListEl.querySelector(`[data-stop-id="${selectorEscape(stopId)}"]`) as HTMLElement | null;
    if (!target) return false;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  async function loadRouteDetails(summary: RouteSummary) {
    const routeKey = summary.key;
    detailKind = 'route';
    routeDetails = null;
    routeServiceStats = null;
    routeRealtime = null;
    agencyRealtimeHealth = null;
    stopDetails = null;
    stopRealtime = null;
    detailError = '';
    detailLoading = true;
    const selectedStopId = selectedStop?.stopId ?? null;
    selectedStop = null;
    if (selectedStopId) {
      pendingRouteScrollStopId = selectedStopId;
    }
    const cached = routeDetailsCache.get(routeKey);
    if (cached) {
      routeDetails = cached.routeDetails;
      routeServiceStats = cached.routeServiceStats;
      routeRealtime = cached.routeRealtime;
      agencyRealtimeHealth = cached.agencyRealtimeHealth;
      detailLoading = false;
      syncRealtimeVehicleMarkers();
      initializeAnimationPaths(latestVisibleLines);
      void ensureSelectedRouteStopsVisible(summary, routeDetails);
      if (pendingRouteScrollStopId) {
        const scrolled = await scrollRouteStopIntoView(pendingRouteScrollStopId);
        if (scrolled) pendingRouteScrollStopId = null;
      }
      return;
    }
    const requestId = ++activeDetailRequestId;
    detailsAbort?.abort();
    detailsAbort = new AbortController();
    const abortSignal = detailsAbort.signal;
    try {
      const result = await graphqlRequest<{
        mapRouteDetails: RouteDetails | null;
        mapRouteServiceStats: RouteServiceStats | null;
        mapRouteRealtime: RouteRealtime | null;
        agencyRealtimeHealth: AgencyRealtimeHealth | null;
      }>(
        (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: abortSignal,
          }),
        `query MapRouteDetails($feedVersionId: String!, $routeId: String!, $agencySlug: String!) {
          mapRouteDetails(feedVersionId: $feedVersionId, routeId: $routeId)
          mapRouteServiceStats(feedVersionId: $feedVersionId, routeId: $routeId)
          mapRouteRealtime(feedVersionId: $feedVersionId, routeId: $routeId, agencySlug: $agencySlug)
          agencyRealtimeHealth(slug: $agencySlug)
        }`,
        {
          feedVersionId: summary.feedVersionId,
          routeId: summary.routeId,
          agencySlug: summary.agencySlug ?? '',
        },
      );
      if (requestId !== activeDetailRequestId) return;
      routeDetails = result.mapRouteDetails ?? null;
      routeServiceStats = result.mapRouteServiceStats ?? null;
      routeRealtime = result.mapRouteRealtime ?? null;
      agencyRealtimeHealth = result.agencyRealtimeHealth ?? null;
      routeDetailsCache.set(routeKey, {
        routeDetails,
        routeServiceStats,
        routeRealtime,
        agencyRealtimeHealth,
      });
      syncRealtimeVehicleMarkers();
      initializeAnimationPaths(latestVisibleLines);
      void ensureSelectedRouteStopsVisible(summary, routeDetails);
      if (!routeDetails) {
        detailError = 'No additional route details found.';
      } else if (pendingRouteScrollStopId) {
        const scrolled = await scrollRouteStopIntoView(pendingRouteScrollStopId);
        if (scrolled) pendingRouteScrollStopId = null;
      }
    } catch (err) {
      if (abortSignal.aborted) return;
      detailError = err instanceof Error ? err.message : 'Failed to load route details';
    } finally {
      if (requestId === activeDetailRequestId) {
        detailLoading = false;
      }
    }
  }

  async function loadStopDetails(stop: StopPoint) {
    if (!stop.stopId) return;
    if (detailKind === 'stop' && selectedStop?.feedVersionId === stop.feedVersionId && selectedStop.stopId === stop.stopId) {
      return;
    }
    if (
      detailKind === 'route' &&
      selectedRoute?.feedVersionId === stop.feedVersionId &&
      routeIncludesStop(routeDetails, stop.stopId)
    ) {
      selectedStop = stop;
      pendingRouteScrollStopId = stop.stopId;
      const scrolled = await scrollRouteStopIntoView(stop.stopId);
      if (scrolled) pendingRouteScrollStopId = null;
      return;
    }
    const stopKey = stopSelectionKey(stop.feedVersionId, stop.stopId);
    detailKind = 'stop';
    selectedStop = stop;
    selectedRoute = null;
    selectedRouteKey = null;
    clearSelectedRouteStopOverlay();
    applySelectionStyles();
    clearRealtimeVehicleMarkers();
    routeDetails = null;
    routeServiceStats = null;
    routeRealtime = null;
    agencyRealtimeHealth = null;
    stopDetails = null;
    stopRealtime = null;
    corridorDetailRoutes = [];
    canReturnToCorridor = false;
    detailError = '';
    detailLoading = true;
    const cached = stopDetailsCache.get(stopKey);
    if (cached) {
      stopDetails = cached.stopDetails;
      stopRealtime = cached.stopRealtime;
      agencyRealtimeHealth = cached.agencyRealtimeHealth;
      detailLoading = false;
      if (!stopDetails) {
        detailError = 'No additional stop details found.';
      }
      return;
    }
    const requestId = ++activeDetailRequestId;
    detailsAbort?.abort();
    detailsAbort = new AbortController();
    const abortSignal = detailsAbort.signal;
    try {
      const result = await graphqlRequest<{
        mapStopDetails: StopDetails | null;
        mapStopRealtime: StopRealtime | null;
        agencyRealtimeHealth: AgencyRealtimeHealth | null;
      }>(
        (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: abortSignal,
          }),
        `query MapStopDetails($feedVersionId: String!, $stopId: String!, $agencySlug: String!) {
          mapStopDetails(feedVersionId: $feedVersionId, stopId: $stopId)
          mapStopRealtime(feedVersionId: $feedVersionId, stopId: $stopId, agencySlug: $agencySlug)
          agencyRealtimeHealth(slug: $agencySlug)
        }`,
        {
          feedVersionId: stop.feedVersionId,
          stopId: stop.stopId,
          agencySlug: stop.agencySlug ?? '',
        },
      );
      if (requestId !== activeDetailRequestId) return;
      stopDetails = result.mapStopDetails ?? null;
      stopRealtime = result.mapStopRealtime ?? null;
      agencyRealtimeHealth = result.agencyRealtimeHealth ?? null;
      stopDetailsCache.set(stopKey, {
        stopDetails,
        stopRealtime,
        agencyRealtimeHealth,
      });
      if (!stopDetails) {
        detailError = 'No additional stop details found.';
      }
    } catch (err) {
      if (abortSignal.aborted) return;
      detailError = err instanceof Error ? err.message : 'Failed to load stop details';
    } finally {
      if (requestId === activeDetailRequestId) {
        detailLoading = false;
      }
    }
  }

  function mergeLines(primary: RouteLine[], secondary: RouteLine[]) {
    const merged = new Map<string, RouteLine>();
    for (const line of primary) {
      merged.set(lineKey(line), line);
    }
    for (const line of secondary) {
      merged.set(lineKey(line), line);
    }
    return [...merged.values()];
  }

  function applySelectionStyles() {
    if (!routeLayer) return;
  const selectedLayers: any[] = [];
    routeLayer.eachLayer((layer: any) => {
      if (typeof layer?.setStyle !== 'function') return;
      const routeKey = layer.__routeKey ?? null;
      const isSelected = selectedRouteKey && routeKey ? routeKey === selectedRouteKey : false;
      const baseWeight = layer.__baseWeight ?? 2.1;
      const isNeutralLayer = routeKey === null;
      layer.setStyle({
        weight: isSelected ? baseWeight + 2.2 : baseWeight,
        opacity: selectedRouteKey ? (isSelected ? 1 : isNeutralLayer ? 0.55 : 0.16) : 0.9,
      });
    if (isSelected) {
      selectedLayers.push(layer);
    }
    });
  for (const layer of selectedLayers) {
    if (typeof layer?.bringToFront === 'function') {
      layer.bringToFront();
    }
  }
  }

  function easeInOutSine(progress: number) {
    return -(Math.cos(Math.PI * progress) - 1) / 2;
  }

  function clearAnimationMarkers() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    for (const routeState of animatedRouteStates) {
      if (animationLayer && routeState.marker) {
        animationLayer.removeLayer(routeState.marker);
      }
    }
    animatedRouteStates = [];
  }

  function fadeOutRouteGeometry() {
    if (!routeLayer) return;
    const staleLayers: any[] = [];
    routeLayer.eachLayer((layer: any) => {
      staleLayers.push(layer);
      if (typeof layer?.setStyle === 'function') {
        layer.setStyle({ opacity: 0 });
      } else {
        routeLayer.removeLayer(layer);
      }
    });
    if (staleLayers.length === 0) return;
    window.setTimeout(() => {
      if (!routeLayer) return;
      for (const layer of staleLayers) {
        if (typeof routeLayer.hasLayer === 'function' && routeLayer.hasLayer(layer)) {
          routeLayer.removeLayer(layer);
        }
      }
    }, ROUTE_GEOMETRY_FADE_MS);
  }

  function clearRealtimeVehicleMarkers() {
    if (!realtimeVehicleLayer) return;
    realtimeVehicleLayer.clearLayers();
  }

  function realtimeVehicleCount() {
    const vehicles = routeRealtime?.vehicles ?? [];
    return vehicles.filter(
      (vehicle) =>
        typeof vehicle?.latitude === 'number' &&
        Number.isFinite(vehicle.latitude) &&
        typeof vehicle?.longitude === 'number' &&
        Number.isFinite(vehicle.longitude),
    ).length;
  }

  function selectedRouteLinesInView() {
    if (!selectedRouteKey) return [];
    return latestVisibleLines.filter((line) => routeKeyFor(line) === selectedRouteKey && line.points.length >= 2);
  }

  function vehicleDistanceToRoutePixels(lat: number, lon: number, routeLines: RouteLine[]) {
    if (!map || routeLines.length === 0) return Number.POSITIVE_INFINITY;
    const vehiclePoint = map.latLngToContainerPoint([lat, lon]);
    let minDistance = Number.POSITIVE_INFINITY;
    for (const line of routeLines) {
      const pathPixels = line.points.map((point) => map.latLngToContainerPoint([point[0], point[1]]));
      for (let index = 1; index < pathPixels.length; index += 1) {
        const { distancePixels } = distancePointToSegmentInPixels(vehiclePoint, pathPixels[index - 1], pathPixels[index]);
        if (distancePixels < minDistance) minDistance = distancePixels;
        if (minDistance <= VEHICLE_ROUTE_DISTANCE_THRESHOLD_PIXELS) return minDistance;
      }
    }
    return minDistance;
  }

  function syncRealtimeVehicleMarkers() {
    clearRealtimeVehicleMarkers();
    if (!realtimeVehicleLayer || !selectedRouteKey) return;
    const vehicles = routeRealtime?.vehicles ?? [];
    const routeAccent = asCssRouteColor(routeDetails?.routeColor ?? selectedRoute?.routeColor);
    const routeAccentText = contrastColor(routeAccent);
    const routeLines = selectedRouteLinesInView();
    const geolocatedVehicles = vehicles.filter(
      (vehicle) =>
        typeof vehicle?.latitude === 'number' &&
        Number.isFinite(vehicle.latitude) &&
        typeof vehicle?.longitude === 'number' &&
        Number.isFinite(vehicle.longitude),
    );
    const spatiallyFiltered =
      routeLines.length > 0
        ? geolocatedVehicles.filter(
            (vehicle) =>
              vehicleDistanceToRoutePixels(vehicle.latitude as number, vehicle.longitude as number, routeLines) <=
              VEHICLE_ROUTE_DISTANCE_THRESHOLD_PIXELS,
          )
        : geolocatedVehicles;
    const markersToRender = spatiallyFiltered.length > 0 ? spatiallyFiltered : geolocatedVehicles;
    for (const vehicle of markersToRender) {
      const lat = vehicle?.latitude;
      const lon = vehicle?.longitude;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const mode = inferVehicleMode(routeDetails?.routeType ?? selectedRoute?.routeType, vehicle.label);
      const icon = L.divIcon({
        className: 'vehicle-icon-shell',
        html: `<div class="vehicle-marker vehicle-marker--${mode}" style="--vehicle-color:${escapeHtml(routeAccent)};--vehicle-text:${escapeHtml(routeAccentText)}"><span class="vehicle-marker__glyph">${vehicleModeIcon(mode)}</span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        tooltipAnchor: [0, -12],
      });
      const marker = L.marker([lat, lon], {
        icon,
        keyboard: false,
        pane: REALTIME_VEHICLE_PANE,
      });
      marker.bindTooltip(realtimeVehicleTooltipHtml(vehicle, mode), {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.95,
        sticky: true,
        className: 'vehicle-tooltip',
      });
      realtimeVehicleLayer.addLayer(marker);
    }
  }

  function distancePointToSegmentInPixels(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const abX = end.x - start.x;
    const abY = end.y - start.y;
    const apX = point.x - start.x;
    const apY = point.y - start.y;
    const abLengthSq = abX * abX + abY * abY;
    const tUnclamped = abLengthSq > 0 ? (apX * abX + apY * abY) / abLengthSq : 0;
    const t = Math.max(0, Math.min(1, tUnclamped));
    const projX = start.x + abX * t;
    const projY = start.y + abY * t;
    const dx = point.x - projX;
    const dy = point.y - projY;
    return { distancePixels: Math.sqrt(dx * dx + dy * dy), t };
  }

  function buildSegmentPixelDistances(points: [number, number][]) {
    if (!map || points.length < 2) return [];
    const latLngs = points.map((point) => L.latLng(point[0], point[1]));
    const pixelPoints = latLngs.map((latLng) => map.latLngToContainerPoint(latLng));
    const segmentPixelDistances = [0];
    for (let i = 1; i < pixelPoints.length; i += 1) {
      const segmentLength = pixelPoints[i - 1].distanceTo(pixelPoints[i]);
      segmentPixelDistances.push(segmentPixelDistances[i - 1] + segmentLength);
    }
    return segmentPixelDistances;
  }

  function deriveStopDistancesOnPath(
    points: [number, number][],
    segmentPixelDistances: number[],
    totalPixelDistance: number,
    stops: StopPoint[],
  ) {
    if (!map || points.length < 2 || stops.length === 0) return [];

    const latitudes = points.map((point) => point[0]);
    const longitudes = points.map((point) => point[1]);
    const minLat = Math.min(...latitudes) - 0.004;
    const maxLat = Math.max(...latitudes) + 0.004;
    const minLon = Math.min(...longitudes) - 0.004;
    const maxLon = Math.max(...longitudes) + 0.004;
    const nearbyStops = stops.filter(
      (stop) =>
        stop.stopLat >= minLat &&
        stop.stopLat <= maxLat &&
        stop.stopLon >= minLon &&
        stop.stopLon <= maxLon,
    );
    if (nearbyStops.length === 0) return [];

    const latLngs = points.map((point) => L.latLng(point[0], point[1]));
    const pathPixels = latLngs.map((latLng) => map.latLngToContainerPoint(latLng));
    const stopSnapThresholdPixels = 14;
    const candidateDistances: number[] = [];

    for (const stop of nearbyStops) {
      const stopPixel = map.latLngToContainerPoint(L.latLng(stop.stopLat, stop.stopLon));
      let bestDistancePixels = Number.POSITIVE_INFINITY;
      let bestDistanceAlongPath = -1;
      for (let i = 1; i < pathPixels.length; i += 1) {
        const projection = distancePointToSegmentInPixels(stopPixel, pathPixels[i - 1], pathPixels[i]);
        if (projection.distancePixels < bestDistancePixels) {
          const segmentLength = segmentPixelDistances[i] - segmentPixelDistances[i - 1];
          bestDistancePixels = projection.distancePixels;
          bestDistanceAlongPath =
            segmentPixelDistances[i - 1] + Math.max(0, Math.min(1, projection.t)) * segmentLength;
        }
      }
      if (bestDistancePixels <= stopSnapThresholdPixels && bestDistanceAlongPath > 0) {
        candidateDistances.push(bestDistanceAlongPath);
      }
    }

    candidateDistances.sort((a, b) => a - b);
    const dedupedDistances: number[] = [];
    const dedupeGapPixels = 18;
    for (const distance of candidateDistances) {
      if (distance >= totalPixelDistance - 1) continue;
      const previous = dedupedDistances[dedupedDistances.length - 1];
      if (previous === undefined || distance - previous >= dedupeGapPixels) {
        dedupedDistances.push(distance);
      }
    }
    return dedupedDistances;
  }

  function buildAnimationPhases(stopPixelDistances: number[], totalPixelDistance: number) {
    if (totalPixelDistance <= 0) return { phases: [], cycleDurationMs: 0 };
    const anchors = [0, ...stopPixelDistances, totalPixelDistance];
    const phases: Array<
      | { kind: 'move'; startDistance: number; endDistance: number; durationMs: number }
      | { kind: 'pause'; distance: number; durationMs: number }
    > = [];
    const pixelsPerSecond = 62;
    const stopPauseMs = 1000;
    for (let i = 1; i < anchors.length; i += 1) {
      const startDistance = anchors[i - 1];
      const endDistance = anchors[i];
      const segmentDistance = Math.max(0, endDistance - startDistance);
      if (segmentDistance > 0) {
        const moveDurationMs = Math.max(700, (segmentDistance / pixelsPerSecond) * 1000);
        phases.push({ kind: 'move', startDistance, endDistance, durationMs: moveDurationMs });
      }
      if (i < anchors.length - 1) {
        phases.push({ kind: 'pause', distance: endDistance, durationMs: stopPauseMs });
      }
    }
    return {
      phases,
      cycleDurationMs: phases.reduce((sum, phase) => sum + phase.durationMs, 0),
    };
  }

  function interpolatePointAtDistance(
    points: [number, number][],
    segmentPixelDistances: number[],
    totalPixelDistance: number,
    distanceAlongPath: number,
  ): [number, number] {
    const clampedDistance = Math.max(0, Math.min(distanceAlongPath, totalPixelDistance));
    for (let i = 1; i < segmentPixelDistances.length; i += 1) {
      const segmentStartDistance = segmentPixelDistances[i - 1];
      const segmentEndDistance = segmentPixelDistances[i];
      if (clampedDistance <= segmentEndDistance) {
        const segmentLength = segmentEndDistance - segmentStartDistance;
        if (segmentLength <= 0) return points[i];
        const localT = (clampedDistance - segmentStartDistance) / segmentLength;
        const [startLat, startLon] = points[i - 1];
        const [endLat, endLon] = points[i];
        return [startLat + (endLat - startLat) * localT, startLon + (endLon - startLon) * localT];
      }
    }
    return points[points.length - 1];
  }

  function pickRouteAnimationLines(lines: RouteLine[]) {
    const byRoute = new Map<string, RouteLine>();
    for (const line of lines) {
      if (!line.points || line.points.length < 2) continue;
      const routeKey = routeKeyFor(line);
      const existing = byRoute.get(routeKey);
      if (!existing || line.points.length > existing.points.length) {
        byRoute.set(routeKey, line);
      }
    }
    return [...byRoute.values()];
  }

  function seededPhaseOffset(routeKey: string, cycleDurationMs: number) {
    let hash = 0;
    for (let i = 0; i < routeKey.length; i += 1) {
      hash = (hash * 31 + routeKey.charCodeAt(i)) >>> 0;
    }
    const unit = (hash % 10_000) / 10_000;
    return unit * cycleDurationMs;
  }

  function initializeAnimationPaths(lines: RouteLine[]) {
    if (!animateVehicles || !animationLayer || !map) {
      clearAnimationMarkers();
      return;
    }
    if (selectedRouteKey && realtimeVehicleCount() > 0) {
      clearAnimationMarkers();
      return;
    }

    const now = performance.now();
    const phaseProgressByRoute = new Map<string, number>();
    for (const routeState of animatedRouteStates) {
      if (!routeState.routeKey || routeState.cycleDurationMs <= 0) continue;
      const elapsed = Math.max(0, now - routeState.startAt);
      const cycleElapsed = elapsed % routeState.cycleDurationMs;
      phaseProgressByRoute.set(routeState.routeKey, cycleElapsed / routeState.cycleDurationMs);
    }

    clearAnimationMarkers();
    const routeLines = pickRouteAnimationLines(lines);
    for (const line of routeLines) {
      const routeKey = routeKeyFor(line);
      const segmentPixelDistances = buildSegmentPixelDistances(line.points);
      if (segmentPixelDistances.length < 2) continue;
      const totalPixelDistance = segmentPixelDistances[segmentPixelDistances.length - 1] ?? 0;
      if (totalPixelDistance <= 0) continue;
      const stopPixelDistances = deriveStopDistancesOnPath(
        line.points,
        segmentPixelDistances,
        totalPixelDistance,
        latestVisibleStops,
      );
      const { phases, cycleDurationMs } = buildAnimationPhases(stopPixelDistances, totalPixelDistance);
      if (cycleDurationMs <= 0 || phases.length === 0) continue;

      const marker = L.circleMarker(line.points[0], {
        pane: ROUTE_ANIMATION_PANE,
        radius: 5.4,
        color: '#f8fafc',
        weight: 1.3,
        fillColor: asCssRouteColor(line.routeColor),
        fillOpacity: 0.95,
        opacity: 1,
      });
      animationLayer.addLayer(marker);
      const priorProgress = phaseProgressByRoute.get(routeKey);
      const phaseOffsetMs =
        typeof priorProgress === 'number'
          ? priorProgress * cycleDurationMs
          : seededPhaseOffset(routeKey, cycleDurationMs);
      animatedRouteStates.push({
        routeKey,
        marker,
        points: line.points,
        segmentPixelDistances,
        totalPixelDistance,
        phases,
        cycleDurationMs,
        startAt: now - phaseOffsetMs,
      });
    }

    runMarkerAnimation();
  }

  function runMarkerAnimation() {
    if (!animateVehicles || animatedRouteStates.length === 0) return;

    const tick = (timestamp: number) => {
      if (!animateVehicles || animatedRouteStates.length === 0) return;
      for (const routeState of animatedRouteStates) {
        if (!routeState.marker || routeState.cycleDurationMs <= 0 || routeState.phases.length === 0) continue;
        if (!routeState.startAt) routeState.startAt = timestamp;
        const elapsed = (timestamp - routeState.startAt) % routeState.cycleDurationMs;
        let elapsedInPhase = elapsed;
        let distance = routeState.totalPixelDistance;
        for (const phase of routeState.phases) {
          if (elapsedInPhase <= phase.durationMs) {
            if (phase.kind === 'pause') {
              distance = phase.distance;
            } else {
              const linearProgress = Math.max(0, Math.min(1, elapsedInPhase / phase.durationMs));
              const easedProgress = easeInOutSine(linearProgress);
              distance = phase.startDistance + (phase.endDistance - phase.startDistance) * easedProgress;
            }
            break;
          }
          elapsedInPhase -= phase.durationMs;
        }
        const [lat, lon] = interpolatePointAtDistance(
          routeState.points,
          routeState.segmentPixelDistances,
          routeState.totalPixelDistance,
          distance,
        );
        routeState.marker.setLatLng([lat, lon]);
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
  }

  function onToggleVehicleAnimation(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    animateVehicles = target.checked;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VEHICLE_ANIMATION_STORAGE_KEY, animateVehicles ? '1' : '0');
    }
    if (!animateVehicles) {
      clearAnimationMarkers();
      return;
    }
    initializeAnimationPaths(latestVisibleLines);
  }

  async function refreshSelectedRouteRealtime() {
    if (!selectedRoute || detailKind !== 'route') return;
    const requestId = ++activeRealtimeRequestId;
    routeRealtimeAbort?.abort();
    routeRealtimeAbort = new AbortController();
    const abortSignal = routeRealtimeAbort.signal;
    try {
      const result = await graphqlRequest<{
        mapRouteRealtime: RouteRealtime | null;
        agencyRealtimeHealth: AgencyRealtimeHealth | null;
      }>(
        (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: abortSignal,
          }),
        `query MapRouteRealtimeRefresh($feedVersionId: String!, $routeId: String!, $agencySlug: String!) {
          mapRouteRealtime(feedVersionId: $feedVersionId, routeId: $routeId, agencySlug: $agencySlug)
          agencyRealtimeHealth(slug: $agencySlug)
        }`,
        {
          feedVersionId: selectedRoute.feedVersionId,
          routeId: selectedRoute.routeId,
          agencySlug: selectedRoute.agencySlug ?? '',
        },
      );
      if (requestId !== activeRealtimeRequestId) return;
      routeRealtime = result.mapRouteRealtime ?? null;
      agencyRealtimeHealth = result.agencyRealtimeHealth ?? null;
      syncRealtimeVehicleMarkers();
      initializeAnimationPaths(latestVisibleLines);
    } catch (err) {
      if (abortSignal.aborted) return;
      console.warn('Realtime refresh failed', err);
    }
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (!detailKind) return;
    closeDetails();
  }

  function parseMapHash(hashValue: string) {
    const raw = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue;
    if (!raw) return null;
    const [zoomRaw, latRaw, lonRaw] = raw.split('/');
    if (!zoomRaw || !latRaw || !lonRaw) return null;
    const zoom = Number(zoomRaw);
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { zoom, lat, lon };
  }

  function serializeMapHash() {
    if (!map || typeof window === 'undefined') return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !Number.isFinite(zoom)) return;
    const fragment = `${zoom.toFixed(HASH_ZOOM_DECIMALS)}/${center.lat.toFixed(HASH_COORD_DECIMALS)}/${center.lng.toFixed(HASH_COORD_DECIMALS)}`;
    if (window.location.hash === `#${fragment}`) return;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${fragment}`);
  }

  async function detectLocationOrFallback() {
    if (!('geolocation' in navigator)) {
      return TORONTO_CENTER;
    }

    return new Promise<{ lat: number; lon: number }>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({ lat: position.coords.latitude, lon: position.coords.longitude });
        },
        () => {
          resolve(TORONTO_CENTER);
        },
        { enableHighAccuracy: true, timeout: 8000 },
      );
    });
  }

  async function zoomToCity() {
    const query = citySearch.trim();
    if (!query || !map) return;
    citySearchLoading = true;
    citySearchError = '';
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'ca',
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Search service unavailable');
      }
      const matches = (await response.json()) as Array<{
        lat?: string;
        lon?: string;
      }>;
      const firstMatch = matches[0];
      if (!firstMatch?.lat || !firstMatch?.lon) {
        citySearchError = 'No matching city found.';
        return;
      }
      const lat = Number(firstMatch.lat);
      const lon = Number(firstMatch.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        citySearchError = 'Invalid location returned from search.';
        return;
      }
      const targetZoom = Math.max(10, Math.round(map.getZoom()));
      map.flyTo([lat, lon], targetZoom, { duration: 0.85, easeLinearity: 0.25 });
    } catch (err) {
      citySearchError = err instanceof Error ? err.message : 'Unable to find that city.';
    } finally {
      citySearchLoading = false;
    }
  }

  function onCitySearchSubmit(event: SubmitEvent) {
    event.preventDefault();
    void zoomToCity();
  }

  function getViewportBbox() {
    const bounds = map.getBounds();
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    return {
      minLat: southWest.lat,
      minLon: southWest.lng,
      maxLat: northEast.lat,
      maxLon: northEast.lng,
    } satisfies BboxRect;
  }

  function containsBbox(outer: BboxRect, inner: BboxRect) {
    return (
      outer.minLat <= inner.minLat &&
      outer.minLon <= inner.minLon &&
      outer.maxLat >= inner.maxLat &&
      outer.maxLon >= inner.maxLon
    );
  }

  function unionBbox(left: BboxRect, right: BboxRect): BboxRect {
    return {
      minLat: Math.min(left.minLat, right.minLat),
      minLon: Math.min(left.minLon, right.minLon),
      maxLat: Math.max(left.maxLat, right.maxLat),
      maxLon: Math.max(left.maxLon, right.maxLon),
    };
  }

  function bboxCenter(bbox: BboxRect) {
    return {
      lat: (bbox.minLat + bbox.maxLat) / 2,
      lon: (bbox.minLon + bbox.maxLon) / 2,
    };
  }

  function isLargeViewportJump(previous: BboxRect | null, next: BboxRect) {
    if (!previous) return false;
    const prevCenter = bboxCenter(previous);
    const nextCenter = bboxCenter(next);
    const latDelta = Math.abs(prevCenter.lat - nextCenter.lat);
    const lonDelta = Math.abs(prevCenter.lon - nextCenter.lon);
    const latSpan = Math.max(0.0001, previous.maxLat - previous.minLat);
    const lonSpan = Math.max(0.0001, previous.maxLon - previous.minLon);
    return latDelta > latSpan * LARGE_JUMP_RATIO || lonDelta > lonSpan * LARGE_JUMP_RATIO;
  }

  function stopKey(stop: StopPoint) {
    if (stop.stopId) return `${stop.feedVersionId}::${stop.stopId}`;
    return `${stop.feedVersionId}::${stop.stopLat.toFixed(6)}::${stop.stopLon.toFixed(6)}`;
  }

  function mergeLineCache(lines: RouteLine[]) {
    for (const line of lines) {
      cachedLinesByKey.set(lineKey(line), line);
    }
  }

  function mergeStopCache(stops: StopPoint[]) {
    for (const stop of stops) {
      cachedStopsByKey.set(stopKey(stop), stop);
    }
  }

  function mergeCorridorCache(corridors: RouteCorridor[]) {
    for (const corridor of corridors) {
      cachedCorridorsById.set(corridor.corridorId, corridor);
    }
  }

  function clearViewportCaches() {
    coveredBbox = null;
    cacheMode = null;
    cacheMayBeIncomplete = false;
    incrementalPanCount = 0;
    cachedLinesByKey = new Map();
    cachedCorridorsById = new Map();
    cachedStopsByKey = new Map();
  }

  function cachedLinesSnapshot() {
    return [...cachedLinesByKey.values()];
  }

  function cachedCorridorsSnapshot() {
    return [...cachedCorridorsById.values()];
  }

  function cachedStopsSnapshotInBbox(bbox: BboxRect) {
    return [...cachedStopsByKey.values()].filter(
      (stop) =>
        stop.stopLat >= bbox.minLat &&
        stop.stopLat <= bbox.maxLat &&
        stop.stopLon >= bbox.minLon &&
        stop.stopLon <= bbox.maxLon,
    );
  }

  function renderedStopsForViewport(bbox: BboxRect, nextMode: 'corridor' | 'mixed' | 'detailed') {
    const shouldIncludeViewportStops = nextMode !== 'corridor' && currentZoom >= MIN_STOP_RENDER_ZOOM;
    const renderedStopsByKey = new Map<string, StopPoint>();
    if (shouldIncludeViewportStops) {
      for (const stop of cachedStopsSnapshotInBbox(bbox)) {
        renderedStopsByKey.set(stopKey(stop), stop);
      }
    }
    for (const stop of selectedRouteOverlayStopsByKey.values()) {
      renderedStopsByKey.set(stopKey(stop), stop);
    }
    return [...renderedStopsByKey.values()];
  }

  function redrawStopsForCurrentViewport() {
    if (!map) return;
    const viewportBbox = getViewportBbox();
    const activeMode = cacheMode ?? renderMode;
    drawStops(renderedStopsForViewport(viewportBbox, activeMode));
  }

  function clearSelectedRouteStopOverlay(options?: { redraw?: boolean }) {
    activeRouteStopOverlayRequestId += 1;
    if (selectedRouteOverlayStopsByKey.size === 0 && options?.redraw !== true) return;
    selectedRouteOverlayStopsByKey = new Map();
    if (options?.redraw !== false) {
      redrawStopsForCurrentViewport();
    }
  }

  async function fetchStopPointById(feedVersionId: string, stopId: string, fallbackName?: string | null) {
    const cached = cachedStopsByKey.get(stopSelectionKey(feedVersionId, stopId));
    if (cached) return cached;
    try {
      const result = await graphqlRequest<{ mapStopDetails: StopDetails | null }>(
        fetch,
        `query MapRouteStopMarker($feedVersionId: String!, $stopId: String!) {
          mapStopDetails(feedVersionId: $feedVersionId, stopId: $stopId)
        }`,
        { feedVersionId, stopId },
      );
      const details = result.mapStopDetails;
      if (!details) return null;
      if (typeof details.stopLat !== 'number' || typeof details.stopLon !== 'number') return null;
      const point: StopPoint = {
        feedVersionId,
        stopId,
        stopName: details.stopName ?? fallbackName ?? null,
        stopLat: details.stopLat,
        stopLon: details.stopLon,
        wheelchairBoarding: details.wheelchairBoarding ?? null,
        agencyId: details.agency?.id ?? undefined,
        agencySlug: details.agency?.slug ?? undefined,
        agencyName: details.agency?.displayName ?? undefined,
      };
      routeStopLocationCache.set(stopSelectionKey(feedVersionId, stopId), {
        lat: details.stopLat,
        lon: details.stopLon,
      });
      return point;
    } catch (err) {
      console.warn('Unable to load route stop marker', err);
      return null;
    }
  }

  async function ensureSelectedRouteStopsVisible(summary: RouteSummary, details: RouteDetails | null) {
    const expectedRouteKey = summary.key;
    const requestId = ++activeRouteStopOverlayRequestId;
    const routeStops = details?.routePath?.stops ?? [];
    if (routeStops.length === 0) {
      if (selectedRouteKey === expectedRouteKey) {
        selectedRouteOverlayStopsByKey = new Map();
        redrawStopsForCurrentViewport();
      }
      return;
    }

    const seenStopIds = new Set<string>();
    const missingStops: Array<{ stopId: string; stopName?: string | null }> = [];
    for (const routeStop of routeStops) {
      if (seenStopIds.has(routeStop.stopId)) continue;
      seenStopIds.add(routeStop.stopId);
      const key = stopSelectionKey(summary.feedVersionId, routeStop.stopId);
      if (cachedStopsByKey.has(key) || selectedRouteOverlayStopsByKey.has(key)) continue;
      missingStops.push({
        stopId: routeStop.stopId,
        stopName: routeStop.stopName,
      });
    }

    const fetchedStops = await Promise.all(
      missingStops.map((routeStop) => fetchStopPointById(summary.feedVersionId, routeStop.stopId, routeStop.stopName)),
    );
    if (requestId !== activeRouteStopOverlayRequestId || selectedRouteKey !== expectedRouteKey) return;

    const fetchedByStopId = new Map<string, StopPoint>();
    for (const stop of fetchedStops) {
      if (stop?.stopId) {
        fetchedByStopId.set(stop.stopId, stop);
      }
    }

    const nextOverlayStops = new Map<string, StopPoint>();
    for (const routeStop of routeStops) {
      const key = stopSelectionKey(summary.feedVersionId, routeStop.stopId);
      const resolvedStop =
        cachedStopsByKey.get(key) ?? selectedRouteOverlayStopsByKey.get(key) ?? fetchedByStopId.get(routeStop.stopId);
      if (resolvedStop) {
        nextOverlayStops.set(key, resolvedStop);
      }
    }

    selectedRouteOverlayStopsByKey = nextOverlayStops;
    const fetchedStopPoints = [...fetchedByStopId.values()];
    if (fetchedStopPoints.length > 0) {
      mergeStopCache(fetchedStopPoints);
    }
    redrawStopsForCurrentViewport();
  }

  function subtractBbox(target: BboxRect, covered: BboxRect): BboxRect[] {
    const interMinLat = Math.max(target.minLat, covered.minLat);
    const interMinLon = Math.max(target.minLon, covered.minLon);
    const interMaxLat = Math.min(target.maxLat, covered.maxLat);
    const interMaxLon = Math.min(target.maxLon, covered.maxLon);
    if (interMinLat >= interMaxLat || interMinLon >= interMaxLon) {
      return [target];
    }
    const missing: BboxRect[] = [];
    if (target.minLat < interMinLat) {
      missing.push({
        minLat: target.minLat,
        minLon: target.minLon,
        maxLat: interMinLat,
        maxLon: target.maxLon,
      });
    }
    if (interMaxLat < target.maxLat) {
      missing.push({
        minLat: interMaxLat,
        minLon: target.minLon,
        maxLat: target.maxLat,
        maxLon: target.maxLon,
      });
    }
    if (target.minLon < interMinLon) {
      missing.push({
        minLat: interMinLat,
        minLon: target.minLon,
        maxLat: interMaxLat,
        maxLon: interMinLon,
      });
    }
    if (interMaxLon < target.maxLon) {
      missing.push({
        minLat: interMinLat,
        minLon: interMaxLon,
        maxLat: interMaxLat,
        maxLon: target.maxLon,
      });
    }
    return missing.filter((bbox) => bbox.maxLat > bbox.minLat && bbox.maxLon > bbox.minLon);
  }

  function refreshRouteSummaries(lines: RouteLine[]) {
    routeSummaries = new Map();
    const sortedLines = [...lines].sort((a, b) => drawPriority(a.routeType) - drawPriority(b.routeType));
    latestVisibleLines = sortedLines;
    for (const lineData of sortedLines) {
      if (!lineData.points || lineData.points.length < 2) continue;
      const routeKey = routeKeyFor(lineData);
      const existingSummary = routeSummaries.get(routeKey);
      if (!existingSummary) {
        routeSummaries.set(routeKey, {
          key: routeKey,
          feedVersionId: lineData.feedVersionId,
          routeId: lineData.routeId,
          routeShortName: lineData.routeShortName,
          routeLongName: lineData.routeLongName,
          routeType: lineData.routeType,
          routeColor: lineData.routeColor,
          agencyName: lineData.agencyName,
          agencySlug: lineData.agencySlug,
          segmentCount: 1,
          pointCount: lineData.points.length,
          shapesInView: [lineData.shapeId],
        });
      } else {
        existingSummary.segmentCount += 1;
        existingSummary.pointCount += lineData.points.length;
        if (!existingSummary.shapesInView.includes(lineData.shapeId)) {
          existingSummary.shapesInView.push(lineData.shapeId);
        }
      }
    }
  }

  function chooseRenderMode(nextMode: 'corridor' | 'mixed' | 'detailed', zoom: number) {
    if (nextMode === renderMode) {
      lastModeShiftZoom = zoom;
      return renderMode;
    }
    if (Math.abs(zoom - lastModeShiftZoom) < MODE_HYSTERESIS_ZOOM) {
      return renderMode;
    }
    renderMode = nextMode;
    lastModeShiftZoom = zoom;
    return renderMode;
  }

  function contrastColor(hex: string) {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) return '#f8fafc';
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.62 ? '#0f172a' : '#f8fafc';
  }

  function offsetPolyline(points: [number, number][], offsetPixels: number) {
    if (!map || Math.abs(offsetPixels) < 0.01 || points.length < 2) return points;
    const layerPoints = points.map((point) => map.latLngToLayerPoint([point[0], point[1]]));
    const shiftedPoints = layerPoints.map((point, index) => {
      let normalX = 0;
      let normalY = 0;
      let contributors = 0;
      if (index > 0) {
        const prev = layerPoints[index - 1];
        const dx = point.x - prev.x;
        const dy = point.y - prev.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.0001) {
          normalX += -dy / len;
          normalY += dx / len;
          contributors += 1;
        }
      }
      if (index < layerPoints.length - 1) {
        const next = layerPoints[index + 1];
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.0001) {
          normalX += -dy / len;
          normalY += dx / len;
          contributors += 1;
        }
      }
      if (contributors === 0) return point;
      const len = Math.hypot(normalX, normalY);
      if (len < 0.0001) return point;
      return L.point(point.x + (normalX / len) * offsetPixels, point.y + (normalY / len) * offsetPixels);
    });
    return shiftedPoints.map((point) => {
      const latLng = map.layerPointToLatLng(point);
      return [latLng.lat, latLng.lng] as [number, number];
    });
  }

  function routeRibbonSlot(index: number) {
    if (index === 0) return 0;
    const step = Math.floor((index + 1) / 2);
    return index % 2 === 1 ? step : -step;
  }

  function escapeHtml(value?: string | null) {
    if (!value) return '';
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function routeLabel(routeRef: CorridorRouteRef) {
    return routeRef.routeShortName || routeRef.routeLongName || routeRef.routeId;
  }

  function routeKeyFromRef(routeRef: CorridorRouteRef) {
    return `${routeRef.feedVersionId}::${routeRef.routeId}`;
  }

  function dedupeRouteRefsForDisplay(routeRefs: CorridorRouteRef[]) {
    const unique = new Map<string, CorridorRouteRef>();
    for (const routeRef of routeRefs) {
      const key = `${routeLabel(routeRef).trim().toLowerCase()}::${(routeRef.agencyName ?? '').trim().toLowerCase()}`;
      if (!unique.has(key)) {
        unique.set(key, routeRef);
      }
    }
    return [...unique.values()];
  }

  function collectNearbyCorridorRoutes(corridors: RouteCorridor[], lat: number, lon: number, thresholdPixels = 10) {
    if (!map) return [];
    const clickPoint = map.latLngToContainerPoint([lat, lon]);
    const nearby: CorridorRouteRef[] = [];
    for (const corridor of corridors) {
      if (!corridor.points || corridor.points.length < 2) continue;
      const pathPixels = corridor.points.map((point) => map.latLngToContainerPoint([point[0], point[1]]));
      let minDistance = Number.POSITIVE_INFINITY;
      for (let index = 1; index < pathPixels.length; index += 1) {
        const { distancePixels } = distancePointToSegmentInPixels(clickPoint, pathPixels[index - 1], pathPixels[index]);
        if (distancePixels < minDistance) minDistance = distancePixels;
        if (minDistance <= thresholdPixels) break;
      }
      if (minDistance <= thresholdPixels) {
        nearby.push(...corridor.routeRefs);
      }
    }
    return dedupeRouteRefsForDisplay(nearby).sort((a, b) => {
      const byType = drawPriority(a.routeType) - drawPriority(b.routeType);
      if (byType !== 0) return byType;
      return `${routeLabel(a)} ${a.agencyName ?? ''}`.localeCompare(`${routeLabel(b)} ${b.agencyName ?? ''}`);
    });
  }

  function corridorPopupHtml(routeRefs: CorridorRouteRef[]) {
    const displayRoutes = dedupeRouteRefsForDisplay(routeRefs);
    if (displayRoutes.length === 0) {
      return '<strong>No route metadata found</strong>';
    }
    const noun = displayRoutes.length === 1 ? 'route' : 'routes';
    const preview = displayRoutes.slice(0, 12);
    const extraCount = displayRoutes.length - preview.length;
    const routesList = preview
      .map((routeRef) => {
        const label = escapeHtml(routeLabel(routeRef));
        const agency = escapeHtml(routeRef.agencyName ?? '');
        return `<li><strong>${label}</strong>${agency ? ` <span style="opacity:0.8">(${agency})</span>` : ''}</li>`;
      })
      .join('');
    return `<strong>${displayRoutes.length} ${noun} on this corridor</strong><ol style="margin:6px 0 0 1rem;padding:0;max-width:20rem">${routesList}</ol>${
      extraCount > 0 ? `<div style="margin-top:4px;opacity:0.85">+${extraCount} more</div>` : ''
    }`;
  }

  function openCorridorDetails(routeRefs: CorridorRouteRef[]) {
    const displayRoutes = dedupeRouteRefsForDisplay(routeRefs).sort((a, b) => {
      const byType = drawPriority(a.routeType) - drawPriority(b.routeType);
      if (byType !== 0) return byType;
      return `${routeLabel(a)} ${a.agencyName ?? ''}`.localeCompare(`${routeLabel(b)} ${b.agencyName ?? ''}`);
    });
    if (displayRoutes.length <= 1) {
      if (displayRoutes.length === 1) {
        handleRouteSelection(routeKeyFromRef(displayRoutes[0]));
      }
      return;
    }
    detailKind = 'corridor';
    detailLoading = false;
    detailError = '';
    routeDetails = null;
    routeServiceStats = null;
    stopDetails = null;
    selectedStop = null;
    corridorDetailRoutes = displayRoutes;
    canReturnToCorridor = false;
  }

  function nearestRouteKeyAt(lat: number, lon: number, thresholdPixels = 16) {
    if (!map || latestVisibleLines.length === 0) return null;
    const clickPoint = map.latLngToContainerPoint([lat, lon]);
    let bestRouteKey: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const line of latestVisibleLines) {
      if (!line.points || line.points.length < 2) continue;
      const pathPixels = line.points.map((point) => map.latLngToContainerPoint([point[0], point[1]]));
      for (let index = 1; index < pathPixels.length; index += 1) {
        const { distancePixels } = distancePointToSegmentInPixels(clickPoint, pathPixels[index - 1], pathPixels[index]);
        if (distancePixels < bestDistance) {
          bestDistance = distancePixels;
          bestRouteKey = routeKeyFor(line);
        }
        if (bestDistance <= thresholdPixels) break;
      }
      if (bestDistance <= thresholdPixels) break;
    }
    return bestDistance <= thresholdPixels ? bestRouteKey : null;
  }

  function openCorridorDetailsFromClick(routeRefs: CorridorRouteRef[], lat: number, lon: number) {
    const displayRoutes = dedupeRouteRefsForDisplay(routeRefs);
    if (displayRoutes.length > 0) {
      openCorridorDetails(displayRoutes);
      return;
    }
    const fallbackRouteKey = nearestRouteKeyAt(lat, lon, currentZoom >= 15 ? 18 : 14);
    if (fallbackRouteKey) {
      handleRouteSelection(fallbackRouteKey);
    }
  }

  function handleRouteSelection(routeKey: string, options?: { fromCorridor?: boolean }) {
    if (selectedRouteKey === routeKey && detailKind === 'route' && routeDetails) {
      if (pendingRouteScrollStopId) {
        void scrollRouteStopIntoView(pendingRouteScrollStopId).then((scrolled) => {
          if (scrolled) pendingRouteScrollStopId = null;
        });
      }
      return;
    }
    selectedRouteKey = routeKey;
    selectedRoute = routeSummaries.get(routeKey) ?? null;
    pendingRouteScrollStopId = selectedStop?.stopId ?? null;
    selectedStop = null;
    clearSelectedRouteStopOverlay();
    canReturnToCorridor = options?.fromCorridor === true && corridorDetailRoutes.length > 1;
    applySelectionStyles();
    if (selectedRoute) {
      void loadRouteDetails(selectedRoute);
    }
  }

  function backToCorridorTiles() {
    if (corridorDetailRoutes.length === 0) return;
    detailKind = 'corridor';
    detailLoading = false;
    detailError = '';
    routeDetails = null;
    routeServiceStats = null;
    stopDetails = null;
    canReturnToCorridor = false;
  }

  function drawDetailedLines(lines: RouteLine[]) {
    const polylines: any[] = [];
    lines.forEach((lineData, index) => {
      if (!lineData.points || lineData.points.length < 2) return;
      const routeKey = routeKeyFor(lineData);
      const baseWeight = parseLineWeight(lineData.routeType, currentZoom);
      const polyline = L.polyline(lineData.points, {
        pane: ROUTE_GEOMETRY_PANE,
        color: normalizeColor(lineData, index),
        weight: baseWeight,
        opacity: 0,
        className: 'route-geometry',
        lineCap: 'round',
        lineJoin: 'round',
      });
      polyline.__routeKey = routeKey;
      polyline.__baseWeight = baseWeight;

      const label = lineData.routeShortName || lineData.routeLongName || lineData.routeId;
      polyline.bindPopup(
        `<strong>${label}</strong><br/>${lineData.agencyName ?? 'Unknown agency'}<br/>` +
          `${routeTypeLabel(lineData.routeType)}`,
      );
      polyline.on('click', (event: any) => {
        if (event?.originalEvent) {
          L.DomEvent.stopPropagation(event.originalEvent);
        }
        handleRouteSelection(routeKey);
      });
      routeLayer.addLayer(polyline);
      polylines.push(polyline);
    });
    return polylines;
  }

  function drawCorridors(corridors: RouteCorridor[]) {
    const rendered: any[] = [];
    // Draw low-density corridors first so high-overlap corridors sit on top for clicks.
    const sortedCorridors = [...corridors].sort((a, b) => a.routeCount - b.routeCount);
    for (const corridor of sortedCorridors) {
      if (!corridor.points || corridor.points.length < 2) continue;
      const baseWeight = corridor.routeCount > 1 ? 7.2 : 5.4;
      const casing = L.polyline(corridor.points, {
        pane: ROUTE_GEOMETRY_PANE,
        color: '#020617',
        weight: baseWeight,
        opacity: 0,
        className: 'route-geometry',
        lineCap: 'round',
        lineJoin: 'round',
      });
      casing.__routeKey = null;
      casing.__baseWeight = baseWeight;
      if (corridor.routeRefs.length > 0) casing.bindPopup(corridorPopupHtml(corridor.routeRefs));
      casing.on('click', (event: any) => {
        if (event?.originalEvent) {
          L.DomEvent.stopPropagation(event.originalEvent);
        }
        const clickLat = event?.latlng?.lat ?? corridor.points[0][0];
        const clickLon = event?.latlng?.lng ?? corridor.points[0][1];
        const nearbyRoutes = collectNearbyCorridorRoutes(
          sortedCorridors,
          clickLat,
          clickLon,
        );
        const candidateRoutes = nearbyRoutes.length > 0 ? nearbyRoutes : corridor.routeRefs;
        casing.setPopupContent(corridorPopupHtml(candidateRoutes));
        openCorridorDetailsFromClick(candidateRoutes, clickLat, clickLon);
      });
      routeLayer.addLayer(casing);
      rendered.push(casing);

      const core = L.polyline(corridor.points, {
        pane: ROUTE_GEOMETRY_PANE,
        color: corridor.routeCount > 1 ? '#334155' : '#1e293b',
        weight: Math.max(2.6, baseWeight - 2.4),
        opacity: 0,
        className: 'route-geometry',
        lineCap: 'round',
        lineJoin: 'round',
      });
      core.__routeKey = null;
      core.__baseWeight = Math.max(2.6, baseWeight - 2.4);
      core.on('click', (event: any) => {
        if (event?.originalEvent) {
          L.DomEvent.stopPropagation(event.originalEvent);
        }
        const clickLat = event?.latlng?.lat ?? corridor.points[0][0];
        const clickLon = event?.latlng?.lng ?? corridor.points[0][1];
        const nearbyRoutes = collectNearbyCorridorRoutes(
          sortedCorridors,
          clickLat,
          clickLon,
        );
        openCorridorDetailsFromClick(nearbyRoutes.length > 0 ? nearbyRoutes : corridor.routeRefs, clickLat, clickLon);
      });
      routeLayer.addLayer(core);
      rendered.push(core);

      const ribbons = [...corridor.routeRefs]
        .sort((a, b) => {
          const byType = drawPriority(a.routeType) - drawPriority(b.routeType);
          if (byType !== 0) return byType;
          return `${a.routeShortName ?? ''} ${a.routeLongName ?? ''}`.localeCompare(
            `${b.routeShortName ?? ''} ${b.routeLongName ?? ''}`,
          );
        })
        .slice(0, 6);
      ribbons.forEach((routeRef, index) => {
        const routeKey = `${routeRef.feedVersionId}::${routeRef.routeId}`;
        const offsetPixels = routeRibbonSlot(index) * 2.4;
        const shifted = offsetPolyline(corridor.points, offsetPixels);
        const routeColor = asCssRouteColor(routeRef.routeColor);
        const ribbon = L.polyline(shifted, {
          pane: ROUTE_GEOMETRY_PANE,
          color: routeColor,
          weight: 2.1,
          opacity: 0,
          className: 'route-geometry',
          dashArray: index > 0 && routeColor === asCssRouteColor(ribbons[0]?.routeColor) ? '5 4' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        });
        ribbon.__routeKey = routeKey;
        ribbon.__baseWeight = 2.1;
        ribbon.bindPopup(corridorPopupHtml(corridor.routeRefs));
        ribbon.on('click', (event: any) => {
          if (event?.originalEvent) {
            L.DomEvent.stopPropagation(event.originalEvent);
          }
          const clickLat = event?.latlng?.lat ?? shifted[0][0];
          const clickLon = event?.latlng?.lng ?? shifted[0][1];
          const nearbyRoutes = collectNearbyCorridorRoutes(
            sortedCorridors,
            clickLat,
            clickLon,
          );
          const candidateRoutes = nearbyRoutes.length > 0 ? nearbyRoutes : corridor.routeRefs;
          ribbon.setPopupContent(corridorPopupHtml(candidateRoutes));
          openCorridorDetailsFromClick(candidateRoutes, clickLat, clickLon);
        });
        routeLayer.addLayer(ribbon);
        rendered.push(ribbon);

        if (renderMode === 'corridor' && index === 0 && corridor.routeCount >= 3) {
          const midpoint = shifted[Math.floor(shifted.length / 2)] ?? shifted[0];
          const badge = L.circleMarker(midpoint, {
            pane: ROUTE_GEOMETRY_PANE,
            radius: 6.2,
            color: contrastColor(routeColor),
            weight: 1.4,
            fillColor: routeColor,
            fillOpacity: 0.95,
            opacity: 0.95,
          });
          badge.bindTooltip(`${corridor.routeCount}`, { permanent: true, direction: 'center', className: 'corridor-count' });
          routeLayer.addLayer(badge);
          rendered.push(badge);
        }
      });
    }
    return rendered;
  }

  function drawLines(lines: RouteLine[], corridors: RouteCorridor[], incomingMode: 'corridor' | 'mixed' | 'detailed') {
    fadeOutRouteGeometry();
    refreshRouteSummaries(lines);
    const sortedLines = [...lines].sort((a, b) => drawPriority(a.routeType) - drawPriority(b.routeType));
    const activeMode = chooseRenderMode(incomingMode, currentZoom);
    let renderedLayers: any[] = [];
    if (activeMode === 'detailed') {
      renderedLayers = drawDetailedLines(sortedLines);
    } else {
      renderedLayers = drawCorridors(corridors);
      if (selectedRouteKey) {
        const selectedSegments = sortedLines.filter((line) => routeKeyFor(line) === selectedRouteKey);
        renderedLayers.push(...drawDetailedLines(selectedSegments));
      }
    }

    if (selectedRouteKey && !routeSummaries.has(selectedRouteKey)) {
      selectedRouteKey = null;
      selectedRoute = null;
      clearSelectedRouteStopOverlay({ redraw: false });
    } else if (selectedRouteKey) {
      selectedRoute = routeSummaries.get(selectedRouteKey) ?? null;
    }

    requestAnimationFrame(() => {
      applySelectionStyles();
    });

    if (shouldAutoFitInitialRoutes && !hasLoadedAtLeastOnce && renderedLayers.length > 0) {
      const bounds = L.featureGroup(renderedLayers.filter((layer) => typeof layer.getBounds === 'function')).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.06));
      }
    }
    hasLoadedAtLeastOnce = true;
    initializeAnimationPaths(sortedLines);
  }

  function drawStops(stops: StopPoint[]) {
    if (!stopLayer) return;
    stopLayer.clearLayers();
    visibleStopMarkersByKey = new Map();
    clearSidebarStopHover();
    latestVisibleStops = stops;
    const activeRouteStopAccent = asCssRouteColor(routeDetails?.routeColor ?? selectedRoute?.routeColor);
    for (const stop of stops) {
      const selectionKey = stop.stopId ? stopSelectionKey(stop.feedVersionId, stop.stopId) : null;
      const isSelectedRouteStop = selectionKey ? selectedRouteOverlayStopsByKey.has(selectionKey) : false;
      const markerBaseStyle = {
        pane: ROUTE_STOP_PANE,
        radius: isSelectedRouteStop ? BASE_STOP_MARKER_RADIUS + 0.8 : BASE_STOP_MARKER_RADIUS,
        color: isSelectedRouteStop ? activeRouteStopAccent : '#f8fafc',
        weight: isSelectedRouteStop ? 2 : 1,
        fillColor: '#f8fafc',
        fillOpacity: 0.88,
        opacity: 0.9,
      };
      const marker = L.circleMarker([stop.stopLat, stop.stopLon], markerBaseStyle);
      marker.__baseStopStyle = markerBaseStyle;
      visibleStopMarkersByKey.set(stopKey(stop), marker);
      if (stop.stopName) {
        const stopLabel = stop.wheelchairBoarding === 1 ? `${stop.stopName} ♿` : stop.stopName;
        marker.bindTooltip(stopLabel, { direction: 'top', offset: [0, -2], opacity: 0.9 });
      }
      marker.on('click', (event: any) => {
        if (event?.originalEvent) {
          L.DomEvent.stopPropagation(event.originalEvent);
        }
        if (!stop.stopId) return;
        void loadStopDetails(stop);
      });
      stopLayer.addLayer(marker);
    }
    initializeAnimationPaths(latestVisibleLines);
  }

  async function loadRouteDataFromViewport() {
    if (!map) return;
    const requestStartedAt = performance.now();
    lastRouteLoadStartedAt = requestStartedAt;
    const requestId = ++activeRequestId;
    inFlightAbort?.abort();
    inFlightAbort = new AbortController();
    const abortSignal = inFlightAbort.signal;
    loading = true;
    error = '';
    const nextZoom = Math.round(map.getZoom());
    const activeRouteLimit = routeLimitForZoom(nextZoom);
    const activeShapeLimit = shapeLimitForZoom(nextZoom);
    const viewportBbox = getViewportBbox();
    const fetchTargetBbox = viewportBbox;
    const shouldForceFullReload =
      !coveredBbox ||
      !cacheMode ||
      cacheMayBeIncomplete ||
      nextZoom !== currentZoom ||
      isLargeViewportJump(lastViewportBbox, viewportBbox) ||
      incrementalPanCount >= MAX_INCREMENTAL_PANS;
    currentZoom = nextZoom;
    modeLabel = zoomModeLabel(nextZoom);

    try {
      if (!shouldForceFullReload && !cacheMayBeIncomplete && coveredBbox && containsBbox(coveredBbox, viewportBbox)) {
        lastViewportBbox = viewportBbox;
        modeLabel = `${zoomModeLabel(currentZoom)} | ${cacheMode ?? renderMode}`;
        return;
      }

      let fetchBboxes: BboxRect[] = shouldForceFullReload || !coveredBbox
        ? [fetchTargetBbox]
        : subtractBbox(fetchTargetBbox, coveredBbox);

      if (fetchBboxes.length === 0) {
        lastViewportBbox = viewportBbox;
        modeLabel = `${zoomModeLabel(currentZoom)} | ${cacheMode ?? renderMode}`;
        return;
      }

      if (shouldForceFullReload) {
        clearViewportCaches();
      }

      let resolvedMode: 'corridor' | 'mixed' | 'detailed' | null = cacheMode;
      let routeTotalMs = 0;
      let routeTotalBytes = 0;
      let stopTotalMs = 0;
      let stopTotalBytes = 0;

      for (const fetchBbox of fetchBboxes) {
        const routeResponse = await fetchRouteLinesForBbox(fetchBbox, currentZoom, abortSignal);
        if (requestId !== activeRequestId) return;
        const routePayload = routeResponse.payload;
        if ((routePayload.lines?.length ?? 0) >= activeShapeLimit || (routePayload.counts?.routes ?? 0) >= activeRouteLimit) {
          cacheMayBeIncomplete = true;
        }
        const incomingMode = routePayload.mode ?? (currentZoom <= 11 ? 'corridor' : currentZoom <= 14 ? 'mixed' : 'detailed');
        if (resolvedMode && incomingMode !== resolvedMode) {
          // Keep one request cycle deterministic when mode changes mid-refresh.
          clearViewportCaches();
          routeTotalMs = 0;
          routeTotalBytes = 0;
          stopTotalMs = 0;
          stopTotalBytes = 0;
        }
        resolvedMode = incomingMode;
        mergeLineCache(routePayload.lines ?? []);
        mergeCorridorCache(routePayload.corridors ?? []);
        routeTotalMs += routeResponse.elapsedMs;
        routeTotalBytes += routeResponse.payloadBytes;

        if (currentZoom >= MIN_STOP_RENDER_ZOOM) {
          const stopResponse = await fetchStopsForBbox(fetchBbox, currentZoom, abortSignal);
          if (requestId !== activeRequestId) return;
          mergeStopCache(stopResponse.payload.stops ?? []);
          stopTotalMs += stopResponse.elapsedMs;
          stopTotalBytes += stopResponse.payloadBytes;
        }
      }

      const nextMode = resolvedMode ?? (currentZoom <= 11 ? 'corridor' : currentZoom <= 14 ? 'mixed' : 'detailed');
      const linesToRender = cachedLinesSnapshot();
      const corridorsToRender = cachedCorridorsSnapshot();
      const stopsToRender = renderedStopsForViewport(viewportBbox, nextMode);
      drawLines(linesToRender, corridorsToRender, nextMode);
      drawStops(stopsToRender);
      cacheMode = nextMode;
      coveredBbox = coveredBbox ? unionBbox(coveredBbox, fetchTargetBbox) : fetchTargetBbox;
      lastViewportBbox = viewportBbox;
      incrementalPanCount = shouldForceFullReload ? 0 : incrementalPanCount + 1;
      modeLabel = `${zoomModeLabel(currentZoom)} | ${nextMode}`;
      renderMetrics.routeLoadMs = Math.round(Math.max(routeTotalMs, performance.now() - requestStartedAt));
      renderMetrics.routePayloadBytes = routeTotalBytes;
      renderMetrics.stopLoadMs = stopTotalMs;
      renderMetrics.stopPayloadBytes = stopTotalBytes;
      if (selectedRoute && detailKind === 'route') {
        void refreshSelectedRouteRealtime();
      } else {
        syncRealtimeVehicleMarkers();
      }
    } catch (err) {
      if (abortSignal.aborted) return;
      error = err instanceof Error ? err.message : 'Failed to load route lines';
      clearViewportCaches();
      routeLayer.clearLayers();
      stopLayer?.clearLayers();
      clearAnimationMarkers();
      clearRealtimeVehicleMarkers();
    } finally {
      if (requestId === activeRequestId) {
        loading = false;
      }
    }
  }

  function queueRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    const elapsedSinceLastRequest = Math.max(0, performance.now() - lastRouteLoadStartedAt);
    const throttleDelay = Math.max(0, ROUTE_REFRESH_MIN_INTERVAL_MS - elapsedSinceLastRequest);
    const delayMs = Math.max(ROUTE_REFRESH_DEBOUNCE_MS, throttleDelay);
    refreshTimer = setTimeout(() => {
      serializeMapHash();
      loadRouteDataFromViewport();
    }, delayMs);
  }

  onMount(async () => {
    if (typeof window !== 'undefined') {
      const storedPreference = window.localStorage.getItem(VEHICLE_ANIMATION_STORAGE_KEY);
      if (storedPreference === '0') {
        animateVehicles = false;
      } else if (storedPreference === '1') {
        animateVehicles = true;
      }
    }

    const leafletModule = await import('leaflet');
    L = leafletModule;
    map = L.map(mapEl, {
      zoomControl: false,
      minZoom: 5,
      maxZoom: 16,
    }).setView([data.center.lat, data.center.lon], data.zoom);

    L.tileLayer(DARK_TILE_URL, {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: DARK_TILE_ATTRIBUTION,
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    map.createPane(ROUTE_GEOMETRY_PANE).style.zIndex = '410';
    map.createPane(ROUTE_STOP_PANE).style.zIndex = '460';
    map.createPane(ROUTE_ANIMATION_PANE).style.zIndex = '470';
    map.createPane(REALTIME_VEHICLE_PANE).style.zIndex = '480';

    routeLayer = L.layerGroup().addTo(map);
    stopLayer = L.layerGroup().addTo(map);
    animationLayer = L.layerGroup().addTo(map);
    realtimeVehicleLayer = L.layerGroup().addTo(map);
    const hashLocation = typeof window !== 'undefined' ? parseMapHash(window.location.hash) : null;
    if (hashLocation) {
      const clampedZoom = Math.max(5, Math.min(16, hashLocation.zoom));
      map.setView([hashLocation.lat, hashLocation.lon], clampedZoom);
      shouldAutoFitInitialRoutes = false;
    } else {
      const location = await detectLocationOrFallback();
      map.setView([location.lat, location.lon], data.zoom);
    }

    map.on('moveend', queueRefresh);
    map.on('zoomend', queueRefresh);
    map.on('click', () => {
      if (!detailKind) return;
      closeDetails();
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onWindowKeydown);
    }
    await loadRouteDataFromViewport();
    realtimeRefreshTimer = setInterval(() => {
      void refreshSelectedRouteRealtime();
    }, 20_000);
  });

  onDestroy(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (realtimeRefreshTimer) clearInterval(realtimeRefreshTimer);
    inFlightAbort?.abort();
    detailsAbort?.abort();
    routeRealtimeAbort?.abort();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onWindowKeydown);
    }
    clearAnimationMarkers();
    clearRealtimeVehicleMarkers();
    if (map) {
      map.off('moveend', queueRefresh);
      map.off('zoomend', queueRefresh);
      map.off('click');
      map.remove();
    }
  });
</script>

<svelte:head>
  <title>Map | Canada Transit Atlas</title>
</svelte:head>

<div class="map-shell">
  <div bind:this={mapEl} class="leaflet-map"></div>
  <form class="overlay city-search" on:submit={onCitySearchSubmit}>
    <input
      type="search"
      placeholder="Search city in Canada..."
      bind:value={citySearch}
      on:input={() => {
        citySearchError = '';
      }}
      aria-label="Search city"
    />
    <button type="submit" disabled={citySearchLoading || !citySearch.trim()}>
      {citySearchLoading ? 'Finding...' : 'Go'}
    </button>
    {#if citySearchError}
      <span class="city-search-error">{citySearchError}</span>
    {/if}
  </form>
  <div class="overlay mode">
    {#each modePills as pill}
      <span class="mode-pill">{pill}</span>
    {/each}
    <span class="mode-pill">z{currentZoom}</span>
  </div>
  <div class="overlay stats">
    routes {renderMetrics.routeLoadMs}ms / {(renderMetrics.routePayloadBytes / 1024).toFixed(1)}KB · stops {renderMetrics.stopLoadMs}ms /
    {(renderMetrics.stopPayloadBytes / 1024).toFixed(1)}KB
  </div>
  <label class="overlay anim-toggle">
    <input type="checkbox" checked={animateVehicles} on:change={onToggleVehicleAnimation} />
    Animate fallback marker (when no live vehicles)
  </label>
  {#if detailKind}
    <div
      class="sidebar-glass"
      style={`--sidebar-accent:${asCssRouteColor(
        routeDetails?.routeColor ?? selectedRoute?.routeColor ?? stopDetails?.primaryRoutePath?.route?.routeColor
      )}`}
      bind:this={sidebarEl}
    >
      <div class="sidebar-header">
        <div class="sidebar-header-title">
          {#if detailKind === 'route' && canReturnToCorridor}
            <button type="button" class="sidebar-back-btn" on:click={backToCorridorTiles} aria-label="Back to corridor routes">
              ←
            </button>
          {/if}
          <div class="sidebar-title-wrap">
            <span class="sidebar-kicker">
              {#if detailKind === 'route'}
                Route Details
              {:else if detailKind === 'corridor'}
                Corridor Overview
              {:else}
                Stop Details
              {/if}
            </span>
            <strong class="sidebar-title">
              {#if detailKind === 'route'}
                {selectedRoute?.routeShortName || selectedRoute?.routeLongName || selectedRoute?.routeId || 'Route details'}
              {:else if detailKind === 'corridor'}
                Corridor routes
              {:else}
                {selectedStop?.stopName || selectedStop?.stopId || 'Stop details'}
              {/if}
            </strong>
          </div>
        </div>
        <button type="button" class="sidebar-close-btn" on:click={closeDetails}>Close</button>
      </div>

      {#if detailLoading}
        <p class="sidebar-loading">Loading details...</p>
      {:else if detailError}
        <p class="sidebar-error">{detailError}</p>
      {:else if detailKind === 'corridor' && corridorDetailRoutes.length > 0}
        <div class="sidebar-section">
          <span>Select a route from this corridor to highlight it.</span>
          <div class="corridor-tile-grid">
            {#each corridorDetailRoutes as routeRef}
              <button
                type="button"
                class="corridor-route-tile"
                style={`--tile-accent:${asCssRouteColor(routeRef.routeColor)}`}
                on:click={() => handleRouteSelection(routeKeyFromRef(routeRef), { fromCorridor: true })}
              >
                <span class="corridor-route-title">{routeLabel(routeRef)}</span>
                <span class="corridor-route-meta">{routeTypeLabel(routeRef.routeType)}</span>
                <span class="corridor-route-meta">{routeRef.agencyName ?? routeRef.agencySlug ?? 'Unknown agency'}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if detailKind === 'route' && routeDetails}
        <div class="sidebar-section route-detail-section">
          <div class="meta-grid">
            <div class="meta-chip">
              <span class="meta-label">Agency</span>
              <strong class="meta-value">{routeDetails.agency?.displayName ?? selectedRoute?.agencyName ?? 'Unknown agency'}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Mode</span>
              <strong class="meta-value">{routeTypeLabel(routeDetails.routeType)}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Route ID</span>
              <strong class="meta-value">{routeDetails.routeId}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Trips</span>
              <strong class="meta-value">{routeDetails.counts?.trips ?? 0}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Distinct Stops</span>
              <strong class="meta-value">{routeDetails.counts?.distinctStops ?? 0}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Directions</span>
              <strong class="meta-value">{routeDetails.counts?.directions ?? 0}</strong>
            </div>
            {#if routeDetails.agency?.ridership}
              <div class="meta-chip">
                <span class="meta-label">Agency-wide trips ({routeDetails.agency.ridership.latestPassengerTripsMonth ?? 'n/a'})</span>
                <strong class="meta-value">{formatRidershipFromThousands(routeDetails.agency.ridership.latestPassengerTripsThousands)}</strong>
              </div>
              <div class="meta-chip">
                <span class="meta-label">Agency-wide revenue ({routeDetails.agency.ridership.latestRevenueMonth ?? 'n/a'})</span>
                <strong class="meta-value">{formatRidershipFromThousands(routeDetails.agency.ridership.latestRevenueThousandsCad, { currency: true })}</strong>
              </div>
            {/if}
          </div>
          {#if routeServiceStats && hasRouteServiceStatsData}
            <div class="service-stats-wrap">
              <span class="stop-list-title">Service supply ({formatServiceDate(routeServiceStats.serviceDate)})</span>
              <div class="meta-grid service-stats-grid">
                <div class="meta-chip">
                  <span class="meta-label">Scheduled trips</span>
                  <strong class="meta-value">{formatCount(routeServiceStats.scheduledTrips)}</strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">Span of service</span>
                  <strong class="meta-value">
                    {routeServiceStats.spanOfService.firstDeparture ?? 'n/a'} - {routeServiceStats.spanOfService.lastDeparture ?? 'n/a'}
                  </strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">Service-hours (approx)</span>
                  <strong class="meta-value">{formatDecimal(routeServiceStats.supply.serviceHoursApprox, 2)} h</strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">Service-km (approx)</span>
                  <strong class="meta-value">{formatDecimal(routeServiceStats.supply.serviceKmApprox, 2)} km</strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">VRH-ish</span>
                  <strong class="meta-value">{formatDecimal(routeServiceStats.supply.vrhApprox, 2)} h</strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">VRK-ish</span>
                  <strong class="meta-value">{formatDecimal(routeServiceStats.supply.vrkApprox, 2)} km</strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">Route coverage</span>
                  <strong class="meta-value">{formatDecimal(routeServiceStats.stopCoverage.routeCoverageKm, 2)} km</strong>
                </div>
                <div class="meta-chip">
                  <span class="meta-label">Stop density</span>
                  <strong class="meta-value">
                    {routeServiceStats.stopCoverage.stopsPerKm === null ? 'n/a' : `${formatDecimal(routeServiceStats.stopCoverage.stopsPerKm, 2)} stops/km`}
                  </strong>
                </div>
              </div>
              <div class="service-chart-grid">
                {#if headwayChartConfig}
                  <div class="service-chart-card">
                    <span class="meta-label">Headways by time band</span>
                    <MetricChart config={headwayChartConfig} title="Headways by time band" height={250} />
                  </div>
                {/if}
                {#if supplyChartConfig}
                  <div class="service-chart-card">
                    <span class="meta-label">Service supply comparison</span>
                    <MetricChart config={supplyChartConfig} title="Service supply comparison" height={220} />
                  </div>
                {/if}
                {#if distanceQualityChartConfig}
                  <div class="service-chart-card">
                    <span class="meta-label">Distance source quality</span>
                    <MetricChart config={distanceQualityChartConfig} title="Distance source quality" height={220} />
                  </div>
                {/if}
              </div>
              {#if routeServiceStats.methodology.notes.length > 0}
                <p class="detail-copy">Methodology: {routeServiceStats.methodology.notes.join(' ')}</p>
              {/if}
            </div>
          {/if}
          {#if routeDetails.routeDesc}
            <p class="detail-copy">{routeDetails.routeDesc}</p>
          {/if}
          {#if routeRealtime}
            <div class="realtime-wrap">
              <span class="stop-list-title">Realtime status</span>
              <div class="realtime-grid">
                <span>Last refresh: {formatTimeLabel(routeRealtime.refreshedAt)}</span>
                <span>Vehicles: {routeRealtime.counts?.vehicles ?? 0}</span>
                <span>Trip updates: {routeRealtime.counts?.tripUpdates ?? 0}</span>
                <span>Alerts: {routeRealtime.counts?.alerts ?? 0}</span>
              </div>
              {#if agencyRealtimeHealth}
                <div class="realtime-grid">
                  <span>Health agency: {agencyRealtimeHealth.agencySlug}</span>
                  <span>SA: {agencyRealtimeHealth.buckets?.service_alerts?.status ?? 'idle'}</span>
                  <span>TU: {agencyRealtimeHealth.buckets?.trip_updates?.status ?? 'idle'}</span>
                  <span>VP: {agencyRealtimeHealth.buckets?.vehicle_positions?.status ?? 'idle'}</span>
                </div>
                {#if agencyRealtimeHealth.notes}
                  <span>{agencyRealtimeHealth.notes}</span>
                {/if}
              {/if}
              {#if routeRealtime.alerts && routeRealtime.alerts.length > 0}
                <span>
                  Active alerts:
                  {routeRealtime.alerts
                    .slice(0, 3)
                    .map((alert) => alert.headerText || alert.effect || alert.id || 'Alert')
                    .join(' | ')}
                </span>
              {/if}
              {#if routeRealtime.notes}
                <span>{routeRealtime.notes}</span>
              {/if}
            </div>
          {/if}
          {#if routeDetails.headsigns && routeDetails.headsigns.length > 0}
            <span>Headsigns: {routeDetails.headsigns.join(' | ')}</span>
          {/if}
          {#if routeDetails.sampleTrips && routeDetails.sampleTrips.length > 0}
            <span>Sample trips: {routeDetails.sampleTrips.join(', ')}</span>
          {/if}
          {#if routeDetails.routePath && routeDetails.routePath.stops.length > 0}
            <div
              class="stop-list-wrap route-stop-list-wrap"
              style={`--route-accent:${asCssRouteColor(routeDetails.routeColor ?? selectedRoute?.routeColor)}`}
            >
              <span class="stop-list-title">
                Full route ({routeDetails.routePath.stops.length} stops)
                {#if routeDetails.routePath.headsign}
                  - to {routeDetails.routePath.headsign}
                {/if}
              </span>
              <ol class="stop-list" bind:this={routeStopListEl}>
                {#each routeDetails.routePath.stops as routeStop}
                  <li
                    class={`stop-list-item route-stop-list-item ${
                      routeStop.stopId === pendingRouteScrollStopId ? 'active' : ''
                    }`}
                    data-stop-id={routeStop.stopId}
                    on:mouseenter={() => onRouteStopRowHover(routeStop.stopId)}
                    on:mouseleave={() => onRouteStopRowHover(null)}
                    on:click={() => void centerMapOnRouteStopIfOffscreen(routeStop.stopId)}
                  >
                    <span class="stop-badge">{routeStop.stopSequence}</span>
                    <span class="stop-name">
                      {routeStop.stopName || routeStop.stopId}
                      {#if routeStop.wheelchairBoarding === 1}
                        <span class="wheelchair-indicator" aria-label="Wheelchair accessible">♿</span>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ol>
            </div>
          {/if}
        </div>
      {:else if detailKind === 'stop' && stopDetails}
        <div class="sidebar-section">
          <div class="meta-grid">
            <div class="meta-chip">
              <span class="meta-label">Agency</span>
              <strong class="meta-value">{stopDetails.agency?.displayName ?? selectedStop?.agencyName ?? 'Unknown agency'}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Stop ID</span>
              <strong class="meta-value">{stopDetails.stopId}</strong>
            </div>
            {#if stopDetails.stopCode}
              <div class="meta-chip">
                <span class="meta-label">Stop Code</span>
                <strong class="meta-value">{stopDetails.stopCode}</strong>
              </div>
            {/if}
            <div class="meta-chip">
              <span class="meta-label">Routes Serving</span>
              <strong class="meta-value">{stopDetails.counts?.routes ?? 0}</strong>
            </div>
            <div class="meta-chip">
              <span class="meta-label">Trips Through Stop</span>
              <strong class="meta-value">{stopDetails.counts?.trips ?? 0}</strong>
            </div>
            {#if stopDetails.wheelchairBoarding === 1}
              <div class="meta-chip">
                <span class="meta-label">Accessibility</span>
                <strong class="meta-value">♿ Accessible</strong>
              </div>
            {/if}
            {#if stopDetails.agency?.ridership}
              <div class="meta-chip">
                <span class="meta-label">Agency-wide trips ({stopDetails.agency.ridership.latestPassengerTripsMonth ?? 'n/a'})</span>
                <strong class="meta-value">{formatRidershipFromThousands(stopDetails.agency.ridership.latestPassengerTripsThousands)}</strong>
              </div>
              <div class="meta-chip">
                <span class="meta-label">Agency-wide revenue ({stopDetails.agency.ridership.latestRevenueMonth ?? 'n/a'})</span>
                <strong class="meta-value">{formatRidershipFromThousands(stopDetails.agency.ridership.latestRevenueThousandsCad, { currency: true })}</strong>
              </div>
            {/if}
          </div>
          {#if stopRealtime}
            <div class="realtime-wrap">
              <span class="stop-list-title">Realtime at stop</span>
              <div class="realtime-grid">
                <span>Last refresh: {formatTimeLabel(stopRealtime.refreshedAt)}</span>
                <span>Vehicles on serving trips: {stopRealtime.counts?.vehicles ?? 0}</span>
                <span>Trip updates: {stopRealtime.counts?.tripUpdates ?? 0}</span>
                <span>Alerts: {stopRealtime.counts?.alerts ?? 0}</span>
              </div>
              {#if agencyRealtimeHealth}
                <div class="realtime-grid">
                  <span>SA: {agencyRealtimeHealth.buckets?.service_alerts?.status ?? 'idle'}</span>
                  <span>TU: {agencyRealtimeHealth.buckets?.trip_updates?.status ?? 'idle'}</span>
                  <span>VP: {agencyRealtimeHealth.buckets?.vehicle_positions?.status ?? 'idle'}</span>
                </div>
              {/if}
              {#if stopRealtime.tripUpdates && stopRealtime.tripUpdates.length > 0}
                <span>
                  Recent trip delays:
                  {stopRealtime.tripUpdates
                    .slice(0, 4)
                    .map((tu) => `${tu.tripId || 'trip'} (${tu.delaySeconds ?? 0}s)`)
                    .join(' | ')}
                </span>
              {/if}
            </div>
          {/if}
          {#if stopDetails.platformCode}
            <p class="detail-copy">Platform: {stopDetails.platformCode}</p>
          {/if}
          {#if stopDetails.stopDesc}
            <p class="detail-copy">{stopDetails.stopDesc}</p>
          {/if}
          {#if stopDetails.routes && stopDetails.routes.length > 0}
            <p class="detail-copy">
              Routes:
              {stopDetails.routes
                .slice(0, 14)
                .map((route) => route.routeShortName || route.routeLongName || route.routeId)
                .join(', ')}
            </p>
          {/if}
          {#if stopDetails.headsigns && stopDetails.headsigns.length > 0}
            <p class="detail-copy">Headsigns: {stopDetails.headsigns.join(' | ')}</p>
          {/if}
          {#if stopDetails.primaryRoutePath && stopDetails.primaryRoutePath.stops.length > 0}
            <div
              class="stop-list-wrap"
              style={`--route-accent:${asCssRouteColor(stopDetails.primaryRoutePath.route?.routeColor)}`}
            >
              <span class="stop-list-title">
                {#if stopDetails.primaryRoutePath.route}
                  {stopDetails.primaryRoutePath.route.routeShortName ||
                    stopDetails.primaryRoutePath.route.routeLongName ||
                    stopDetails.primaryRoutePath.route.routeId}
                {:else}
                  Primary route
                {/if}
                ({stopDetails.primaryRoutePath.stops.length} stops)
              </span>
              {#if stopDetails.primaryRoutePath.headsign}
                <span class="stop-list-subtitle">Direction: {stopDetails.primaryRoutePath.headsign}</span>
              {/if}
              <ol class="stop-list">
                {#each stopDetails.primaryRoutePath.stops as routeStop}
                  <li
                    class={`stop-list-item ${
                      routeStop.stopId === stopDetails.primaryRoutePath?.currentStopId ? 'active' : ''
                    }`}
                  >
                    <span class="stop-badge">{routeStop.stopSequence}</span>
                    <span class="stop-name">
                      {routeStop.stopName || routeStop.stopId}
                      {#if routeStop.wheelchairBoarding === 1}
                        <span class="wheelchair-indicator" aria-label="Wheelchair accessible">♿</span>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ol>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  {#if loading}
    <div class="overlay loading">Updating routes...</div>
  {/if}
  {#if error}
    <div class="overlay error">{error}</div>
  {/if}
</div>

<style>
  .map-shell {
    position: relative;
    border: 1px solid #1f2a40;
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .leaflet-map {
    height: calc(100vh - 8.5rem);
    min-height: 620px;
    width: 100%;
    background: #0a1220;
  }

  .overlay {
    position: absolute;
    z-index: 500;
    padding: 0.35rem 0.6rem;
    border-radius: 0.45rem;
    border: 1px solid #2f3d59;
    background: rgba(7, 12, 24, 0.82);
    color: #d8e3fa;
    font-size: 0.8rem;
    backdrop-filter: blur(2px);
  }

  .overlay.mode {
    top: 0.8rem;
    right: 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    max-width: min(44rem, calc(100% - 1.6rem));
    padding: 0.28rem 0.35rem;
  }

  .overlay.city-search {
    top: 0.8rem;
    left: 0.8rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.38rem;
    width: min(26rem, calc(100% - 1.6rem));
    padding: 0.38rem;
    border-color: #3c5278;
    background: rgba(6, 12, 23, 0.9);
  }

  .overlay.city-search input[type='search'] {
    width: 100%;
    min-width: 0;
    border: 1px solid #3b4f75;
    border-radius: 0.4rem;
    background: #0d1a31;
    color: #e2eefd;
    padding: 0.4rem 0.52rem;
    font-size: 0.82rem;
    outline: none;
  }

  .overlay.city-search input[type='search']::placeholder {
    color: #96b1dd;
  }

  .overlay.city-search button {
    border: 1px solid #5576ad;
    border-radius: 0.42rem;
    background: #15335d;
    color: #edf5ff;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 0.36rem 0.7rem;
    cursor: pointer;
  }

  .overlay.city-search button:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .city-search-error {
    grid-column: 1 / -1;
    color: #fecaca;
    font-size: 0.72rem;
  }

  .mode-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(126, 164, 224, 0.55);
    border-radius: 999px;
    padding: 0.18rem 0.52rem;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: #e3eeff;
    background: rgba(18, 34, 66, 0.82);
  }

  .overlay.loading {
    top: 2.95rem;
    right: 0.8rem;
  }

  .overlay.stats {
    top: 2.95rem;
    right: 0.8rem;
    transform: translateY(2.2rem);
    font-size: 0.72rem;
    color: #c5d7f8;
  }

  .overlay.anim-toggle {
    top: 7.2rem;
    right: 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.78rem;
    user-select: none;
    cursor: pointer;
  }

  .overlay.anim-toggle input {
    margin: 0;
    accent-color: #60a5fa;
  }

  .overlay.error {
    left: 0.8rem;
    bottom: 0.8rem;
    border-color: #7f1d1d;
    background: rgba(127, 29, 29, 0.88);
    color: #fecaca;
    max-width: min(40rem, calc(100% - 1.6rem));
  }

  .sidebar-glass {
    --sidebar-accent: #60a5fa;
    position: absolute;
    z-index: 650;
    top: 0.8rem;
    left: 0.8rem;
    bottom: 0.8rem;
    width: min(25rem, calc(100% - 1.6rem));
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.85rem 0.95rem;
    border: 1px solid rgba(159, 184, 225, 0.35);
    border-radius: 0.8rem;
    background:
      radial-gradient(circle at 92% 8%, color-mix(in oklab, var(--sidebar-accent) 34%, transparent), transparent 45%),
      rgba(9, 16, 30, 0.6);
    backdrop-filter: blur(15px) saturate(120%);
    color: #e2ebfb;
    overflow-y: auto;
    box-shadow: inset 0 0 0 1px rgba(196, 214, 244, 0.08), 0 18px 50px rgba(2, 6, 22, 0.45);
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
  }

  .sidebar-header-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .sidebar-title-wrap {
    display: grid;
    gap: 0.14rem;
    min-width: 0;
  }

  .sidebar-kicker {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in oklab, var(--sidebar-accent) 82%, #dbeafe);
  }

  .sidebar-title {
    font-size: 1.18rem;
    font-weight: 800;
    line-height: 1.08;
    color: #f8fbff;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
  }

  .sidebar-header button {
    border: 1px solid #5470a3;
    background: rgba(17, 33, 66, 0.86);
    color: #dce8ff;
    border-radius: 0.4rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 0.78rem;
  }

  .sidebar-close-btn {
    border-color: color-mix(in oklab, var(--sidebar-accent) 50%, #5470a3) !important;
    background: linear-gradient(180deg, rgba(23, 43, 79, 0.9), rgba(16, 30, 58, 0.9)) !important;
    font-weight: 700;
  }

  .sidebar-back-btn {
    border: 1px solid #5470a3;
    background: rgba(17, 33, 66, 0.86);
    color: #dce8ff;
    border-radius: 0.4rem;
    width: 1.7rem;
    height: 1.55rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    font-size: 0.82rem;
    border: 1px solid rgba(120, 152, 206, 0.22);
    border-radius: 0.72rem;
    padding: 0.7rem;
    background: linear-gradient(180deg, rgba(14, 29, 55, 0.7), rgba(11, 23, 43, 0.74));
  }

  .route-detail-section {
    flex: 1;
    min-height: 0;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .service-stats-wrap {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.2rem;
  }

  .service-stats-grid {
    margin-top: 0.1rem;
  }

  .service-chart-grid {
    display: grid;
    gap: 0.5rem;
  }

  .service-chart-card {
    border: 1px solid rgba(96, 146, 226, 0.26);
    border-radius: 0.62rem;
    background: rgba(8, 20, 39, 0.66);
    padding: 0.45rem 0.5rem;
    display: grid;
    gap: 0.4rem;
  }

  .meta-chip {
    border: 1px solid rgba(134, 170, 228, 0.26);
    border-radius: 0.6rem;
    background: rgba(9, 19, 36, 0.64);
    padding: 0.42rem 0.5rem;
    display: grid;
    gap: 0.14rem;
  }

  .meta-label {
    font-size: 0.63rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #96b7e9;
    font-weight: 700;
  }

  .meta-value {
    font-size: 0.84rem;
    line-height: 1.2;
    color: #edf5ff;
  }

  .detail-copy {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.32;
    color: #cfe2ff;
  }

  .corridor-tile-grid {
    margin-top: 0.25rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }

  .corridor-route-tile {
    border: 1px solid rgba(107, 140, 196, 0.42);
    border-left: 3px solid var(--tile-accent, #60a5fa);
    border-radius: 0.5rem;
    background: rgba(10, 24, 49, 0.66);
    color: #dbeafe;
    padding: 0.45rem 0.55rem;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .corridor-route-tile:hover {
    background: rgba(18, 38, 74, 0.8);
  }

  .corridor-route-title {
    font-size: 0.83rem;
    font-weight: 700;
    color: #f8fafc;
  }

  .corridor-route-meta {
    font-size: 0.72rem;
    color: #9fbce7;
  }

  .stop-list-wrap {
    margin-top: 0.3rem;
    border: 1px solid rgba(107, 140, 196, 0.35);
    border-radius: 0.65rem;
    padding: 0.5rem;
    background: rgba(6, 16, 36, 0.42);
  }

  .route-stop-list-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .stop-list-title {
    display: block;
    color: var(--route-accent, #dbeafe);
    font-weight: 700;
    font-size: 0.84rem;
    margin-bottom: 0.35rem;
  }

  .stop-list-subtitle {
    display: block;
    color: #9ec4ff;
    margin-bottom: 0.35rem;
    font-size: 0.74rem;
  }

  .realtime-wrap {
    display: grid;
    gap: 0.42rem;
    margin-top: 0.25rem;
    padding: 0.55rem 0.6rem;
    border: 1px solid rgba(96, 146, 226, 0.36);
    border-radius: 0.6rem;
    background: linear-gradient(180deg, rgba(8, 22, 45, 0.84), rgba(8, 17, 33, 0.78));
  }

  .realtime-grid {
    display: grid;
    gap: 0.22rem;
  }

  .stop-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.24rem;
    max-height: 20rem;
    overflow-y: auto;
  }

  .route-stop-list-wrap .stop-list {
    max-height: none;
    flex: 1;
    min-height: 0;
  }

  .stop-list-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: #d7e6ff;
    border-radius: 999px;
    padding: 0.1rem 0.2rem;
  }

  .route-stop-list-item {
    cursor: pointer;
  }

  .route-stop-list-item:hover {
    background: rgba(251, 191, 36, 0.14);
    color: #fde68a;
  }

  .stop-list-item.active {
    background: rgba(255, 235, 59, 0.12);
    color: #fef08a;
  }

  .stop-badge {
    min-width: 1.2rem;
    height: 1.2rem;
    border-radius: 999px;
    border: 1px solid var(--route-accent, #f9d84e);
    background: var(--route-accent, #f4d73f);
    color: #0f172a;
    font-weight: 700;
    font-size: 0.68rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex-shrink: 0;
  }

  .stop-name {
    font-size: 0.79rem;
    line-height: 1.2;
  }

  .wheelchair-indicator {
    margin-left: 0.28rem;
    color: #93c5fd;
    font-size: 0.8rem;
  }

  .sidebar-loading {
    margin: 0;
    color: #bfdbfe;
    font-size: 0.84rem;
  }

  .sidebar-error {
    margin: 0;
    color: #fecaca;
    font-size: 0.84rem;
  }

  @media (max-width: 740px) {
    .meta-grid {
      grid-template-columns: 1fr;
    }
  }

  :global(.corridor-count) {
    border: none;
    background: transparent;
    box-shadow: none;
    color: #ffffff;
    font-size: 0.64rem;
    font-weight: 700;
    padding: 0;
    margin: 0;
  }

  :global(.route-geometry) {
    transition:
      opacity 220ms ease,
      stroke-width 220ms ease;
  }

  :global(.vehicle-icon-shell) {
    background: transparent;
    border: none;
  }

  :global(.vehicle-marker) {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid rgba(241, 245, 249, 0.95);
    background: var(--vehicle-color, #f4d73f);
    color: var(--vehicle-text, #0f172a);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.55), 0 2px 8px rgba(2, 6, 23, 0.45);
    line-height: 1;
  }

  :global(.vehicle-marker__glyph) {
    font-size: 12px;
    transform: translateY(0.5px);
  }

  :global(.vehicle-marker--bus) {
    filter: saturate(1.02);
  }

  :global(.vehicle-marker--tram) {
    filter: saturate(1.08);
  }

  :global(.vehicle-marker--subway) {
    filter: saturate(1.12);
  }

  :global(.vehicle-marker--rail) {
    filter: saturate(1.08);
  }

  :global(.vehicle-marker--ferry) {
    filter: saturate(1.04);
  }

  :global(.vehicle-tooltip .leaflet-tooltip-content) {
    margin: 0;
  }

  :global(.vehicle-tooltip.leaflet-tooltip) {
    background: rgba(7, 18, 38, 0.96);
    border: 1px solid rgba(125, 170, 245, 0.65);
    color: #eaf2ff;
    box-shadow: 0 8px 20px rgba(2, 6, 23, 0.52);
    border-radius: 0.5rem;
    padding: 0.42rem 0.5rem;
  }

  :global(.vehicle-tooltip.leaflet-tooltip-top:before) {
    border-top-color: rgba(7, 18, 38, 0.96);
  }

  :global(.vehicle-tooltip.leaflet-tooltip-bottom:before) {
    border-bottom-color: rgba(7, 18, 38, 0.96);
  }

  :global(.vehicle-tooltip.leaflet-tooltip-left:before) {
    border-left-color: rgba(7, 18, 38, 0.96);
  }

  :global(.vehicle-tooltip.leaflet-tooltip-right:before) {
    border-right-color: rgba(7, 18, 38, 0.96);
  }

  :global(.vehicle-tooltip-card) {
    display: grid;
    gap: 0.24rem;
    min-width: 14rem;
    color: #e4efff;
    font-size: 0.77rem;
    line-height: 1.25;
    text-shadow: 0 1px 0 rgba(2, 6, 23, 0.45);
  }

  :global(.vehicle-tooltip-title) {
    color: #ffffff;
    font-size: 0.82rem;
    font-weight: 700;
  }

  :global(.vehicle-tooltip-label) {
    color: #93c5fd;
    font-weight: 700;
  }
</style>
