const DEFAULT_VERTICAL_SPAN_CHUNKS = 3;

const normalizeChunkSize = (options) => {
  const candidates = [
    options?.chunk?.size,
    options?.chunkSize,
    options?.size,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = Number(candidates[i]);
    if (Number.isFinite(candidate) && candidate > 0) {
      return Math.max(1, Math.floor(candidate));
    }
  }
  return 1;
};

const normalizeChunkCoordinate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (Number.isInteger(numeric)) {
    return numeric;
  }
  return Math.floor(numeric);
};

const normalizePadding = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
};

const normalizeVerticalSpanChunks = (options) => {
  const candidates = [
    options?.terrain?.verticalSpanChunks,
    options?.verticalSpanChunks,
    options?.verticalSpan?.chunks,
    options?.verticalSpan,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = Number(candidates[i]);
    if (Number.isFinite(candidate) && candidate > 0) {
      return Math.max(1, Math.floor(candidate));
    }
  }
  return DEFAULT_VERTICAL_SPAN_CHUNKS;
};

/**
 * Compute derived chunk metrics that remain integer aligned for both even and
 * odd chunk sizes. Consumers can use the helpers to translate between chunk and
 * world space without duplicating half-size math.
 *
 * @param {object} [options]
 * @returns {{
 *   size: number,
 *   halfExtent: number,
 *   sizeMinusOne: number,
 *   chunkArea: number,
 *   chunkWorldMin: (chunk:number)=>number,
 *   chunkWorldMax: (chunk:number)=>number,
 *   chunkWorldBounds: (chunkX:number, chunkZ:number)=>{
 *     minX:number,
 *     maxX:number,
 *     minZ:number,
 *     maxZ:number,
 *   },
 *   chunkCenterWorld: (chunk:number)=>number,
 *   worldToChunk: (value:number)=>number,
 *   worldPositionToChunk: (x:number, z:number)=>{ x:number, z:number },
 *   expandChunkBounds: (
 *     chunkX:number,
 *     chunkZ:number,
 *     padding?:number,
 *   )=>{ minX:number, maxX:number, minZ:number, maxZ:number },
 * }}
 */
export function computeWorldScale(options = {}) {
  const size = normalizeChunkSize(options);
  const halfExtent = Math.floor(size / 2);
  const sizeMinusOne = Math.max(0, size - 1);
  const chunkArea = size * size;
  const verticalSpanChunks = normalizeVerticalSpanChunks(options);
  const verticalExtent = size * verticalSpanChunks;
  const verticalClampMin = -verticalExtent;
  const verticalClampMax = verticalExtent;

  const chunkWorldMin = (chunk) => {
    const normalizedChunk = normalizeChunkCoordinate(chunk);
    return normalizedChunk * size - halfExtent;
  };

  const chunkWorldMax = (chunk) => chunkWorldMin(chunk) + sizeMinusOne;

  const chunkWorldBounds = (chunkX, chunkZ) => ({
    minX: chunkWorldMin(chunkX),
    maxX: chunkWorldMax(chunkX),
    minZ: chunkWorldMin(chunkZ),
    maxZ: chunkWorldMax(chunkZ),
  });

  const chunkCenterWorld = (chunk) => {
    const normalizedChunk = normalizeChunkCoordinate(chunk);
    return normalizedChunk * size;
  };

  const worldToChunk = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return Math.floor((numeric + halfExtent) / size);
  };

  const worldPositionToChunk = (x, z) => ({
    x: worldToChunk(x),
    z: worldToChunk(z),
  });

  const expandChunkBounds = (chunkX, chunkZ, padding = 0) => {
    const pad = normalizePadding(padding);
    const base = chunkWorldBounds(chunkX, chunkZ);
    if (pad === 0) {
      return base;
    }
    return {
      minX: base.minX - pad,
      maxX: base.maxX + pad,
      minZ: base.minZ - pad,
      maxZ: base.maxZ + pad,
    };
  };

  return Object.freeze({
    size,
    halfExtent,
    sizeMinusOne,
    chunkArea,
    verticalSpanChunks,
    verticalExtent,
    verticalClampMin,
    verticalClampMax,
    chunkWorldMin,
    chunkWorldMax,
    chunkWorldBounds,
    chunkCenterWorld,
    worldToChunk,
    worldPositionToChunk,
    expandChunkBounds,
  });
}
