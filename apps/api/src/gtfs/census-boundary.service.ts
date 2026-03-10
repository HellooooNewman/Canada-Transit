import { Injectable, Logger } from '@nestjs/common';
import AdmZip from 'adm-zip';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as shapefile from 'shapefile';
import proj4 from 'proj4';
import { parse } from 'csv-parse/sync';

type Coordinate = [number, number];

type PolygonGeometry = {
  type: 'Polygon';
  coordinates: Coordinate[][];
};

type MultiPolygonGeometry = {
  type: 'MultiPolygon';
  coordinates: Coordinate[][][];
};

type SupportedGeometry = PolygonGeometry | MultiPolygonGeometry;

type FeatureValue = {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
};

type Bbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type CensusBoundaryEntry = {
  bbox: Bbox;
  geometry: SupportedGeometry;
  dguid: string | null;
  dauid: string | null;
  provinceCode: string | null;
  name: string | null;
  landAreaSqKm: number | null;
  population: number | null;
  privateDwellings: number | null;
  populationDensityPerSqKm: number | null;
};

export type CensusLookupResult = {
  geographyLevel: 'dissemination_area';
  source: string;
  dguid: string | null;
  dauid: string | null;
  provinceCode: string | null;
  provinceName: string | null;
  name: string | null;
  landAreaSqKm: number | null;
  population: number | null;
  privateDwellings: number | null;
  populationDensityPerSqKm: number | null;
  censusYear: number;
  populationSource: string | null;
  boundaryGeometry: SupportedGeometry | null;
};

@Injectable()
export class CensusBoundaryService {
  private readonly logger = new Logger(CensusBoundaryService.name);
  private readonly sourceKey = 'statcan_2021_lda_000b21a_e';
  private readonly statcanLambertProj =
    '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=63.390675 +lon_0=-91.86666666666666 +x_0=6200000 +y_0=3000000 +datum=NAD83 +units=m +no_defs';
  private readonly wgs84Proj = 'WGS84';
  private readonly extractedDir = path.join(os.tmpdir(), 'ttc-viewer-census-2021');
  private readonly extractedShpName = 'lda_000b21a_e.shp';
  private readonly extractedDbfName = 'lda_000b21a_e.dbf';
  private readonly populationSourceKey = 'statcan_population_dwelling_counts_2021_da';
  private readonly populationHeatGridSize = 64;
  private readonly populationHeatMinZoom = 5;
  private readonly populationHeatMaxZoom = 16;
  private readonly spatialIndexBinSizeMeters = 25_000;
  private readonly populationHeatCacheTtlMs = 180_000;
  private loadPromise: Promise<void> | null = null;
  private loaded = false;
  private entries: CensusBoundaryEntry[] = [];
  private populationByDauid = new Map<string, { population: number | null; privateDwellings: number | null; density: number | null }>();
  private populationByDguid = new Map<string, { population: number | null; privateDwellings: number | null; density: number | null }>();
  private populationSpatialIndex = new Map<string, CensusBoundaryEntry[]>();
  private populationHeatCache = new Map<string, { expiresAt: number; tileData: Uint8Array }>();
  private populationDensityScaleMax = 1;

