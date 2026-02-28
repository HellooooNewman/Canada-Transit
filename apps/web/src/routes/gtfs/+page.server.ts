import type { PageServerLoad } from './$types';
import { graphqlRequest } from '$lib/api';

const GTFS_SNAPSHOT_LIMIT = 2000;

export const load: PageServerLoad = async ({ fetch }) => {
  const agenciesResult = await graphqlRequest<{ agencies: any[] }>(
    fetch,
    `query {
      agencies(limit: 500)
    }`,
  );

  const selectedAgencyId = agenciesResult.agencies?.[0]?.id ?? null;
  if (!selectedAgencyId) {
    return {
      agencies: [],
      selectedAgencyId: null,
      initialLimit: GTFS_SNAPSHOT_LIMIT,
      routes: [],
      stops: [],
      trips: [],
    };
  }

  const snapshotResult = await graphqlRequest<{ gtfsRoutes: any[]; gtfsStops: any[]; gtfsTrips: any[] }>(
    fetch,
    `query Snapshot($agencyId: String!, $limit: Int!) {
      gtfsRoutes(agencyId: $agencyId, limit: $limit)
      gtfsStops(agencyId: $agencyId, limit: $limit)
      gtfsTrips(agencyId: $agencyId, limit: $limit)
    }`,
    { agencyId: selectedAgencyId, limit: GTFS_SNAPSHOT_LIMIT },
  );

  return {
    agencies: agenciesResult.agencies,
    selectedAgencyId,
    initialLimit: GTFS_SNAPSHOT_LIMIT,
    routes: snapshotResult.gtfsRoutes,
    stops: snapshotResult.gtfsStops,
    trips: snapshotResult.gtfsTrips,
  };
};
