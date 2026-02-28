import type { PageServerLoad } from './$types';

const TORONTO_CENTER = { lat: 43.6532, lon: -79.3832 };
const DEFAULT_ZOOM = 9;

function toBbox(centerLat: number, centerLon: number, zoom: number) {
  const normalizedZoom = Math.max(2, Math.min(16, zoom));
  const lonHalfSpan = 180 / 2 ** normalizedZoom;
  const latHalfSpan = 85 / 2 ** normalizedZoom;
  const minLat = Math.max(-85, centerLat - latHalfSpan);
  const maxLat = Math.min(85, centerLat + latHalfSpan);
  const minLon = Math.max(-180, centerLon - lonHalfSpan);
  const maxLon = Math.min(180, centerLon + lonHalfSpan);
  return `${minLat},${minLon},${maxLat},${maxLon}`;
}

export const load: PageServerLoad = async () => {
  const bbox = toBbox(TORONTO_CENTER.lat, TORONTO_CENTER.lon, DEFAULT_ZOOM);
  return {
    center: TORONTO_CENTER,
    zoom: DEFAULT_ZOOM,
    bbox,
  };
};
