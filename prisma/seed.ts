import { createHash } from 'node:crypto';
import { parse as parseCsvRaw } from 'csv-parse/sync';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { DataProvenance, LifecycleStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GTFS_ROOT = resolve(SCRIPT_DIR, 'data/gtfs');
const DATA_SOURCES_CSV = resolve(SCRIPT_DIR, 'data/data_sources.csv');
const REQUIRED_TABLES = ['agency', 'routes', 'stops', 'trips', 'stop_times'] as const;
const STRUCTURED_TABLES = new Set([
  'agency',
  'calendar',
  'calendar_dates',
  'routes',
  'stops',
  'trips',
  'stop_times',
  'shapes',
  'feed_info',
  'fare_attributes',
  'fare_rules',
  'frequencies',
  'transfers',
  'levels',
  'pathways',
]);
const CHUNK_SIZE = 10_000;

type CsvRow = Record<string, string>;
type TableMap = Record<string, CsvRow[]>;

type ResolvedSource =
  | { kind: 'zip'; zipPath: string; sourcePath: string }
  | { kind: 'dir'; dirPath: string; sourcePath: string };

type ValidationStats = {
  missingRouteRefs: number;
  missingTripRefs: number;
  missingStopRefs: number;
};

type SourceRecord = {
  custom_id?: string;
  prov_terr?: string;
};

type RidershipCsvRow = {
  REF_DATE?: string;
  'Urban transit agency name'?: string;
  'Total revenue and total passenger trips'?: string;
  VALUE?: string;
};

type RidershipPoint = {
  month: string;
  value: number;
};

type AgencyRidershipSummary = {
  sourceTableId: string;
  agencyName: string;
  latestPassengerTripsThousands: number | null;
  latestPassengerTripsMonth: string | null;
  latestRevenueThousandsCad: number | null;
  latestRevenueMonth: string | null;
  series: {
    passengerTripsThousands: RidershipPoint[];
    revenueThousandsCad: RidershipPoint[];
  };
};

const RIDERSHIP_CSV = resolve(SCRIPT_DIR, 'data/ridership/canada/23100307.csv');
const RIDERSHIP_TABLE_ID = '23100307';
const RIDERSHIP_SLUG_ALIASES: Record<string, string[]> = {
  t3_transit: ['Trius transit INC., Prince Edward Island (T3)'],
  reseau_transport_longueuil: ['Reseau de transport de Longueuil', 'Réseau de transport de Longueuil'],
  societe_transport_montreal: ['Societe de transport de Montreal (STM)', 'Société de transport de Montréal (STM)'],
  toronto_transit_commission: ['Toronto transit commission (TTC)'],
  go_transit: ['Metrolinx, Greater Toronto and Hamilton Area (GTHA)'],
  edmonton_transit_service: ['Edmonton Transit Service (ETS)'],
  translink_vancouver: ['South Coast British Columbia Transportation Authority (Translink)'],
  bc_transit_victoria: ['BC Transit (Victoria Regional Transit System)'],
};

function parseCsv(input: string): CsvRow[] {
  const baseOptions = {
    columns: (headers: string[]) => headers.map((header) => header.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_quotes: true,
    record_delimiter: ['\r\n', '\n', '\r'],
  } as const;

  try {
    return parseCsvRaw(input, baseOptions) as CsvRow[];
  } catch {
    // Some feeds contain mixed line endings and occasional inconsistent rows.
    // Fallback keeps ingestion progressing while preserving parseable records.
    return parseCsvRaw(input, {
      ...baseOptions,
      relax_column_count: true,
      skip_records_with_error: true,
    }) as CsvRow[];
  }
}

function toNullableString(value: string | undefined | null) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function toRequiredInt(value: string | undefined | null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableInt(value: string | undefined | null) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableFloat(value: string | undefined | null) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toRequiredBoolean(value: string | undefined | null) {
  return String(value ?? '').trim() === '1';
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getTable(tables: TableMap, tableName: string): CsvRow[] {
  return tables[tableName] ?? [];
}

function normalizeRidershipName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugToAgencyLikeName(slug: string) {
  return slug.replaceAll('_', ' ');
}

function metricKeyFromLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('total passenger trips')) return 'passengerTripsThousands' as const;
  if (normalized.includes('total revenue, excluding subsidies')) return 'revenueThousandsCad' as const;
  return null;
}

async function loadRidershipByAgencyName() {
  try {
    const input = await readFile(RIDERSHIP_CSV, 'utf8');
    const rows = parseCsv(input) as RidershipCsvRow[];
    const grouped = new Map<
      string,
      {
        agencyName: string;
        passengerTripsThousands: Map<string, number>;
        revenueThousandsCad: Map<string, number>;
      }
    >();

    for (const row of rows) {
      const agencyName = toNullableString(row['Urban transit agency name']);
      const month = toNullableString(row.REF_DATE);
      const metricLabel = toNullableString(row['Total revenue and total passenger trips']);
      const metricKey = metricLabel ? metricKeyFromLabel(metricLabel) : null;
      const value = Number.parseFloat(String(row.VALUE ?? '').trim());

      if (!agencyName || !month || !metricKey || !Number.isFinite(value)) continue;
      const key = normalizeRidershipName(agencyName);
      const current = grouped.get(key) ?? {
        agencyName,
        passengerTripsThousands: new Map<string, number>(),
        revenueThousandsCad: new Map<string, number>(),
      };
      current[metricKey].set(month, value);
      grouped.set(key, current);
    }

    const result = new Map<string, AgencyRidershipSummary>();
    for (const [key, value] of grouped.entries()) {
      const passengerTripsThousands = [...value.passengerTripsThousands.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, monthValue]) => ({ month, value: monthValue }));
      const revenueThousandsCad = [...value.revenueThousandsCad.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, monthValue]) => ({ month, value: monthValue }));

      const latestPassenger = passengerTripsThousands[passengerTripsThousands.length - 1];
      const latestRevenue = revenueThousandsCad[revenueThousandsCad.length - 1];
      result.set(key, {
        sourceTableId: RIDERSHIP_TABLE_ID,
        agencyName: value.agencyName,
        latestPassengerTripsThousands: latestPassenger?.value ?? null,
        latestPassengerTripsMonth: latestPassenger?.month ?? null,
        latestRevenueThousandsCad: latestRevenue?.value ?? null,
        latestRevenueMonth: latestRevenue?.month ?? null,
        series: {
          passengerTripsThousands,
          revenueThousandsCad,
        },
      });
    }

    return result;
  } catch {
    // Keep seed resilient if optional ridership metadata is unavailable.
    return new Map<string, AgencyRidershipSummary>();
  }
}

