import type { PageServerLoad } from './$types';
import { graphqlRequest } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
  const result = await graphqlRequest<{ agencies: any[] }>(
    fetch,
    `query {
      agencies(limit: 500)
    }`,
  );

  return {
    agencies: result.agencies ?? [],
  };
};
