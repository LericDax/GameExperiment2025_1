import * as THREE from 'three';

const DEFAULT_CHUNK_SIZE = 16;
const DEFAULT_MARGIN_CHUNKS = 0.75;
const DEFAULT_MIN_RANGE_MULTIPLIER = 2;
const DEFAULT_MIN_NEAR_MULTIPLIER = 0.5;

function resolveChunkSize(worldConfig) {
  const numeric = Number(worldConfig?.chunkSize);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }
  return numeric;
}

function resolveMargin(marginChunks, chunkSize) {
  const numeric = Number(marginChunks);
  const normalized = Number.isFinite(numeric) && numeric >= 0 ? numeric : DEFAULT_MARGIN_CHUNKS;
  return normalized * chunkSize;
}

function resolveMultiplier(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, numeric);
}

function normalizeChunkRadius(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

export function computeChunkFogRange({
  chunkManager,
  worldConfig,
  marginChunks = DEFAULT_MARGIN_CHUNKS,
  minRangeMultiplier = DEFAULT_MIN_RANGE_MULTIPLIER,
  minNearMultiplier = DEFAULT_MIN_NEAR_MULTIPLIER,
} = {}) {
  if (!chunkManager) {
    return null;
  }

  const getViewDistance = typeof chunkManager.getViewDistance === 'function'
    ? chunkManager.getViewDistance.bind(chunkManager)
    : null;
  const getRetentionDistance = typeof chunkManager.getRetentionDistance === 'function'
    ? chunkManager.getRetentionDistance.bind(chunkManager)
    : null;

  if (!getViewDistance || !getRetentionDistance) {
    return null;
  }

  const chunkSize = resolveChunkSize(worldConfig);
  const fallbackRadius = 1;
  const viewRadius = normalizeChunkRadius(getViewDistance(), fallbackRadius);
  const retentionRadius = normalizeChunkRadius(
    getRetentionDistance(),
    viewRadius + 1,
  );
  const effectiveRetention = Math.max(retentionRadius, viewRadius);

  const margin = resolveMargin(marginChunks, chunkSize);
  const minNear = resolveMultiplier(minNearMultiplier, DEFAULT_MIN_NEAR_MULTIPLIER) * chunkSize;
  const minRange = resolveMultiplier(minRangeMultiplier, DEFAULT_MIN_RANGE_MULTIPLIER) * chunkSize;

  const near = Math.max(minNear, viewRadius * chunkSize - margin);
  const far = Math.max(near + minRange, effectiveRetention * chunkSize + margin);

  return { near, far };
}

export function resolveFogSettingsWithChunkRange({
  baseSettings,
  chunkManager,
  worldConfig,
  marginChunks = DEFAULT_MARGIN_CHUNKS,
  minRangeMultiplier = DEFAULT_MIN_RANGE_MULTIPLIER,
  minNearMultiplier = DEFAULT_MIN_NEAR_MULTIPLIER,
} = {}) {
  if (!baseSettings) {
    return null;
  }

  const range = computeChunkFogRange({
    chunkManager,
    worldConfig,
    marginChunks,
    minRangeMultiplier,
    minNearMultiplier,
  });

  if (!range) {
    return { ...baseSettings };
  }

  const nextSettings = {
    ...baseSettings,
  };

  if (Number.isFinite(range.near)) {
    nextSettings.fogNear = range.near;
  }
  if (Number.isFinite(range.far)) {
    nextSettings.fogFar = range.far;
  }

  return nextSettings;
}

export function easeFogTowardRange({ fog, targetRange, delta, easing = 3 }) {
  if (!fog || !targetRange) {
    return;
  }

  const factor = Number.isFinite(delta) && delta > 0
    ? 1 - Math.exp(-Math.max(0, easing) * delta)
    : 1;

  if (Number.isFinite(targetRange.near)) {
    const currentNear = Number.isFinite(fog.near) ? fog.near : targetRange.near;
    fog.near = THREE.MathUtils.lerp(currentNear, targetRange.near, factor);
  }

  if (Number.isFinite(targetRange.far)) {
    const currentFar = Number.isFinite(fog.far) ? fog.far : targetRange.far;
    fog.far = THREE.MathUtils.lerp(currentFar, targetRange.far, factor);
  }
}
