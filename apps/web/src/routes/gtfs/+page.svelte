<script lang="ts">
  import { graphqlRequest } from '$lib/api';

  type Agency = {
    id: string;
    displayName: string;
  };

  type GtfsRoute = {
    routeId: string;
    routeShortName?: string | null;
    routeLongName?: string | null;
    routeType?: number | null;
  };

  type GtfsStop = {
    stopId: string;
    stopCode?: string | null;
    stopName?: string | null;
    zoneId?: string | null;
    parentStation?: string | null;
    wheelchairBoarding?: number | null;
  };

  type GtfsTrip = {
    tripId: string;
    routeId?: string | null;
    serviceId?: string | null;
    directionId?: number | null;
    tripHeadsign?: string | null;
    shapeId?: string | null;
    wheelchairAccessible?: number | null;
  };

  export let data: {
    agencies: Agency[];
    selectedAgencyId: string | null;
    initialLimit?: number;
    routes: GtfsRoute[];
    stops: GtfsStop[];
    trips: GtfsTrip[];
  };

  let selectedAgencyId = data.selectedAgencyId;
  let limit = data.initialLimit ?? 2000;
  let routes: GtfsRoute[] = data.routes ?? [];
  let stops: GtfsStop[] = data.stops ?? [];
  let trips: GtfsTrip[] = data.trips ?? [];
  let loading = false;
  let error = '';
  let routeQuery = '';
  let stopQuery = '';
  let tripQuery = '';

  const LIMIT_OPTIONS = [250, 500, 1000, 2000, 5000];
  const PREVIEW_ROWS = 25;
  const ROUTE_TYPE_LABELS: Record<number, string> = {
    0: 'Tram',
    1: 'Subway',
    2: 'Rail',
    3: 'Bus',
    4: 'Ferry',
    5: 'Cable Tram',
    6: 'Aerial Lift',
    7: 'Funicular',
    11: 'Trolleybus',
    12: 'Monorail',
  };

  function routeTypeLabel(routeType: number | null | undefined) {
    if (routeType === null || routeType === undefined) return 'Unknown';
    return ROUTE_TYPE_LABELS[routeType] ?? `Type ${routeType}`;
  }

  function rowMatchesQuery(
    row: Record<string, unknown>,
    query: string,
    extraValues: unknown[] = [],
  ) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return [...Object.values(row), ...extraValues]
      .filter((value) => value !== null && value !== undefined)
      .some((value) => String(value).toLowerCase().includes(normalized));
  }

  function toPercent(part: number, total: number) {
    if (total <= 0) return '0%';
    return `${Math.round((part / total) * 100)}%`;
  }

  $: routeTypeBreakdown = Object.entries(
    routes.reduce<Record<string, number>>((acc, route) => {
      const label = routeTypeLabel(route.routeType);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  $: directionBreakdown = Object.entries(
    trips.reduce<Record<string, number>>((acc, trip) => {
      const direction = trip.directionId === null || trip.directionId === undefined ? 'Unknown' : String(trip.directionId);
      acc[direction] = (acc[direction] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  $: distinctServices = new Set(trips.map((trip) => trip.serviceId).filter(Boolean)).size;
  $: distinctZones = new Set(stops.map((stop) => stop.zoneId).filter(Boolean)).size;
  $: parentStationLinks = stops.filter((stop) => Boolean(stop.parentStation)).length;
  $: wheelchairBoardingStops = stops.filter((stop) => stop.wheelchairBoarding === 1).length;
  $: wheelchairAccessibleTrips = trips.filter((trip) => trip.wheelchairAccessible === 1).length;
  $: tripsWithShape = trips.filter((trip) => Boolean(trip.shapeId)).length;

  $: tripsByRoute = Object.entries(
    trips.reduce<Record<string, number>>((acc, trip) => {
      const routeId = trip.routeId ?? 'Unknown';
      acc[routeId] = (acc[routeId] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  $: filteredRoutes = routes.filter((route) => {
    return rowMatchesQuery(route, routeQuery, [routeTypeLabel(route.routeType)]);
  });
  $: filteredStops = stops.filter((stop) => {
    return rowMatchesQuery(stop, stopQuery);
  });
  $: filteredTrips = trips.filter((trip) => {
    return rowMatchesQuery(trip, tripQuery);
  });

  $: previewRoutes = filteredRoutes.slice(0, PREVIEW_ROWS);
  $: previewStops = filteredStops.slice(0, PREVIEW_ROWS);
  $: previewTrips = filteredTrips.slice(0, PREVIEW_ROWS);

  async function reload() {
    if (!selectedAgencyId) return;
    loading = true;
    error = '';
    try {
      const snapshotResult = await graphqlRequest<{ gtfsRoutes: GtfsRoute[]; gtfsStops: GtfsStop[]; gtfsTrips: GtfsTrip[] }>(
        fetch,
        `query Snapshot($agencyId: String!, $limit: Int!) {
          gtfsRoutes(agencyId: $agencyId, limit: $limit)
          gtfsStops(agencyId: $agencyId, limit: $limit)
          gtfsTrips(agencyId: $agencyId, limit: $limit)
        }`,
        { agencyId: selectedAgencyId, limit },
      );
      routes = snapshotResult.gtfsRoutes ?? [];
      stops = snapshotResult.gtfsStops ?? [];
      trips = snapshotResult.gtfsTrips ?? [];
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed reloading GTFS snapshot';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>GTFS Explorer | Canada Transit Atlas</title>
</svelte:head>

<section class="hero">
  <h2>GTFS Explorer</h2>
  <p>Inspect feed-scoped GTFS routes, stops, and trips with summary metrics and searchable previews.</p>
</section>

<section class="toolbar">
  <label>
    Agency
    <select bind:value={selectedAgencyId}>
      {#each data.agencies as agency}
        <option value={agency.id}>{agency.displayName}</option>
      {/each}
    </select>
  </label>
  <label>
    Snapshot Limit
    <select bind:value={limit}>
      {#each LIMIT_OPTIONS as option}
        <option value={option}>{option.toLocaleString()}</option>
      {/each}
    </select>
  </label>
  <button type="button" on:click={reload} disabled={loading || !selectedAgencyId}>
    {loading ? 'Loading...' : 'Reload'}
  </button>
</section>

{#if error}
  <p class="error">{error}</p>
{/if}

<section class="summary">
  <article>
    <h3>Routes</h3>
    <p>{routes.length.toLocaleString()}</p>
    <small>{routeTypeBreakdown.length} route types in snapshot</small>
  </article>
  <article>
    <h3>Stops</h3>
    <p>{stops.length.toLocaleString()}</p>
    <small>{wheelchairBoardingStops.toLocaleString()} marked accessible ({toPercent(wheelchairBoardingStops, stops.length)})</small>
  </article>
  <article>
    <h3>Trips</h3>
    <p>{trips.length.toLocaleString()}</p>
    <small>{distinctServices.toLocaleString()} service IDs, {tripsWithShape.toLocaleString()} with shapes</small>
  </article>
</section>

<section class="breakdown">
  <article>
    <h3>Route Types</h3>
    {#if routeTypeBreakdown.length === 0}
      <p class="muted">No routes in snapshot.</p>
    {:else}
      <ul>
        {#each routeTypeBreakdown.slice(0, 8) as [label, count]}
          <li><span>{label}</span><strong>{count.toLocaleString()}</strong></li>
        {/each}
      </ul>
    {/if}
  </article>
  <article>
    <h3>Trip Direction Mix</h3>
    {#if directionBreakdown.length === 0}
      <p class="muted">No trips in snapshot.</p>
    {:else}
      <ul>
        {#each directionBreakdown as [direction, count]}
          <li><span>Direction {direction}</span><strong>{count.toLocaleString()}</strong></li>
        {/each}
      </ul>
    {/if}
  </article>
  <article>
    <h3>Top Routes by Trips</h3>
    {#if tripsByRoute.length === 0}
      <p class="muted">No trip distribution available.</p>
    {:else}
      <ul>
        {#each tripsByRoute as [routeId, count]}
          <li><span>{routeId}</span><strong>{count.toLocaleString()}</strong></li>
        {/each}
      </ul>
    {/if}
  </article>
  <article>
    <h3>Stop Metadata Coverage</h3>
    <ul>
      <li><span>Distinct zones</span><strong>{distinctZones.toLocaleString()}</strong></li>
      <li><span>Parent station links</span><strong>{parentStationLinks.toLocaleString()}</strong></li>
      <li><span>Accessible trips</span><strong>{wheelchairAccessibleTrips.toLocaleString()}</strong></li>
    </ul>
  </article>
</section>

<section class="details">
  <article class="panel">
    <header>
      <h3>Routes</h3>
      <small>Showing {previewRoutes.length} of {filteredRoutes.length} matched ({routes.length} fetched)</small>
    </header>
    <input type="search" placeholder="Filter routes..." bind:value={routeQuery} />
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Short</th><th>Long Name</th><th>Type</th><th>ID</th></tr>
        </thead>
        <tbody>
          {#if previewRoutes.length === 0}
            <tr><td colspan="4" class="muted">No routes match this filter.</td></tr>
          {:else}
            {#each previewRoutes as route}
              <tr>
                <td>{route.routeShortName ?? '—'}</td>
                <td>{route.routeLongName ?? '—'}</td>
                <td>{routeTypeLabel(route.routeType)}</td>
                <td>{route.routeId}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </article>

  <article class="panel">
    <header>
      <h3>Stops</h3>
      <small>Showing {previewStops.length} of {filteredStops.length} matched ({stops.length} fetched)</small>
    </header>
    <input type="search" placeholder="Filter stops..." bind:value={stopQuery} />
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Code</th><th>Zone</th><th>Accessible</th></tr>
        </thead>
        <tbody>
          {#if previewStops.length === 0}
            <tr><td colspan="4" class="muted">No stops match this filter.</td></tr>
          {:else}
            {#each previewStops as stop}
              <tr>
                <td>{stop.stopName ?? stop.stopId}</td>
                <td>{stop.stopCode ?? '—'}</td>
                <td>{stop.zoneId ?? '—'}</td>
                <td>{stop.wheelchairBoarding === 1 ? 'Yes' : stop.wheelchairBoarding === 2 ? 'No' : 'Unknown'}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </article>

  <article class="panel">
    <header>
      <h3>Trips</h3>
      <small>Showing {previewTrips.length} of {filteredTrips.length} matched ({trips.length} fetched)</small>
    </header>
    <input type="search" placeholder="Filter trips..." bind:value={tripQuery} />
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Trip ID</th><th>Route</th><th>Service</th><th>Direction</th></tr>
        </thead>
        <tbody>
          {#if previewTrips.length === 0}
            <tr><td colspan="4" class="muted">No trips match this filter.</td></tr>
          {:else}
            {#each previewTrips as trip}
              <tr>
                <td>{trip.tripId}</td>
                <td>{trip.routeId ?? '—'}</td>
                <td>{trip.serviceId ?? '—'}</td>
                <td>{trip.directionId ?? '—'}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </article>
</section>

<style>
  .hero {
    border: 1px solid var(--border-primary);
    border-radius: 0.75rem;
    background: var(--surface-1);
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
  }
  .hero p {
    color: var(--text-secondary);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    margin-bottom: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  select,
  button {
    border: 1px solid var(--border-primary);
    border-radius: 0.45rem;
    background: var(--surface-input-strong);
    color: var(--text-primary);
    padding: 0.55rem 0.65rem;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.7rem;
  }
  .summary article {
    border: 1px solid var(--border-primary);
    border-radius: 0.6rem;
    background: var(--surface-2);
    padding: 0.7rem;
  }
  .summary p {
    font-size: 1.5rem;
    margin: 0.35rem 0 0;
  }
  .summary small {
    color: var(--text-muted);
    display: block;
    margin-top: 0.35rem;
  }
  .breakdown {
    margin-top: 0.8rem;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
  }
  .breakdown article {
    border: 1px solid var(--border-primary);
    border-radius: 0.6rem;
    background: var(--surface-2);
    padding: 0.7rem;
  }
  ul {
    list-style: none;
    margin: 0.55rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    color: var(--text-secondary);
  }
  .details {
    margin-top: 0.8rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.8rem;
  }
  .panel {
    border: 1px solid var(--border-primary);
    border-radius: 0.6rem;
    background: var(--surface-2);
    padding: 0.75rem;
  }
  .panel header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.55rem;
  }
  .panel header small {
    color: var(--text-muted);
  }
  .panel input {
    width: 100%;
    border: 1px solid var(--border-primary);
    border-radius: 0.45rem;
    background: var(--surface-input);
    color: var(--text-primary);
    padding: 0.55rem 0.65rem;
    margin-bottom: 0.6rem;
  }
  .table-wrap {
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 42rem;
  }
  th,
  td {
    border-bottom: 1px solid var(--border-primary);
    text-align: left;
    padding: 0.45rem;
    vertical-align: top;
  }
  th {
    color: var(--text-muted);
    font-weight: 600;
  }
  .muted {
    color: var(--text-muted);
  }
  @media (max-width: 900px) {
    .summary {
      grid-template-columns: 1fr;
    }
    .breakdown {
      grid-template-columns: 1fr;
    }
  }
  .error {
    color: var(--danger);
  }
</style>
