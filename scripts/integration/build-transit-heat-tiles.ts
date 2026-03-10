import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MIN_ZOOM = 5;
const MAX_ZOOM = 16;
const GRID_SIZE = 64;
const TILE_SIZE = 256;
const MIN_VISIBLE_RATIO = 0.003;
const ENCODE_GAMMA = 0.62;
const ROUTE_WEIGHT_BY_TYPE: Record<number, number> = {
  1: 1.2, // subway / metro
  2: 1.15, // regional / intercity rail
  0: 0.82, // tram / streetcar / LRT
  4: 0.62, // ferry
  3: 0.42, // bus
};

type TileMap = Map<string, Float32Array>;

function chunk<T>(input: T[], size: number): T[][] {
  if (input.length === 0) return [];
  const result: T[][] = [];
  for (let index = 0; index < input.length; index += size) {
    result.push(input.slice(index, index + size));
  }
  return result;
}

function clampLatitude(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function latLonToWorld(lat: number, lon: number, zoom: number) {
  const latClamped = clampLatitude(lat);
  const sin = Math.sin((latClamped * Math.PI) / 180);
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const worldX = ((lon + 180) / 360) * scale;
  const worldY = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { worldX, worldY, scale };
}

function tileKey(x: number, y: number) {
  return `${x}:${y}`;
}

function weightForRouteType(routeType?: number | null) {
  if (routeType === null || routeType === undefined) return 0.48;
  return ROUTE_WEIGHT_BY_TYPE[routeType] ?? 0.48;
}

function addSampleToTileMap(tileMapsByZoom: Map<number, TileMap>, lat: number, lon: number, weight: number) {
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
    const { worldX, worldY, scale } = latLonToWorld(lat, lon, zoom);
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) continue;
    if (tileX < 0 || tileY < 0) continue;
    const tileCount = Math.pow(2, zoom);
    if (tileX >= tileCount || tileY >= tileCount) continue;
    const px = worldX - tileX * TILE_SIZE;
    const py = worldY - tileY * TILE_SIZE;
    const gx = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((px / TILE_SIZE) * GRID_SIZE)));
    const gy = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((py / TILE_SIZE) * GRID_SIZE)));
    const zoomMap = tileMapsByZoom.get(zoom) ?? new Map<string, Float32Array>();
    const key = tileKey(tileX, tileY);
    const grid = zoomMap.get(key) ?? new Float32Array(GRID_SIZE * GRID_SIZE);
    const index = gy * GRID_SIZE + gx;
    const current = grid[index];
    if (current !== undefined) {
      grid[index] = current + weight;
    }
    zoomMap.set(key, grid);
    tileMapsByZoom.set(zoom, zoomMap);
    const inTileStep = TILE_SIZE / GRID_SIZE;
    const smearRadiusPx = Math.max(2, Math.round(inTileStep * 0.8));
    const radiusBins = Math.max(1, Math.min(2, Math.round(smearRadiusPx / inTileStep)));
    for (let dy = -radiusBins; dy <= radiusBins; dy += 1) {
      const yy = gy + dy;
      if (yy < 0 || yy >= GRID_SIZE) continue;
      for (let dx = -radiusBins; dx <= radiusBins; dx += 1) {
        const xx = gx + dx;
        if (xx < 0 || xx >= GRID_SIZE) continue;
        if (dx === 0 && dy === 0) continue;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusBins * radiusBins) continue;
        const kernel = Math.exp(-distSq / (radiusBins * radiusBins + 0.35));
        const idx = yy * GRID_SIZE + xx;
        const base = grid[idx];
        if (base !== undefined) {
          grid[idx] = base + weight * 0.42 * kernel;
        }
      }
    }
    void scale;
  }
}

function blurGridInPlace(grid: Float32Array) {
  const copy = new Float32Array(grid);
  const kernel = [
    1, 2, 1,
    2, 4, 2,
    1, 2, 1,
  ];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      let weighted = 0;
      let weightSum = 0;
      let kernelIndex = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          const k = kernel[kernelIndex] ?? 0;
          kernelIndex += 1;
          if (yy < 0 || yy >= GRID_SIZE || xx < 0 || xx >= GRID_SIZE || k <= 0) continue;
          weighted += (copy[yy * GRID_SIZE + xx] ?? 0) * k;
          weightSum += k;
        }
      }
      if (weightSum > 0) {
        grid[y * GRID_SIZE + x] = weighted / weightSum;
      }
    }
  }
}

