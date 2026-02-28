import { env } from '$env/dynamic/public';

const API_BASE_URL = env.PUBLIC_API_BASE_URL || 'http://localhost:3000/api/graphql';

export async function graphqlRequest<T>(
  fetchFn: typeof fetch,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetchFn(API_BASE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  if (!payload.data) {
    throw new Error('GraphQL response did not include data');
  }

  return payload.data;
}

export type LifecycleStatus =
  | 'EXISTING'
  | 'UNDER_CONSTRUCTION'
  | 'PLANNED'
  | 'CANCELLED'
  | 'DECOMMISSIONED';

export type DataProvenance = 'OFFICIAL' | 'DERIVED' | 'ESTIMATED';

export type GtfsSnapshot = {
  agencies: any[];
};

export function fetchGtfsSnapshot(fetchFn: typeof fetch) {
  return graphqlRequest<GtfsSnapshot>(
    fetchFn,
    `query {
      agencies(limit: 500)
    }`,
  );
}
