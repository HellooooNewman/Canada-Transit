import { env } from '$env/dynamic/public';

function parseBooleanFlag(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isDebugEnabled() {
  return parseBooleanFlag(env.PUBLIC_DEBUG_FEATURES) || parseBooleanFlag(env.PUBLIC_ENABLE_DEBUG_PAGES);
}
