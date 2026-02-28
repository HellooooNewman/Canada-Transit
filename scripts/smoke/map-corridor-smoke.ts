const endpoint = process.env.SMOKE_GRAPHQL_URL ?? 'http://localhost:3000/graphql';
const bbox = process.env.SMOKE_BBOX ?? '43.541,-79.639,43.857,-79.115';
const zoom = Number.parseInt(process.env.SMOKE_ZOOM ?? '11', 10);

const query = `query MapRouteLinesSmoke($bbox: String!, $zoom: Int!, $routeLimit: Int!, $shapeLimit: Int!) {
  mapRouteLines(bbox: $bbox, zoom: $zoom, routeLimit: $routeLimit, shapeLimit: $shapeLimit)
}`;

type Corridor = { corridorId: string; routeCount: number };
type Payload = { mode?: string; lines?: unknown[]; corridors?: Corridor[]; counts?: Record<string, number> };

async function runMapRouteLines() {
  const start = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { bbox, zoom, routeLimit: 1200, shapeLimit: 480 },
    }),
  });
  if (!response.ok) {
    throw new Error(`GraphQL request failed with status ${response.status}.`);
  }
  const result = (await response.json()) as { data?: { mapRouteLines?: Payload }; errors?: Array<{ message?: string }> };
  if (result.errors?.length) {
    const message = result.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; ');
    throw new Error(message);
  }
  const payload = result.data?.mapRouteLines ?? {};
  const elapsedMs = Math.round(performance.now() - start);
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  return { payload, elapsedMs, payloadBytes };
}

function assertDeterministicCorridors(first: Payload, second: Payload) {
  const firstIds = (first.corridors ?? []).map((corridor) => corridor.corridorId);
  const secondIds = (second.corridors ?? []).map((corridor) => corridor.corridorId);
  if (firstIds.length !== secondIds.length) {
    throw new Error(`Corridor count changed between runs (${firstIds.length} vs ${secondIds.length}).`);
  }
  for (let index = 0; index < firstIds.length; index += 1) {
    if (firstIds[index] !== secondIds[index]) {
      throw new Error(`Corridor ordering mismatch at index ${index}.`);
    }
  }
}

async function run() {
  const [first, second] = await Promise.all([runMapRouteLines(), runMapRouteLines()]);
  assertDeterministicCorridors(first.payload, second.payload);
  const corridors = first.payload.corridors ?? [];
  const top = corridors.slice(0, 5).map((corridor) => `${corridor.corridorId.slice(0, 24)}…:${corridor.routeCount}`);
  console.log(
    `[smoke:corridors] mode=${first.payload.mode ?? 'unknown'} corridors=${corridors.length} lines=${first.payload.lines?.length ?? 0}`,
  );
  console.log(
    `[smoke:corridors] payloadKB=${(first.payloadBytes / 1024).toFixed(1)} elapsedMs=${first.elapsedMs} top=${top.join(' | ')}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
