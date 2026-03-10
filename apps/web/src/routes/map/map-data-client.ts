import { graphqlRequest } from '$lib/api';

type BboxRect = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

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

type TransitHeatCell = {
  lat: number;
  lon: number;
  intensity: number;
  rawScore: number;
  cellLatSpan: number;
  cellLonSpan: number;
};

type MapTransitHeatPayload = {
  gridSize?: number;
  maxScore?: number;
  count?: number;
  cells?: TransitHeatCell[];
  sourceCounts?: {
    routes?: number;
    lines?: number;
    stops?: number;
  };
};

function bboxToString(bbox: BboxRect) {
  return `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
}

export function routeLimitForZoom(zoom: number) {
  return zoom <= 9 ? 900 : zoom <= 11 ? 1050 : zoom <= 13 ? 1300 : 1600;
}

export function shapeLimitForZoom(zoom: number) {
  return zoom <= 9 ? 220 : zoom <= 13 ? 520 : 900;
}

export function stopLimitForZoom(zoom: number) {
  if (zoom <= 7) return 250;
  if (zoom <= 10) return 900;
  if (zoom <= 12) return 2200;
  if (zoom <= 14) return 5000;
  return 10_000;
}

export async function fetchRouteLinesForBbox(bbox: BboxRect, zoom: number, abortSignal: AbortSignal) {
  const routeStart = performance.now();
  const result = await graphqlRequest<{ mapRouteLines: MapRouteLinesPayload }>(
    (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, {
        ...init,
        signal: abortSignal,
      }),
    `query MapRouteLines($bbox: String!, $zoom: Int!, $routeLimit: Int!, $shapeLimit: Int!) {
      mapRouteLines(bbox: $bbox, zoom: $zoom, routeLimit: $routeLimit, shapeLimit: $shapeLimit)
    }`,
    {
      bbox: bboxToString(bbox),
      zoom,
      routeLimit: routeLimitForZoom(zoom),
      shapeLimit: shapeLimitForZoom(zoom),
    },
  );
  const payload = result.mapRouteLines ?? {};
  return {
    payload,
    elapsedMs: Math.round(performance.now() - routeStart),
    payloadBytes: new Blob([JSON.stringify(payload)]).size,
  };
}

export async function fetchStopsForBbox(bbox: BboxRect, zoom: number, abortSignal: AbortSignal) {
  const stopStart = performance.now();
  const stopResult = await graphqlRequest<{ mapStops: { stops: StopPoint[] } }>(
    (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, {
        ...init,
        signal: abortSignal,
      }),
    `query MapStops($bbox: String!, $zoom: Int!, $stopLimit: Int!) {
      mapStops(bbox: $bbox, zoom: $zoom, stopLimit: $stopLimit)
    }`,
    { bbox: bboxToString(bbox), zoom, stopLimit: stopLimitForZoom(zoom) },
  );
  const payload = stopResult.mapStops ?? { stops: [] };
  return {
    payload,
    elapsedMs: Math.round(performance.now() - stopStart),
    payloadBytes: new Blob([JSON.stringify(payload)]).size,
  };
}

export async function fetchTransitHeatForBbox(
  bbox: BboxRect,
  zoom: number,
  abortSignal: AbortSignal,
  options?: {
    gridSize?: number;
    routeLimit?: number;
    shapeLimit?: number;
    stopLimit?: number;
    serviceAware?: boolean;
  },
) {
  const heatStart = performance.now();
  const result = await graphqlRequest<{ mapTransitHeat: MapTransitHeatPayload }>(
    (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, {
        ...init,
        signal: abortSignal,
      }),
    `query MapTransitHeat(
      $bbox: String!
      $zoom: Int!
      $gridSize: Int
      $routeLimit: Int!
      $shapeLimit: Int!
      $stopLimit: Int!
      $serviceAware: Boolean!
    ) {
      mapTransitHeat(
        bbox: $bbox
        zoom: $zoom
        gridSize: $gridSize
        routeLimit: $routeLimit
        shapeLimit: $shapeLimit
        stopLimit: $stopLimit
        serviceAware: $serviceAware
      )
    }`,
    {
      bbox: bboxToString(bbox),
      zoom,
      gridSize: options?.gridSize ?? null,
      routeLimit: options?.routeLimit ?? routeLimitForZoom(zoom),
      shapeLimit: options?.shapeLimit ?? shapeLimitForZoom(zoom),
      stopLimit: options?.stopLimit ?? stopLimitForZoom(zoom),
      serviceAware: options?.serviceAware ?? false,
    },
  );
  const payload = result.mapTransitHeat ?? { cells: [] };
  return {
    payload,
    elapsedMs: Math.round(performance.now() - heatStart),
    payloadBytes: new Blob([JSON.stringify(payload)]).size,
  };
}