async function main() {
  const activeFeeds = await prisma.gtfsFeedVersion.findMany({
    where: { isActive: true },
    select: { id: true, importedAt: true },
    orderBy: [{ id: 'asc' }],
  });
  if (activeFeeds.length === 0) {
    console.log('[transit-heat] no active feeds; nothing to build');
    return;
  }
  const activeFeedIds = activeFeeds.map((row) => row.id);
  const fingerprint = createHash('sha1')
    .update(
      activeFeeds
        .map((row) => `${row.id}:${row.importedAt.getTime()}`)
        .join('|'),
    )
    .digest('hex')
    .slice(0, 16);
  const versionKey = `v1-${fingerprint}-z${MIN_ZOOM}-${MAX_ZOOM}-g${GRID_SIZE}`;

  const existingActiveCount = await prisma.transitHeatTile.count({
    where: { isActive: true, versionKey },
  });
  if (existingActiveCount > 0) {
    console.log(`[transit-heat] active tiles already exist for ${versionKey} (${existingActiveCount} tiles).`);
    return;
  }

  console.log('[transit-heat] loading route-type maps...');
  const routeRows = await prisma.gtfsRoute.findMany({
    where: { feedVersionId: { in: activeFeedIds } },
    select: { feedVersionId: true, routeId: true, routeType: true },
    take: 200_000,
  });
  const routeTypeByKey = new Map(routeRows.map((row) => [`${row.feedVersionId}::${row.routeId}`, row.routeType] as const));

  console.log('[transit-heat] loading shape->route usage stats...');
  const tripShapeStats = await prisma.gtfsTrip.groupBy({
    by: ['feedVersionId', 'shapeId', 'routeId'],
    where: {
      feedVersionId: { in: activeFeedIds },
      shapeId: { not: null },
    },
    orderBy: [{ feedVersionId: 'asc' }, { shapeId: 'asc' }, { _count: { routeId: 'desc' } }, { routeId: 'asc' }],
    _count: { routeId: true },
    take: 250_000,
  });
  const dominantByShape = new Map<string, { count: number; routeType: number | null | undefined }>();
  for (const row of tripShapeStats) {
    if (!row.shapeId) continue;
    const shapeKey = `${row.feedVersionId}::${row.shapeId}`;
    const routeType = routeTypeByKey.get(`${row.feedVersionId}::${row.routeId}`);
    const count = row._count?.routeId ?? 0;
    const previous = dominantByShape.get(shapeKey);
    if (!previous || count > previous.count) {
      dominantByShape.set(shapeKey, { count, routeType });
    }
  }

  const shapeIdsByFeed = new Map<string, string[]>();
  for (const shapeKey of dominantByShape.keys()) {
    const [feedVersionId, shapeId] = shapeKey.split('::');
    if (!feedVersionId || !shapeId) continue;
    const bucket = shapeIdsByFeed.get(feedVersionId) ?? [];
    bucket.push(shapeId);
    shapeIdsByFeed.set(feedVersionId, bucket);
  }

  const tileMapsByZoom = new Map<number, TileMap>();
  let processedShapePoints = 0;
  for (const [feedVersionId, shapeIds] of shapeIdsByFeed.entries()) {
    for (const shapeIdBatch of chunk(shapeIds, 550)) {
      const points = await prisma.gtfsShapePoint.findMany({
        where: {
          feedVersionId,
          shapeId: { in: shapeIdBatch },
        },
        select: {
          shapeId: true,
          shapePtLat: true,
          shapePtLon: true,
        },
        take: 350_000,
      });
      for (const point of points) {
        const resolved = dominantByShape.get(`${feedVersionId}::${point.shapeId}`);
        addSampleToTileMap(tileMapsByZoom, point.shapePtLat, point.shapePtLon, weightForRouteType(resolved?.routeType));
      }
      processedShapePoints += points.length;
      if (processedShapePoints % 200_000 < points.length) {
        console.log(`[transit-heat] processed shape points: ${processedShapePoints.toLocaleString()}`);
      }
    }
  }

  console.log('[transit-heat] loading stops...');
  const stops = await prisma.gtfsStop.findMany({
    where: { feedVersionId: { in: activeFeedIds } },
    select: { stopLat: true, stopLon: true },
    take: 250_000,
  });
  for (const stop of stops) {
    if (!Number.isFinite(stop.stopLat) || !Number.isFinite(stop.stopLon)) continue;
    addSampleToTileMap(tileMapsByZoom, stop.stopLat as number, stop.stopLon as number, 0.2);
  }

  console.log('[transit-heat] smoothing + encoding tiles...');
  const rowsToInsert: Array<{
    id: string;
    versionKey: string;
    isActive: boolean;
    z: number;
    x: number;
    y: number;
    gridSize: number;
    tileData: Buffer;
    maxValue: number;
    sourceMeta: Record<string, unknown>;
  }> = [];

  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
    const tiles = tileMapsByZoom.get(zoom);
    if (!tiles || tiles.size === 0) continue;
    let globalMax = 0;
    for (const grid of tiles.values()) {
      blurGridInPlace(grid);
      for (const value of grid) {
        if (value > globalMax) globalMax = value;
      }
    }
    if (globalMax <= 0) continue;
    const minVisible = globalMax * MIN_VISIBLE_RATIO;
    for (const [key, grid] of tiles.entries()) {
      let tileMax = 0;
      for (const value of grid) {
        if (value > tileMax) tileMax = value;
      }
      if (tileMax < minVisible) continue;
      const data = new Uint8Array(GRID_SIZE * GRID_SIZE);
      for (let index = 0; index < grid.length; index += 1) {
        const value = grid[index] ?? 0;
        if (value < minVisible) {
          data[index] = 0;
          continue;
        }
        const normalized = Math.max(0, Math.min(1, value / globalMax));
        const encoded = Math.round(255 * Math.pow(normalized, ENCODE_GAMMA));
        data[index] = encoded <= 0 ? 1 : encoded;
      }
      const [xRaw, yRaw] = key.split(':');
      const x = Number.parseInt(String(xRaw), 10);
      const y = Number.parseInt(String(yRaw), 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      rowsToInsert.push({
        id: randomUUID(),
        versionKey,
        isActive: true,
        z: zoom,
        x,
        y,
        gridSize: GRID_SIZE,
        tileData: Buffer.from(data),
        maxValue: tileMax,
        sourceMeta: {
          globalMax,
          minVisible,
          gamma: ENCODE_GAMMA,
          source: 'shape_points_and_stops',
        },
      });
    }
  }

  if (rowsToInsert.length === 0) {
    console.log('[transit-heat] no tile rows generated; aborting write.');
    return;
  }

  await prisma.transitHeatTile.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });
  for (const batch of chunk(rowsToInsert, 500)) {
    await prisma.transitHeatTile.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }
  console.log(`[transit-heat] wrote ${rowsToInsert.length.toLocaleString()} active tiles (${versionKey}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