function resolveRidershipForSlug(slug: string, ridershipByAgencyName: Map<string, AgencyRidershipSummary>) {
  const fallbackNames = [slugToAgencyLikeName(slug), ...(RIDERSHIP_SLUG_ALIASES[slug] ?? [])];
  for (const candidate of fallbackNames) {
    const summary = ridershipByAgencyName.get(normalizeRidershipName(candidate));
    if (summary) return summary;
  }
  return null;
}

async function listAgencyDirectories() {
  const entries = await readdir(GTFS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      slug: entry.name,
      folderPath: join(GTFS_ROOT, entry.name),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

async function loadProvinceBySlug() {
  try {
    const input = await readFile(DATA_SOURCES_CSV, 'utf8');
    const rows = parseCsv(input) as SourceRecord[];
    const provinceBySlug = new Map<string, string>();
    for (const row of rows) {
      const slug = toNullableString(row.custom_id);
      const province = toNullableString(row.prov_terr)?.toUpperCase();
      if (!slug || !province) continue;
      provinceBySlug.set(slug, province);
    }
    return provinceBySlug;
  } catch {
    // Keep seed resilient if optional source metadata is unavailable.
    return new Map<string, string>();
  }
}

async function resolveAgencySource(folderPath: string): Promise<ResolvedSource | null> {
  const zipPath = join(folderPath, 'gtfs.zip');
  try {
    const zipStats = await stat(zipPath);
    if (zipStats.isFile()) {
      return { kind: 'zip', zipPath, sourcePath: zipPath };
    }
  } catch {
    // noop
  }

  const extractedDir = join(folderPath, 'gtfs');
  try {
    const dirStats = await stat(extractedDir);
    if (dirStats.isDirectory()) {
      return { kind: 'dir', dirPath: extractedDir, sourcePath: extractedDir };
    }
  } catch {
    // noop
  }

  return null;
}

async function readTablesFromDirectory(dirPath: string): Promise<{ tables: TableMap; tableNames: string[] }> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const tableFiles = entries.filter((entry) => entry.isFile() && ['.txt', '.csv'].includes(extname(entry.name).toLowerCase()));
  const tableNames: string[] = [...new Set(tableFiles.map((entry) => basename(entry.name, extname(entry.name)).toLowerCase()))].sort();
  const tables: TableMap = {};

  for (const tableName of tableNames) {
    const txtPath = join(dirPath, `${tableName}.txt`);
    const csvPath = join(dirPath, `${tableName}.csv`);
    let text = '';
    try {
      text = await readFile(txtPath, 'utf8');
    } catch {
      try {
        text = await readFile(csvPath, 'utf8');
      } catch {
        text = '';
      }
    }
    tables[tableName] = text ? parseCsv(text) : [];
  }

  return { tables, tableNames };
}

function readTablesFromZip(zipPath: string): { tables: TableMap; tableNames: string[] } {
  const zip = new AdmZip(zipPath);
  const tableEntryMap = new Map<string, AdmZip.IZipEntry>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const normalizedPath = entry.entryName.toLowerCase().replace(/^\.?\//, '');
    const ext = extname(normalizedPath);
    if (ext !== '.txt' && ext !== '.csv') continue;
    const tableName = basename(normalizedPath, ext).toLowerCase();
    if (!tableEntryMap.has(tableName) || normalizedPath.startsWith('gtfs/')) {
      tableEntryMap.set(tableName, entry);
    }
  }

  const tableNames: string[] = [...tableEntryMap.keys()].sort();
  const tables: TableMap = {};
  for (const tableName of tableNames) {
    const entry = tableEntryMap.get(tableName);
    tables[tableName] = entry ? parseCsv(zip.readAsText(entry)) : [];
  }
  return { tables, tableNames };
}

async function readTables(source: ResolvedSource) {
  if (source.kind === 'dir') {
    return readTablesFromDirectory(source.dirPath);
  }
  return readTablesFromZip(source.zipPath);
}

function computeVersionHash(slug: string, tables: TableMap, tableNames: string[]) {
  const digest = createHash('sha256');
  digest.update(slug);
  for (const tableName of tableNames) {
    const rows = getTable(tables, tableName);
    digest.update(tableName);
    digest.update(String(rows.length));
    if (rows.length > 0) {
      digest.update(JSON.stringify(rows[0]));
      digest.update(JSON.stringify(rows[rows.length - 1]));
    }
  }
  return digest.digest('hex').slice(0, 24);
}

function validateTables(tables: TableMap): { errors: string[]; validation: ValidationStats } {
  const errors: string[] = [];
  for (const table of REQUIRED_TABLES) {
    if (getTable(tables, table).length === 0) {
      errors.push(`Missing required table ${table}.txt`);
    }
  }

  const routes = getTable(tables, 'routes');
  const trips = getTable(tables, 'trips');
  const stops = getTable(tables, 'stops');
  const stopTimes = getTable(tables, 'stop_times');

  const routeIds = new Set(routes.map((row) => row.route_id).filter(Boolean));
  const tripIds = new Set(trips.map((row) => row.trip_id).filter(Boolean));
  const stopIds = new Set(stops.map((row) => row.stop_id).filter(Boolean));

  let missingRouteRefs = 0;
  for (const trip of trips) {
    if (trip.route_id && !routeIds.has(trip.route_id)) missingRouteRefs += 1;
  }

  let missingTripRefs = 0;
  let missingStopRefs = 0;
  for (const stopTime of stopTimes) {
    if (stopTime.trip_id && !tripIds.has(stopTime.trip_id)) missingTripRefs += 1;
    if (stopTime.stop_id && !stopIds.has(stopTime.stop_id)) missingStopRefs += 1;
  }

  return {
    errors,
    validation: { missingRouteRefs, missingTripRefs, missingStopRefs },
  };
}

async function insertGtfsTables(feedVersionId: string, tables: TableMap, tableNames: string[], now: Date) {
  const agency = getTable(tables, 'agency');
  const calendar = getTable(tables, 'calendar');
  const calendarDates = getTable(tables, 'calendar_dates');
  const routes = getTable(tables, 'routes');
  const stops = getTable(tables, 'stops');
  const trips = getTable(tables, 'trips');
  const shapes = getTable(tables, 'shapes');
  const stopTimes = getTable(tables, 'stop_times');
  const feedInfo = getTable(tables, 'feed_info');
  const fareAttributes = getTable(tables, 'fare_attributes');
  const fareRules = getTable(tables, 'fare_rules');
  const frequencies = getTable(tables, 'frequencies');
  const transfers = getTable(tables, 'transfers');
  const levels = getTable(tables, 'levels');
  const pathways = getTable(tables, 'pathways');

  if (feedInfo.length > 0) {
    const row = feedInfo[0];
    await prisma.gtfsFeedInfo.create({
      data: {
        feedVersionId,
        feedPublisherName: toNullableString(row.feed_publisher_name),
        feedPublisherUrl: toNullableString(row.feed_publisher_url),
        feedLang: toNullableString(row.feed_lang),
        defaultLang: toNullableString(row.default_lang),
        feedStartDate: toNullableString(row.feed_start_date),
        feedEndDate: toNullableString(row.feed_end_date),
        feedVersion: toNullableString(row.feed_version),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      },
    });
  }

  if (agency.length > 0) {
    await prisma.gtfsAgency.createMany({
      data: agency.map((row) => ({
        feedVersionId,
        agencyId: toNullableString(row.agency_id),
        agencyName: row.agency_name,
        agencyUrl: row.agency_url,
        agencyTimezone: row.agency_timezone,
        agencyLang: toNullableString(row.agency_lang),
        agencyPhone: toNullableString(row.agency_phone),
        agencyFareUrl: toNullableString(row.agency_fare_url),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (calendar.length > 0) {
    await prisma.gtfsCalendar.createMany({
      data: calendar.map((row) => ({
        feedVersionId,
        serviceId: row.service_id,
        monday: toRequiredBoolean(row.monday),
        tuesday: toRequiredBoolean(row.tuesday),
        wednesday: toRequiredBoolean(row.wednesday),
        thursday: toRequiredBoolean(row.thursday),
        friday: toRequiredBoolean(row.friday),
        saturday: toRequiredBoolean(row.saturday),
        sunday: toRequiredBoolean(row.sunday),
        startDate: row.start_date,
        endDate: row.end_date,
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (calendarDates.length > 0) {
    await prisma.gtfsCalendarDate.createMany({
      data: calendarDates.map((row) => ({
        feedVersionId,
        serviceId: row.service_id,
        date: row.date,
        exceptionType: toRequiredInt(row.exception_type),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (routes.length > 0) {
    await prisma.gtfsRoute.createMany({
      data: routes.map((row) => ({
        feedVersionId,
        routeId: row.route_id,
        agencyId: toNullableString(row.agency_id),
        routeShortName: toNullableString(row.route_short_name),
        routeLongName: toNullableString(row.route_long_name),
        routeDesc: toNullableString(row.route_desc),
        routeType: toRequiredInt(row.route_type),
        routeUrl: toNullableString(row.route_url),
        routeColor: toNullableString(row.route_color),
        routeTextColor: toNullableString(row.route_text_color),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (stops.length > 0) {
    await prisma.gtfsStop.createMany({
      data: stops.map((row) => ({
        feedVersionId,
        stopId: row.stop_id,
        stopCode: toNullableString(row.stop_code),
        stopName: row.stop_name,
        stopDesc: toNullableString(row.stop_desc),
        stopLat: toNullableFloat(row.stop_lat),
        stopLon: toNullableFloat(row.stop_lon),
        zoneId: toNullableString(row.zone_id),
        stopUrl: toNullableString(row.stop_url),
        locationType: toNullableInt(row.location_type),
        parentStation: toNullableString(row.parent_station),
        wheelchairBoarding: toNullableInt(row.wheelchair_boarding),
        platformCode: toNullableString(row.platform_code),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (trips.length > 0) {
    const validServiceIds = new Set(calendar.map((row) => row.service_id).filter(Boolean));
    await prisma.gtfsTrip.createMany({
      data: trips.map((row) => ({
        feedVersionId,
        tripId: row.trip_id,
        routeId: row.route_id,
        serviceId:
          validServiceIds.size === 0
            ? null
            : validServiceIds.has(row.service_id)
              ? toNullableString(row.service_id)
              : null,
        tripHeadsign: toNullableString(row.trip_headsign),
        tripShortName: toNullableString(row.trip_short_name),
        directionId: toNullableInt(row.direction_id),
        blockId: toNullableString(row.block_id),
        shapeId: toNullableString(row.shape_id),
        wheelchairAccessible: toNullableInt(row.wheelchair_accessible),
        bikesAllowed: toNullableInt(row.bikes_allowed),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (shapes.length > 0) {
    for (const chunk of chunkArray(shapes, CHUNK_SIZE)) {
      await prisma.gtfsShapePoint.createMany({
        data: chunk.map((row) => ({
          feedVersionId,
          shapeId: row.shape_id,
          shapePtLat: toNullableFloat(row.shape_pt_lat) ?? 0,
          shapePtLon: toNullableFloat(row.shape_pt_lon) ?? 0,
          shapePtSequence: toRequiredInt(row.shape_pt_sequence),
          shapeDistTraveled: toNullableFloat(row.shape_dist_traveled),
          source: DataProvenance.OFFICIAL,
          status: LifecycleStatus.EXISTING,
          effectiveFrom: now,
          raw: row,
        })),
        skipDuplicates: true,
      });
    }
  }

  if (stopTimes.length > 0) {
    for (const chunk of chunkArray(stopTimes, CHUNK_SIZE)) {
      await prisma.gtfsStopTime.createMany({
        data: chunk.map((row) => ({
          feedVersionId,
          tripId: row.trip_id,
          arrivalTime: toNullableString(row.arrival_time),
          departureTime: toNullableString(row.departure_time),
          stopId: row.stop_id,
          stopSequence: toRequiredInt(row.stop_sequence),
          stopHeadsign: toNullableString(row.stop_headsign),
          pickupType: toNullableInt(row.pickup_type),
          dropOffType: toNullableInt(row.drop_off_type),
          shapeDistTraveled: toNullableFloat(row.shape_dist_traveled),
          timepoint: toNullableInt(row.timepoint),
          source: DataProvenance.OFFICIAL,
          status: LifecycleStatus.EXISTING,
          effectiveFrom: now,
          raw: row,
        })),
        skipDuplicates: true,
      });
    }
  }

  if (fareAttributes.length > 0) {
    await prisma.gtfsFareAttribute.createMany({
      data: fareAttributes.map((row) => ({
        feedVersionId,
        fareId: row.fare_id,
        price: toNullableFloat(row.price),
        currencyType: toNullableString(row.currency_type),
        paymentMethod: toNullableInt(row.payment_method),
        transfers: toNullableInt(row.transfers),
        agencyId: toNullableString(row.agency_id),
        transferDuration: toNullableInt(row.transfer_duration),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (fareRules.length > 0) {
    await prisma.gtfsFareRule.createMany({
      data: fareRules.map((row) => ({
        feedVersionId,
        fareId: row.fare_id,
        routeId: toNullableString(row.route_id),
        originId: toNullableString(row.origin_id),
        destinationId: toNullableString(row.destination_id),
        containsId: toNullableString(row.contains_id),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (frequencies.length > 0) {
    await prisma.gtfsFrequency.createMany({
      data: frequencies.map((row) => ({
        feedVersionId,
        tripId: row.trip_id,
        startTime: toNullableString(row.start_time),
        endTime: toNullableString(row.end_time),
        headwaySecs: toNullableInt(row.headway_secs),
        exactTimes: toNullableInt(row.exact_times),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (transfers.length > 0) {
    await prisma.gtfsTransfer.createMany({
      data: transfers.map((row) => ({
        feedVersionId,
        fromStopId: row.from_stop_id,
        toStopId: row.to_stop_id,
        transferType: toNullableInt(row.transfer_type),
        minTransferTime: toNullableInt(row.min_transfer_time),
        fromRouteId: toNullableString(row.from_route_id),
        toRouteId: toNullableString(row.to_route_id),
        fromTripId: toNullableString(row.from_trip_id),
        toTripId: toNullableString(row.to_trip_id),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (levels.length > 0) {
    await prisma.gtfsLevel.createMany({
      data: levels.map((row) => ({
        feedVersionId,
        levelId: row.level_id,
        levelIndex: toNullableFloat(row.level_index),
        levelName: toNullableString(row.level_name),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  if (pathways.length > 0) {
    await prisma.gtfsPathway.createMany({
      data: pathways.map((row) => ({
        feedVersionId,
        pathwayId: row.pathway_id,
        fromStopId: toNullableString(row.from_stop_id),
        toStopId: toNullableString(row.to_stop_id),
        pathwayMode: toNullableInt(row.pathway_mode),
        isBidirectional: toNullableInt(row.is_bidirectional),
        length: toNullableFloat(row.length),
        traversalTime: toNullableInt(row.traversal_time),
        stairCount: toNullableInt(row.stair_count),
        maxSlope: toNullableFloat(row.max_slope),
        minWidth: toNullableFloat(row.min_width),
        signpostedAs: toNullableString(row.signposted_as),
        reversedSignpostedAs: toNullableString(row.reversed_signposted_as),
        source: DataProvenance.OFFICIAL,
        status: LifecycleStatus.EXISTING,
        effectiveFrom: now,
        raw: row,
      })),
      skipDuplicates: true,
    });
  }

  const rawTableNames = tableNames.filter((tableName) => !STRUCTURED_TABLES.has(tableName));
  for (const tableName of rawTableNames) {
    const rows = getTable(tables, tableName);
    if (rows.length === 0) continue;
    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      const chunk = rows.slice(start, start + CHUNK_SIZE);
      await prisma.gtfsRawTableRow.createMany({
        data: chunk.map((row, index) => ({
          feedVersionId,
          tableName,
          rowIndex: start + index,
          rowData: row,
          source: DataProvenance.OFFICIAL,
          status: LifecycleStatus.EXISTING,
          effectiveFrom: now,
        })),
        skipDuplicates: true,
      });
    }
  }
}

async function importAgency(
  folderPath: string,
  slug: string,
  provinceBySlug: Map<string, string>,
  ridershipByAgencyName: Map<string, AgencyRidershipSummary>,
) {
  const source = await resolveAgencySource(folderPath);
  if (!source) {
    return {
      slug,
      status: 'skipped',
      reason: 'No gtfs.zip or extracted gtfs/ directory found',
    };
  }

  const now = new Date();
  const seededProvince = provinceBySlug.get(slug) ?? null;
  const ridershipSummary = resolveRidershipForSlug(slug, ridershipByAgencyName);
  const rawAgencyMetadata = {
    folderPath,
    ridership: ridershipSummary,
  };
  const agency = await prisma.agency.upsert({
    where: { slug },
    update: {
      displayName: slug.replaceAll('_', ' '),
      subdivisionCode: seededProvince,
      source: DataProvenance.OFFICIAL,
      status: LifecycleStatus.EXISTING,
      effectiveFrom: now,
      raw: rawAgencyMetadata,
    },
    create: {
      slug,
      displayName: slug.replaceAll('_', ' '),
      countryCode: 'CA',
      subdivisionCode: seededProvince,
      source: DataProvenance.OFFICIAL,
      status: LifecycleStatus.EXISTING,
      effectiveFrom: now,
      raw: rawAgencyMetadata,
    },
  });

  const feedSource = await prisma.gtfsFeedSource.upsert({
    where: {
      agencyId_sourceKey: {
        agencyId: agency.id,
        sourceKey: 'offline-local',
      },
    },
    update: {
      sourceType: source.kind === 'zip' ? 'local_zip' : 'local_directory',
      basePath: folderPath,
      zipPath: source.kind === 'zip' ? source.zipPath : null,
      extractedPath: source.kind === 'dir' ? source.dirPath : null,
      enabled: true,
      source: DataProvenance.OFFICIAL,
      status: LifecycleStatus.EXISTING,
      effectiveFrom: now,
      raw: { sourcePath: source.sourcePath },
    },
    create: {
      agencyId: agency.id,
      sourceKey: 'offline-local',
      sourceType: source.kind === 'zip' ? 'local_zip' : 'local_directory',
      basePath: folderPath,
      zipPath: source.kind === 'zip' ? source.zipPath : null,
      extractedPath: source.kind === 'dir' ? source.dirPath : null,
      enabled: true,
      source: DataProvenance.OFFICIAL,
      status: LifecycleStatus.EXISTING,
      effectiveFrom: now,
      raw: { sourcePath: source.sourcePath },
    },
  });

  const { tables, tableNames } = await readTables(source);
  const primaryAgencyRow = getTable(tables, 'agency')[0];
  const agencyTimezone = toNullableString(primaryAgencyRow?.agency_timezone);
  if (agencyTimezone) {
    await prisma.agency.update({
      where: { id: agency.id },
      data: { timezone: agencyTimezone },
    });
  }
  const { errors, validation } = validateTables(tables);
  const rowsRead = tableNames.reduce((sum, tableName) => sum + getTable(tables, tableName).length, 0);

  const importRun = await prisma.gtfsImportRun.create({
    data: {
      feedSourceId: feedSource.id,
      status: errors.length > 0 ? 'FAILED' : 'RUNNING',
      startedAt: now,
      rowsRead,
      rowsInserted: 0,
      rowsRejected: validation.missingRouteRefs + validation.missingTripRefs + validation.missingStopRefs,
      warningCount: errors.length + validation.missingRouteRefs + validation.missingTripRefs + validation.missingStopRefs,
      errorMessage: errors.length > 0 ? errors.join('; ') : null,
      stats: {
        tableNames,
        tableRowCounts: Object.fromEntries(tableNames.map((name) => [name, getTable(tables, name).length])),
        validation,
      },
    },
  });

  if (errors.length > 0) {
    await prisma.gtfsImportRun.update({
      where: { id: importRun.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
      },
    });

    return {
      slug,
      status: 'failed',
      reason: errors.join(', '),
    };
  }

  const versionHash = computeVersionHash(slug, tables, tableNames);
  const existingVersion = await prisma.gtfsFeedVersion.findUnique({
    where: {
      agencyId_versionHash: {
        agencyId: agency.id,
        versionHash,
      },
    },
    select: {
      id: true,
      importRun: {
        select: { status: true },
      },
    },
  });

  if (existingVersion && existingVersion.importRun.status === 'SUCCEEDED') {
    await prisma.gtfsFeedVersion.updateMany({
      where: { agencyId: agency.id, isActive: true, id: { not: existingVersion.id } },
      data: { isActive: false, effectiveTo: now },
    });
    await prisma.gtfsFeedVersion.update({
      where: { id: existingVersion.id },
      data: { isActive: true, effectiveTo: null, importRunId: importRun.id, importedAt: now },
    });
    await prisma.gtfsImportRun.update({
      where: { id: importRun.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        rowsInserted: 0,
        stats: {
          tableNames,
          tableRowCounts: Object.fromEntries(tableNames.map((name) => [name, getTable(tables, name).length])),
          validation,
          feedVersionId: existingVersion.id,
          reusedExistingVersion: true,
        },
      },
    });

    return {
      slug,
      status: 'skipped',
      rowsRead,
      rowsInserted: 0,
      discoveredTables: tableNames.length,
      reusedExistingVersion: true,
    };
  }

  if (existingVersion) {
    await prisma.gtfsFeedVersion.delete({
      where: { id: existingVersion.id },
    });
  }

  await prisma.gtfsFeedVersion.updateMany({
    where: { agencyId: agency.id, isActive: true },
    data: { isActive: false, effectiveTo: now },
  });

  const feedVersion = await prisma.gtfsFeedVersion.create({
    data: {
      agencyId: agency.id,
      feedSourceId: feedSource.id,
      importRunId: importRun.id,
      versionHash,
      isActive: true,
      importedAt: now,
      source: DataProvenance.OFFICIAL,
      status: LifecycleStatus.EXISTING,
      effectiveFrom: now,
      raw: {
        sourcePath: source.sourcePath,
        tableNames,
        tableRowCounts: Object.fromEntries(tableNames.map((name) => [name, getTable(tables, name).length])),
      },
    },
  });

  try {
    await insertGtfsTables(feedVersion.id, tables, tableNames, now);
  } catch (error) {
    await prisma.gtfsImportRun.update({
      where: { id: importRun.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown import error',
      },
    });
    throw error;
  }
  const rowsInserted = tableNames.reduce((sum, tableName) => sum + getTable(tables, tableName).length, 0);
  await prisma.gtfsImportRun.update({
    where: { id: importRun.id },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      rowsInserted,
      stats: {
        tableNames,
        tableRowCounts: Object.fromEntries(tableNames.map((name) => [name, getTable(tables, name).length])),
        validation,
        feedVersionId: feedVersion.id,
      },
    },
  });

  return {
    slug,
    status: 'ok',
    rowsRead,
    rowsInserted,
    discoveredTables: tableNames.length,
  };
}

async function main() {
  const agencies = await listAgencyDirectories();
  const provinceBySlug = await loadProvinceBySlug();
  const ridershipByAgencyName = await loadRidershipByAgencyName();
  if (agencies.length === 0) {
    console.log('No GTFS agency directories found under prisma/data/gtfs.');
    return;
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const agency of agencies) {
    const result = await importAgency(agency.folderPath, agency.slug, provinceBySlug, ridershipByAgencyName);
    summary.push(result);
    console.log(`[seed][${agency.slug}] ${JSON.stringify(result)}`);
  }

  const successCount = summary.filter((row) => row.status === 'ok').length;
  const failedCount = summary.filter((row) => row.status === 'failed').length;
  const skippedCount = summary.filter((row) => row.status === 'skipped').length;
  console.log(`[seed] completed with success=${successCount} failed=${failedCount} skipped=${skippedCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