  async lookupByLatLon(lat: number | null | undefined, lon: number | null | undefined): Promise<CensusLookupResult | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const [projectedX, projectedY] = proj4(this.wgs84Proj, this.statcanLambertProj, [lon as number, lat as number]);
    if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) return null;
    await this.ensureLoaded();
    if (this.entries.length === 0) return null;

    const candidates = this.candidateEntriesForProjectedPoint(projectedX, projectedY);
    if (candidates.length === 0) return null;

    const matches = candidates.filter((entry) => this.pointInGeometry(projectedY, projectedX, entry.geometry));
    if (matches.length === 0) return null;

    const match = matches.reduce((best, current) => {
      const bestArea = this.entryAreaSqKm(best);
      const currentArea = this.entryAreaSqKm(current);
      return currentArea < bestArea ? current : best;
    });
    const populationInfo = this.resolvePopulation(match);

    return {
      geographyLevel: 'dissemination_area',
      source: this.sourceKey,
      dguid: match.dguid,
      dauid: match.dauid,
      provinceCode: match.provinceCode,
      provinceName: this.provinceName(match.provinceCode),
      name: match.name,
      landAreaSqKm: match.landAreaSqKm,
      population: populationInfo?.population ?? null,
      privateDwellings: populationInfo?.privateDwellings ?? null,
      populationDensityPerSqKm:
        populationInfo?.density ??
        (populationInfo?.population !== null &&
        populationInfo?.population !== undefined &&
        match.landAreaSqKm !== null &&
        match.landAreaSqKm > 0
          ? Number((populationInfo.population / match.landAreaSqKm).toFixed(2))
          : null),
      censusYear: 2021,
      populationSource: populationInfo ? this.populationSourceKey : null,
      boundaryGeometry: this.toWgs84Geometry(match.geometry),
    };
  }

  private entryAreaSqKm(entry: CensusBoundaryEntry) {
    if (entry.landAreaSqKm !== null && entry.landAreaSqKm > 0) return entry.landAreaSqKm;
    const lonSpan = Math.max(0, entry.bbox.maxLon - entry.bbox.minLon);
    const latSpan = Math.max(0, entry.bbox.maxLat - entry.bbox.minLat);
    // Approximate bbox area in km² for tie-breaking only.
    return lonSpan * latSpan * 8_500;
  }

  async getPopulationHeatHealth() {
    await this.ensureLoaded();
    const polygonsWithPopulation = this.entries.filter(
      (entry) => entry.populationDensityPerSqKm !== null && entry.populationDensityPerSqKm > 0,
    ).length;
    return {
      versionKey: this.populationHeatVersionKey(),
      gridSize: this.populationHeatGridSize,
      minZoom: this.populationHeatMinZoom,
      maxZoom: this.populationHeatMaxZoom,
      polygonCount: this.entries.length,
      polygonsWithPopulation,
      maxDensityScale: Number(this.populationDensityScaleMax.toFixed(2)),
      source: this.populationSourceKey,
      generatedAt: new Date().toISOString(),
    };
  }

  async getPopulationHeatTile(params: { z: number; x: number; y: number; versionKey?: string }) {
    await this.ensureLoaded();
    if (params.z < this.populationHeatMinZoom || params.z > this.populationHeatMaxZoom) return null;
    const cacheKey = `${params.z}:${params.x}:${params.y}`;
    const now = Date.now();
    const cached = this.populationHeatCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { tileData: cached.tileData, gridSize: this.populationHeatGridSize };
    }
    const tileData = this.buildPopulationHeatTile(params.z, params.x, params.y);
    this.populationHeatCache.set(cacheKey, {
      expiresAt: now + this.populationHeatCacheTtlMs,
      tileData,
    });
    this.gcPopulationHeatCache(now);
    return { tileData, gridSize: this.populationHeatGridSize };
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadEntries();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async loadEntries() {
    const zipPath = await this.resolveZipPath();
    if (!zipPath) {
      this.loaded = true;
      this.entries = [];
      this.logger.warn('No census boundary ZIP found; continuing without census boundary lookups.');
      return;
    }

    await fs.mkdir(this.extractedDir, { recursive: true });
    const shpPath = path.join(this.extractedDir, this.extractedShpName);
    const dbfPath = path.join(this.extractedDir, this.extractedDbfName);
    const [hasShp, hasDbf] = await Promise.all([this.pathExists(shpPath), this.pathExists(dbfPath)]);
    if (!hasShp || !hasDbf) {
      this.logger.log(`Extracting census boundaries from ${zipPath}`);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(this.extractedDir, true);
    }

    const source = await shapefile.open(shpPath, dbfPath);
    const loadedEntries: CensusBoundaryEntry[] = [];
    while (true) {
      const row = await source.read();
      if (row.done) break;
      const value = row.value as FeatureValue | undefined;
      const geometry = this.toSupportedGeometry(value?.geometry);
      if (!geometry || !value?.properties) continue;
      const bbox = this.computeGeometryBbox(geometry);
      if (!bbox) continue;
      loadedEntries.push({
        bbox,
        geometry,
        dguid: this.pickString(value.properties, ['DGUID']),
        dauid: this.pickString(value.properties, ['DAUID']),
        provinceCode: this.pickString(value.properties, ['PRUID']),
        name: this.pickString(value.properties, ['DA_NAME', 'CSDNAME', 'CMANAME']),
        landAreaSqKm: this.pickNumber(value.properties, ['LANDAREA', 'LANDAREA_KM2']),
        population: null,
        privateDwellings: null,
        populationDensityPerSqKm: null,
      });
    }
    this.entries = loadedEntries;
    await this.loadPopulationAttributes();
    this.buildPopulationSpatialIndex();
    this.computePopulationDensityScale();
    this.loaded = true;
    this.logger.log(`Loaded ${loadedEntries.length.toLocaleString()} census boundaries for lookup.`);
  }

  private async loadPopulationAttributes() {
    const csvPath = await this.resolvePopulationCsvPath();
    if (!csvPath) {
      this.logger.warn('No census population CSV found; lookup will return boundary-only context.');
      return;
    }
    const text = await fs.readFile(csvPath, 'utf8');
    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true,
      bom: true,
    }) as Array<Record<string, unknown>>;
    let matchedRows = 0;
    for (const record of records) {
      const dauid = this.pickStringByLooseHeader(record, ['DAUID', 'da uid', 'dissemination area uid']);
      const dguid = this.pickStringByLooseHeader(record, ['DGUID', 'dissemination geography unique identifier']);
      const population = this.pickNumberByLooseHeader(record, ['Population, 2021', 'Population', 'population']);
      const privateDwellings = this.pickNumberByLooseHeader(record, [
        'Private dwellings occupied by usual residents, 2021',
        'Private dwellings',
        'private dwellings',
      ]);
      const density = this.pickNumberByLooseHeader(record, [
        'Population density per square kilometre, 2021',
        'Population density per square kilometre',
        'population density',
      ]);
      if (!dauid && !dguid) continue;
      const payload = {
        population: population ?? null,
        privateDwellings: privateDwellings ?? null,
        density: density ?? null,
      };
      if (dauid) this.populationByDauid.set(dauid, payload);
      if (dguid) this.populationByDguid.set(dguid, payload);
      matchedRows += 1;
    }
    for (const entry of this.entries) {
      const resolved = this.resolvePopulation(entry);
      if (!resolved) continue;
      entry.population = resolved.population;
      entry.privateDwellings = resolved.privateDwellings;
      entry.populationDensityPerSqKm =
        resolved.density ??
        (resolved.population !== null &&
        resolved.population !== undefined &&
        entry.landAreaSqKm !== null &&
        entry.landAreaSqKm > 0
          ? Number((resolved.population / entry.landAreaSqKm).toFixed(2))
          : null);
    }
    this.logger.log(
      `Loaded census population attributes from ${path.basename(csvPath)} (${matchedRows.toLocaleString()} matched rows).`,
    );
  }

  private async resolveZipPath() {
    const configured = process.env.CENSUS_BOUNDARY_ZIP_PATH?.trim();
    const candidates = [
      configured,
      path.resolve(process.cwd(), '../../prisma/data/census/2021/lda_000b21a_e.zip'),
      path.resolve(process.cwd(), 'prisma/data/census/2021/lda_000b21a_e.zip'),
      path.resolve(process.cwd(), '../../../prisma/data/census/2021/lda_000b21a_e.zip'),
    ].filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) return candidate;
    }
    return null;
  }

  private async resolvePopulationCsvPath() {
    const configured = process.env.CENSUS_POPULATION_CSV_PATH?.trim();
    const candidates = [
      configured,
      path.resolve(process.cwd(), '../../prisma/data/census/2021/population_dwelling_counts_da_2021.csv'),
      path.resolve(process.cwd(), '../../prisma/data/census/2021/98-10-0015-01.csv'),
      path.resolve(process.cwd(), '../../prisma/data/census/2021/98-10-0015-01-eng.csv'),
      path.resolve(process.cwd(), '../../prisma/data/census/2021/98100015.csv'),
      path.resolve(process.cwd(), '../../prisma/data/census/2021/population_and_dwelling_counts.csv'),
      path.resolve(process.cwd(), 'prisma/data/census/2021/population_dwelling_counts_da_2021.csv'),
      path.resolve(process.cwd(), '../../../prisma/data/census/2021/population_dwelling_counts_da_2021.csv'),
    ].filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) return candidate;
    }
    return null;
  }

  private provinceName(code: string | null) {
    const map: Record<string, string> = {
      '10': 'Newfoundland and Labrador',
      '11': 'Prince Edward Island',
      '12': 'Nova Scotia',
      '13': 'New Brunswick',
      '24': 'Quebec',
      '35': 'Ontario',
      '46': 'Manitoba',
      '47': 'Saskatchewan',
      '48': 'Alberta',
      '59': 'British Columbia',
      '60': 'Yukon',
      '61': 'Northwest Territories',
      '62': 'Nunavut',
    };
    if (!code) return null;
    return map[code] ?? null;
  }

  private async pathExists(targetPath: string) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private pickString(properties: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = properties[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return null;
  }

  private pickNumber(properties: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = properties[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  }

  private pickStringByLooseHeader(record: Record<string, unknown>, aliases: string[]) {
    const key = this.findLooseHeaderKey(record, aliases);
    if (!key) return null;
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  private pickNumberByLooseHeader(record: Record<string, unknown>, aliases: string[]) {
    const key = this.findLooseHeaderKey(record, aliases);
    if (!key) return null;
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const cleaned = raw.replace(/,/g, '').trim();
      if (!cleaned || cleaned === '..' || cleaned.toLowerCase() === 'x') return null;
      const parsed = Number.parseFloat(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private findLooseHeaderKey(record: Record<string, unknown>, aliases: string[]) {
    const normalizedAliases = aliases.map((value) => this.normalizeHeader(value));
    for (const key of Object.keys(record)) {
      const normalizedKey = this.normalizeHeader(key);
      if (normalizedAliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias))) {
        return key;
      }
    }
    return null;
  }

  private normalizeHeader(value: string) {
    return value
      .toLowerCase()
      .replace(/\u00a0/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private resolvePopulation(match: CensusBoundaryEntry) {
    if (match.dauid && this.populationByDauid.has(match.dauid)) {
      return this.populationByDauid.get(match.dauid) ?? null;
    }
    if (match.dguid && this.populationByDguid.has(match.dguid)) {
      return this.populationByDguid.get(match.dguid) ?? null;
    }
    return null;
  }

  private populationHeatVersionKey() {
    return `da-pop-v1-g${this.populationHeatGridSize}-z${this.populationHeatMinZoom}-${this.populationHeatMaxZoom}-p${Math.round(this.populationDensityScaleMax)}-${this.entries.length}`;
  }

  private gcPopulationHeatCache(now = Date.now()) {
    for (const [key, value] of this.populationHeatCache.entries()) {
      if (value.expiresAt <= now) this.populationHeatCache.delete(key);
    }
    if (this.populationHeatCache.size <= 180) return;
    const keys = [...this.populationHeatCache.keys()];
    for (const key of keys.slice(0, this.populationHeatCache.size - 180)) {
      this.populationHeatCache.delete(key);
    }
  }

  private buildPopulationSpatialIndex() {
    this.populationSpatialIndex.clear();
    for (const entry of this.entries) {
      const minXBin = Math.floor(entry.bbox.minLon / this.spatialIndexBinSizeMeters);
      const maxXBin = Math.floor(entry.bbox.maxLon / this.spatialIndexBinSizeMeters);
      const minYBin = Math.floor(entry.bbox.minLat / this.spatialIndexBinSizeMeters);
      const maxYBin = Math.floor(entry.bbox.maxLat / this.spatialIndexBinSizeMeters);
      for (let xb = minXBin; xb <= maxXBin; xb += 1) {
        for (let yb = minYBin; yb <= maxYBin; yb += 1) {
          const key = `${xb}:${yb}`;
          const bucket = this.populationSpatialIndex.get(key) ?? [];
          bucket.push(entry);
          this.populationSpatialIndex.set(key, bucket);
        }
      }
    }
  }

  private computePopulationDensityScale() {
    const densities = this.entries
      .map((entry) => entry.populationDensityPerSqKm)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (densities.length === 0) {
      this.populationDensityScaleMax = 1;
      return;
    }
    const percentileIndex = Math.max(0, Math.min(densities.length - 1, Math.floor((densities.length - 1) * 0.98)));
    this.populationDensityScaleMax = Math.max(1, densities[percentileIndex] ?? densities[densities.length - 1] ?? 1);
  }

  private candidateEntriesForProjectedPoint(projectedX: number, projectedY: number) {
    const xBin = Math.floor(projectedX / this.spatialIndexBinSizeMeters);
    const yBin = Math.floor(projectedY / this.spatialIndexBinSizeMeters);
    const bucket = this.populationSpatialIndex.get(`${xBin}:${yBin}`) ?? this.entries;
    return bucket.filter(
      (entry) =>
        projectedX >= entry.bbox.minLon &&
        projectedX <= entry.bbox.maxLon &&
        projectedY >= entry.bbox.minLat &&
        projectedY <= entry.bbox.maxLat,
    );
  }

  private buildPopulationHeatTile(z: number, x: number, y: number) {
    const gridSize = this.populationHeatGridSize;
    const bins = new Uint8Array(gridSize * gridSize);
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const { lat, lon } = this.tileCellCenterLatLon(z, x, y, col, row, gridSize);
        const [projectedX, projectedY] = proj4(this.wgs84Proj, this.statcanLambertProj, [lon, lat]);
        if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) continue;
        const candidates = this.candidateEntriesForProjectedPoint(projectedX, projectedY);
        if (candidates.length === 0) continue;
        let matched: CensusBoundaryEntry | null = null;
        let matchedArea = Number.POSITIVE_INFINITY;
        for (const entry of candidates) {
          if (!this.pointInGeometry(projectedY, projectedX, entry.geometry)) continue;
          const area = this.entryAreaSqKm(entry);
          if (area < matchedArea) {
            matchedArea = area;
            matched = entry;
          }
        }
        if (!matched || !matched.populationDensityPerSqKm || matched.populationDensityPerSqKm <= 0) continue;
        const normalized = Math.max(0, Math.min(1, matched.populationDensityPerSqKm / this.populationDensityScaleMax));
        const intensity = Math.pow(normalized, 0.62);
        const encoded = Math.round(intensity * 255);
        bins[row * gridSize + col] = encoded <= 0 ? 1 : encoded;
      }
    }
    return bins;
  }

  private tileCellCenterLatLon(z: number, x: number, y: number, col: number, row: number, gridSize: number) {
    const worldSize = 256 * Math.pow(2, z);
    const pixelX = x * 256 + ((col + 0.5) / gridSize) * 256;
    const pixelY = y * 256 + ((row + 0.5) / gridSize) * 256;
    const lon = (pixelX / worldSize) * 360 - 180;
    const mercator = Math.PI - (2 * Math.PI * pixelY) / worldSize;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercator) - Math.exp(-mercator)));
    return { lat, lon };
  }

  private toWgs84Geometry(geometry: SupportedGeometry): SupportedGeometry | null {
    if (geometry.type === 'Polygon') {
      const coordinates = geometry.coordinates
        .map((ring) => ring.map((point) => this.toWgs84Point(point)).filter(Boolean) as Coordinate[])
        .filter((ring) => ring.length >= 4);
      if (coordinates.length === 0) return null;
      return {
        type: 'Polygon',
        coordinates,
      };
    }
    const coordinates = geometry.coordinates
      .map((polygon) =>
        polygon
          .map((ring) => ring.map((point) => this.toWgs84Point(point)).filter(Boolean) as Coordinate[])
          .filter((ring) => ring.length >= 4),
      )
      .filter((polygon) => polygon.length > 0);
    if (coordinates.length === 0) return null;
    return {
      type: 'MultiPolygon',
      coordinates,
    };
  }

  private toWgs84Point(point: Coordinate): Coordinate | null {
    const [x, y] = point;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const [lon, lat] = proj4(this.statcanLambertProj, this.wgs84Proj, [x, y]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  }

  private computeGeometryBbox(geometry: SupportedGeometry): Bbox | null {
    let minLon = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        for (const point of ring) {
          const [lon, lat] = point;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    } else {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          for (const point of ring) {
            const [lon, lat] = point;
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }
    }

    if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
      return null;
    }

    return { minLon, minLat, maxLon, maxLat };
  }

  private toSupportedGeometry(input: FeatureValue['geometry']): SupportedGeometry | null {
    if (!input || typeof input !== 'object') return null;
    if (input.type === 'Polygon' && Array.isArray(input.coordinates)) {
      return { type: 'Polygon', coordinates: input.coordinates as Coordinate[][] };
    }
    if (input.type === 'MultiPolygon' && Array.isArray(input.coordinates)) {
      return { type: 'MultiPolygon', coordinates: input.coordinates as Coordinate[][][] };
    }
    return null;
  }

  private pointInGeometry(lat: number, lon: number, geometry: SupportedGeometry) {
    if (geometry.type === 'Polygon') {
      return this.pointInPolygon(lat, lon, geometry.coordinates);
    }
    for (const polygon of geometry.coordinates) {
      if (this.pointInPolygon(lat, lon, polygon)) return true;
    }
    return false;
  }

  private pointInPolygon(lat: number, lon: number, polygon: Coordinate[][]) {
    const outerRing = polygon[0];
    if (!outerRing || !this.pointInRing(lat, lon, outerRing)) return false;
    for (let holeIndex = 1; holeIndex < polygon.length; holeIndex += 1) {
      const holeRing = polygon[holeIndex];
      if (holeRing && this.pointInRing(lat, lon, holeRing)) return false;
    }
    return true;
  }

  private pointInRing(lat: number, lon: number, ring: Coordinate[]) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i] ?? [0, 0];
      const [xj, yj] = ring[j] ?? [0, 0];
      const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }
}
