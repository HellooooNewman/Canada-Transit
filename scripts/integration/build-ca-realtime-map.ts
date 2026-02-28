import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';

type Agency = {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  subdivisionCode: string | null;
  timezone: string | null;
  website: string | null;
  activeFeedVersionId: string | null;
  activeFeedImportedAt: string | null;
};

type MobilityFeed = {
  id: string;
  provider?: string | null;
  status?: string | null;
  official?: boolean | null;
  source_info?: { producer_url?: string | null } | null;
  external_ids?: Array<{ external_id?: string | null; source?: string | null }>;
};

type MobilityRtFeed = MobilityFeed & {
  entity_types?: string[] | null;
  feed_references?: string[] | null;
};

type OutputRealtime = {
  service_alerts: string | null;
  trip_updates: string | null;
  vehicle_positions: string | null;
};

type OutputAgencyRecord = {
  slug: string;
  agencyId: string;
  displayName: string;
  countryCode: 'CA';
  subdivisionCode: string | null;
  timezone: string | null;
  website: string | null;
  activeFeedVersionId: string | null;
  activeFeedImportedAt: string | null;
  realtime: OutputRealtime;
  source: {
    resolved_from: 'kevin_graphql' | 'mobilitydata_fallback';
    resolved_at_utc: string;
    evidence: Array<{ kind: string; query: string; path: string }>;
    notes: string;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const dataSourcesCsvPath = path.join(repoRoot, 'prisma', 'data', 'data_sources.csv');
const agencyMapOutputPath = path.join(repoRoot, 'agency_realtime_map.json');
const dedupeOutputPath = path.join(repoRoot, 'dedupe_report.json');

const kevinAgenciesQuery = `query {
  agencies {
    id
    slug
    displayName
    countryCode
    subdivisionCode
    timezone
    website
    activeFeedVersionId
    activeFeedImportedAt
  }
}`;

const mobilityGtfsFeedsQuery = '/v1/gtfs_feeds?country_code=CA&limit=2500';
const mobilityGtfsRtFeedsQuery = '/v1/gtfs_rt_feeds?country_code=CA&limit=1000';

function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function looksLikeNonProduction(url: string): boolean {
  return /(sandbox|staging|qa|test|demo|dev)/i.test(url);
}

function looksLikeJson(url: string): boolean {
  return /(\.json($|[?#]))|([/?]json($|[/?#]))/i.test(url);
}

function looksLikeProtobuf(url: string): boolean {
  return /(\.pb($|[?#]))|(protobuf)|(gtfsrt)/i.test(url) && !looksLikeJson(url);
}

function canonicalUrl(input: string | null | undefined): string {
  if (!input) return '';
  const raw = input.trim();
  if (!raw) return '';
  const maybeUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(maybeUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    const params = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const search = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    return `${host}${pathname}${search}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

async function loadEnvFromRepoIfNeeded() {
  if (process.env.MOBILITY_DATABASE_REFRESH_TOKEN && process.env.PUBLIC_API_BASE_URL) return;
  const envPath = path.join(repoRoot, '.env');
  try {
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Intentionally ignore: caller will fail with clear env var errors.
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
  }
  return response.json();
}

async function getMobilityAccessToken(refreshToken: string): Promise<string> {
  const tokenResponse = (await fetchJson('https://api.mobilitydatabase.org/v1/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })) as { access_token?: string };
  if (!tokenResponse.access_token) {
    throw new Error('Mobility token response did not include access_token.');
  }
  return tokenResponse.access_token;
}

async function getAgenciesFromKevin(apiBaseUrl: string): Promise<Agency[]> {
  try {
    const payload = (await fetchJson(apiBaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: kevinAgenciesQuery }),
    })) as { data?: { agencies?: Agency[] } };
    if (!payload.data?.agencies) {
      throw new Error('GraphQL response missing data.agencies.');
    }
    return payload.data.agencies.filter((agency) => agency.countryCode === 'CA');
  } catch (error) {
    // Some Kevin schemas expose agencies as JSON scalar; use scalar-mode fallback.
    const message = error instanceof Error ? error.message : String(error);
    if (!/agencies.*must not have a selection/i.test(message)) {
      throw error;
    }
    const fallbackPayload = (await fetchJson(apiBaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query { agencies }' }),
    })) as { data?: { agencies?: unknown[] } };
    if (!fallbackPayload.data?.agencies || !Array.isArray(fallbackPayload.data.agencies)) {
      throw new Error('GraphQL scalar fallback failed: data.agencies missing or not an array.');
    }
    const agencies = fallbackPayload.data.agencies as Agency[];
    return agencies.filter(
      (agency) =>
        agency &&
        typeof agency.slug === 'string' &&
        typeof agency.id === 'string' &&
        typeof agency.countryCode === 'string' &&
        agency.countryCode === 'CA',
    );
  }
}

async function getMobilityFeeds(accessToken: string): Promise<{ gtfsFeeds: MobilityFeed[]; gtfsRtFeeds: MobilityRtFeed[] }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [gtfsFeeds, gtfsRtFeeds] = await Promise.all([
    fetchJson(`https://api.mobilitydatabase.org${mobilityGtfsFeedsQuery}`, { headers }) as Promise<MobilityFeed[]>,
    fetchJson(`https://api.mobilitydatabase.org${mobilityGtfsRtFeedsQuery}`, { headers }) as Promise<MobilityRtFeed[]>,
  ]);
  return { gtfsFeeds, gtfsRtFeeds };
}

async function loadDataSourceMap(): Promise<Map<string, { directUrl: string | null; dataPage: string | null }>> {
  const csvText = await readFile(dataSourcesCsvPath, 'utf8');
  const records = parseCsv(csvText, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const map = new Map<string, { directUrl: string | null; dataPage: string | null }>();
  for (const row of records) {
    const slug = (row.custom_id ?? '').trim();
    if (!slug) continue;
    map.set(slug, {
      directUrl: (row.direct_url ?? '').trim() || null,
      dataPage: (row.data_page ?? '').trim() || null,
    });
  }
  return map;
}

function scoreFeedMatch(agency: Agency, feed: MobilityFeed, directUrl: string | null): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const provider = feed.provider ?? '';
  const providerNorm = normalizeText(provider);
  const slugNorm = normalizeText(agency.slug);
  const displayNorm = normalizeText(agency.displayName);

  const directCanon = canonicalUrl(directUrl);
  const producerCanon = canonicalUrl(feed.source_info?.producer_url ?? null);
  if (directCanon && producerCanon && directCanon === producerCanon) {
    score += 100;
    reasons.push('direct_url_exact_match');
  } else if (directCanon && producerCanon) {
    const directNoQuery = directCanon.split('?')[0] ?? directCanon;
    const producerNoQuery = producerCanon.split('?')[0] ?? producerCanon;
    if (directNoQuery === producerNoQuery) {
      score += 90;
      reasons.push('direct_url_path_match');
    }
  }

  if (providerNorm && providerNorm === slugNorm) {
    score += 80;
    reasons.push('provider_slug_exact');
  }
  if (providerNorm && providerNorm === displayNorm) {
    score += 80;
    reasons.push('provider_display_exact');
  }

  if ((feed.official ?? false) === true) {
    score += 10;
    reasons.push('official_feed');
  }
  if ((feed.status ?? '').toLowerCase() === 'active') {
    score += 5;
    reasons.push('active_feed');
  }

  return { score, reasons };
}

function pickBestStaticFeed(agency: Agency, gtfsFeeds: MobilityFeed[], dataSourceDirectUrl: string | null) {
  const candidates = gtfsFeeds
    .map((feed) => {
      const { score, reasons } = scoreFeedMatch(agency, feed, dataSourceDirectUrl);
      return { feed, score, reasons };
    })
    .filter((entry) => entry.score >= 80)
    .sort((a, b) => b.score - a.score || a.feed.id.localeCompare(b.feed.id));

  return candidates[0] ?? null;
}

function mapEntityTypeToBuckets(entityType: string): Array<keyof OutputRealtime> {
  const key = entityType.toLowerCase();
  if (key === 'sa') return ['service_alerts'];
  if (key === 'tu') return ['trip_updates'];
  if (key === 'vp') return ['vehicle_positions'];
  return [];
}

function scoreRealtimeCandidate(feed: MobilityRtFeed, url: string): number {
  let score = 0;
  const status = (feed.status ?? '').toLowerCase();
  if (status === 'active') score += 50;
  else if (status === 'development') score += 30;
  else if (status === 'deprecated') score += 10;
  else if (status === 'inactive') score += 0;
  if ((feed.official ?? false) === true) score += 10;
  if (looksLikeProtobuf(url)) score += 8;
  if (looksLikeJson(url)) score += 2;
  if (looksLikeNonProduction(url)) score -= 15;
  return score;
}

function resolveRealtimeForAgency(
  agency: Agency,
  staticFeedMatch: { feed: MobilityFeed; score: number; reasons: string[] } | null,
  gtfsRtFeeds: MobilityRtFeed[],
) {
  const realtime: OutputRealtime = {
    service_alerts: null,
    trip_updates: null,
    vehicle_positions: null,
  };
  const notes: string[] = [];

  const matchedRtFeeds = staticFeedMatch
    ? gtfsRtFeeds.filter((rt) => (rt.feed_references ?? []).includes(staticFeedMatch.feed.id))
    : gtfsRtFeeds.filter((rt) => {
        const providerNorm = normalizeText(rt.provider ?? '');
        return providerNorm.length > 0 && (providerNorm === normalizeText(agency.slug) || providerNorm === normalizeText(agency.displayName));
      });

  if (!staticFeedMatch) {
    notes.push('No high-confidence GTFS static feed match found in MobilityData; attempted provider-exact RT fallback.');
  } else {
    notes.push(
      `Matched GTFS feed ${staticFeedMatch.feed.id} (${staticFeedMatch.feed.provider ?? 'unknown provider'}) with reasons: ${staticFeedMatch.reasons.join(', ') || 'n/a'}.`,
    );
  }

  const candidatesByBucket: Record<keyof OutputRealtime, Array<{ url: string; score: number; feedId: string }>> = {
    service_alerts: [],
    trip_updates: [],
    vehicle_positions: [],
  };

  for (const rtFeed of matchedRtFeeds) {
    const url = rtFeed.source_info?.producer_url?.trim();
    if (!url) continue;
    const entityTypes = rtFeed.entity_types ?? [];
    for (const type of entityTypes) {
      for (const bucket of mapEntityTypeToBuckets(type)) {
        candidatesByBucket[bucket].push({
          url,
          score: scoreRealtimeCandidate(rtFeed, url),
          feedId: rtFeed.id,
        });
      }
    }
  }

  (Object.keys(candidatesByBucket) as Array<keyof OutputRealtime>).forEach((bucket) => {
    const candidates = candidatesByBucket[bucket]
      .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
      .filter((candidate, idx, arr) => arr.findIndex((entry) => entry.url === candidate.url) === idx);
    if (candidates.length === 0) {
      notes.push(`No resolved ${bucket} endpoint in MobilityData.`);
      realtime[bucket] = null;
      return;
    }
    const primary = candidates[0]!;
    realtime[bucket] = primary.url;
    if (candidates.length > 1) {
      const alternates = candidates.slice(1).map((candidate) => `${candidate.url} (${candidate.feedId})`);
      notes.push(`Multiple ${bucket} candidates found; selected ${primary.url} (${primary.feedId}); alternates: ${alternates.join(' | ')}.`);
    }
  });

  return { realtime, notes: notes.join(' ') };
}

function buildDedupeReport(records: OutputAgencyRecord[]) {
  const groups = new Map<string, { shared_realtime: OutputRealtime; members: string[] }>();
  for (const record of records) {
    const key = JSON.stringify(record.realtime);
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(record.slug);
      continue;
    }
    groups.set(key, {
      shared_realtime: record.realtime,
      members: [record.slug],
    });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, members: group.members.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.members[0]!.localeCompare(b.members[0]!));
}

async function main() {
  await loadEnvFromRepoIfNeeded();
  const graphqlUrl = process.env.PUBLIC_API_BASE_URL;
  const refreshToken = process.env.MOBILITY_DATABASE_REFRESH_TOKEN;
  if (!graphqlUrl) throw new Error('Missing PUBLIC_API_BASE_URL. Set it in environment or .env.');
  if (!refreshToken) throw new Error('Missing MOBILITY_DATABASE_REFRESH_TOKEN. Set it in environment or .env.');

  const [agencies, dataSourceMap, accessToken] = await Promise.all([
    getAgenciesFromKevin(graphqlUrl),
    loadDataSourceMap(),
    getMobilityAccessToken(refreshToken),
  ]);
  const { gtfsFeeds, gtfsRtFeeds } = await getMobilityFeeds(accessToken);
  const resolvedAt = new Date().toISOString();

  const records = agencies
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((agency): OutputAgencyRecord => {
      const sourceRow = dataSourceMap.get(agency.slug);
      const staticFeedMatch = pickBestStaticFeed(agency, gtfsFeeds, sourceRow?.directUrl ?? null);
      const { realtime, notes } = resolveRealtimeForAgency(agency, staticFeedMatch, gtfsRtFeeds);

      const evidence: OutputAgencyRecord['source']['evidence'] = [
        {
          kind: 'graphql',
          query: kevinAgenciesQuery,
          path: `data.agencies[slug=${agency.slug}]`,
        },
        {
          kind: 'mobility_api',
          query: mobilityGtfsFeedsQuery,
          path: staticFeedMatch ? `gtfs_feeds[id=${staticFeedMatch.feed.id}]` : `gtfs_feeds[no_high_confidence_match_for_slug=${agency.slug}]`,
        },
        {
          kind: 'mobility_api',
          query: mobilityGtfsRtFeedsQuery,
          path: staticFeedMatch
            ? `gtfs_rt_feeds[feed_references contains ${staticFeedMatch.feed.id}]`
            : `gtfs_rt_feeds[provider_exact_fallback_for_slug=${agency.slug}]`,
        },
      ];

      return {
        slug: agency.slug,
        agencyId: agency.id,
        displayName: agency.displayName,
        countryCode: 'CA',
        subdivisionCode: agency.subdivisionCode,
        timezone: agency.timezone,
        website: agency.website,
        activeFeedVersionId: agency.activeFeedVersionId,
        activeFeedImportedAt: agency.activeFeedImportedAt,
        realtime,
        source: {
          resolved_from: 'mobilitydata_fallback',
          resolved_at_utc: resolvedAt,
          evidence,
          notes,
        },
      };
    });

  const agencyMap = Object.fromEntries(records.map((record) => [record.slug, record]));
  const dedupeReport = buildDedupeReport(records);

  await Promise.all([
    writeFile(agencyMapOutputPath, `${JSON.stringify(agencyMap, null, 2)}\n`, 'utf8'),
    writeFile(dedupeOutputPath, `${JSON.stringify(dedupeReport, null, 2)}\n`, 'utf8'),
  ]);

  const withAnyRealtime = records.filter(
    (record) => record.realtime.service_alerts || record.realtime.trip_updates || record.realtime.vehicle_positions,
  ).length;

  console.log(`Generated ${agencyMapOutputPath}`);
  console.log(`Generated ${dedupeOutputPath}`);
  console.log(`Processed ${records.length} CA agencies; ${withAnyRealtime} agencies have at least one realtime endpoint.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
