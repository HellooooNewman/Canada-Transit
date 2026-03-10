import { error } from '@sveltejs/kit';
import { apiUrl } from '$lib/api';
import { isDebugEnabled } from '$lib/feature-flags';

type TransitHeatHealth = {
  versionKey: string | null;
  tileCount: number;
  minZoom: number | null;
  maxZoom: number | null;
  generatedAt: string | null;
  tilesByZoom: Array<{ zoom: number; tiles: number }>;
};

export async function load({ fetch }: { fetch: typeof globalThis.fetch }) {
  if (!isDebugEnabled()) {
    throw error(404, 'Not found');
  }

  const endpoint = apiUrl('/map/transit-heat/health');
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw error(502, `Transit heat health request failed (${response.status})`);
  }

  const health = (await response.json()) as TransitHeatHealth;
  return {
    endpoint,
    health,
  };
}
