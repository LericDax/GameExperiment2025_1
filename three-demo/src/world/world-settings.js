import {
  createWorldOptionDescriptorIndex,
  worldOptionDescriptors,
  worldOptionPathToKey,
} from "./world-option-descriptors.js";

export { worldOptionDescriptors } from "./world-option-descriptors.js";

const descriptorIndex = createWorldOptionDescriptorIndex(
  worldOptionDescriptors,
);

export function getWorldOptionDescriptor(pathKey) {
  return descriptorIndex.get(pathKey) ?? null;
}

function getDescriptorForPath(path) {
  if (Array.isArray(path)) {
    return descriptorIndex.get(worldOptionPathToKey(path)) ?? null;
  }
  if (typeof path === "string") {
    return descriptorIndex.get(path) ?? null;
  }
  return null;
}

function getDescriptorDefault(path) {
  const descriptor = getDescriptorForPath(path);
  if (!descriptor) {
    throw new Error(
      `Missing world option descriptor for path: ${path.join(".")}`,
    );
  }
  return descriptor.default;
}

function computeSeedHash(value) {
  const str = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveSeed(value, fallbackValue, fallbackHash) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return { value: normalized, hash: computeSeedHash(normalized) };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return { value: trimmed, hash: computeSeedHash(trimmed) };
    }
  }
  return { value: fallbackValue, hash: fallbackHash };
}

const DEFAULT_SEED_VALUE = getDescriptorDefault(["seed"]);
const DEFAULT_SEED_HASH = computeSeedHash(DEFAULT_SEED_VALUE);

const defaultTerrainClamp = Object.freeze({
  min: getDescriptorDefault(["terrain", "clamp", "min"]),
  max: getDescriptorDefault(["terrain", "clamp", "max"]),
});

const defaultFmOperators = Object.freeze([
  Object.freeze({
    id: "fm_mod_low",
    ratio: 0.5,
    detuneX: 23.17,
    detuneZ: -41.03,
    amplitude: 0.38,
    bias: 0,
    bus: 0.22,
    slope: 0.4,
    altitude: -0.15,
    modulationDepth: 1.1,
    targets: Object.freeze([
      Object.freeze({ index: 1, mode: "frequency", depth: 0.8 }),
    ]),
  }),
  Object.freeze({
    id: "fm_carrier_primary",
    ratio: 1,
    detuneX: -57.2,
    detuneZ: 35.6,
    amplitude: 0.55,
    bias: 0,
    bus: 0.38,
    slope: 0.2,
    altitude: 0.1,
    modulationDepth: 0.9,
    targets: Object.freeze([
      Object.freeze({ index: 4, mode: "amplitude", depth: 0.35 }),
    ]),
  }),
  Object.freeze({
    id: "fm_mod_high",
    ratio: 2.25,
    detuneX: 11.8,
    detuneZ: 73.4,
    amplitude: 0.32,
    bias: 0,
    bus: 0,
    slope: 0.35,
    altitude: 0.5,
    modulationDepth: 1.35,
    targets: Object.freeze([
      Object.freeze({ index: 3, mode: "frequency", depth: 0.95 }),
    ]),
  }),
  Object.freeze({
    id: "fm_carrier_ridge",
    ratio: 1.45,
    detuneX: 92.1,
    detuneZ: -39.7,
    amplitude: 0.47,
    bias: 0,
    bus: 0.33,
    slope: -0.1,
    altitude: 0.2,
    modulationDepth: 0.8,
    targets: Object.freeze([
      Object.freeze({ index: 4, mode: "frequency", depth: 0.6 }),
    ]),
  }),
  Object.freeze({
    id: "fm_bridge",
    ratio: 0.78,
    detuneX: -17.4,
    detuneZ: 32.2,
    amplitude: 0.51,
    bias: 0,
    bus: 0.42,
    slope: 0.65,
    altitude: -0.05,
    modulationDepth: 1.1,
    targets: Object.freeze([
      Object.freeze({ index: 5, mode: "amplitude", depth: 0.75 }),
    ]),
  }),
  Object.freeze({
    id: "fm_final",
    ratio: 3.6,
    detuneX: 66.8,
    detuneZ: -76.9,
    amplitude: 0.37,
    bias: 0,
    bus: 0.58,
    slope: -0.25,
    altitude: 0.55,
    modulationDepth: 0.65,
    targets: Object.freeze([]),
  }),
]);

const defaultFmOptions = Object.freeze({
  base: 0.95,
  min: 0.45,
  max: 1.75,
  slopeWeight: -0.35,
  altitudeWeight: -0.25,
  biomeBlendStrength: 0.7,
  operators: defaultFmOperators,
});

const defaultTerrainOptions = Object.freeze({
  baseHeight: getDescriptorDefault(["terrain", "baseHeight"]),
  maxHeight: getDescriptorDefault(["terrain", "maxHeight"]),
  clamp: defaultTerrainClamp,
  primaryFrequency: getDescriptorDefault(["terrain", "primaryFrequency"]),
  primaryAmplitude: getDescriptorDefault(["terrain", "primaryAmplitude"]),
  primaryOffset: getDescriptorDefault(["terrain", "primaryOffset"]),
  detailFrequency: getDescriptorDefault(["terrain", "detailFrequency"]),
  detailAmplitude: getDescriptorDefault(["terrain", "detailAmplitude"]),
  detailOffset: getDescriptorDefault(["terrain", "detailOffset"]),
  ridgeFrequency: getDescriptorDefault(["terrain", "ridgeFrequency"]),
  ridgeStrength: getDescriptorDefault(["terrain", "ridgeStrength"]),
  ridgeOffset: getDescriptorDefault(["terrain", "ridgeOffset"]),
  climateHeightInfluence: getDescriptorDefault([
    "terrain",
    "climateHeightInfluence",
  ]),
  fm: defaultFmOptions,
});

const defaultBiomeTuning = Object.freeze({
  scale: getDescriptorDefault(["biomes", "scale"]),
  detailMultiplier: getDescriptorDefault(["biomes", "detailMultiplier"]),
  moistureDetailMultiplier: getDescriptorDefault([
    "biomes",
    "moistureDetailMultiplier",
  ]),
  varianceMultiplier: getDescriptorDefault(["biomes", "varianceMultiplier"]),
  variationStrength: getDescriptorDefault(["biomes", "variationStrength"]),
  uniformity: getDescriptorDefault(["biomes", "uniformity"]),
  weightExponent: getDescriptorDefault(["biomes", "weightExponent"]),
});

const biomeDescriptorKeys = [
  "scale",
  "detailMultiplier",
  "moistureDetailMultiplier",
  "varianceMultiplier",
  "variationStrength",
  "uniformity",
  "weightExponent",
];

export const biomeOptionMetadata = Object.freeze(
  Object.fromEntries(
    biomeDescriptorKeys.map((key) => {
      const descriptor = getDescriptorForPath(["biomes", key]);
      return [
        key,
        Object.freeze({
          default: defaultBiomeTuning[key],
          min: descriptor?.min,
          max: descriptor?.max,
          description: descriptor?.description,
        }),
      ];
    }),
  ),
);

export const defaultWorldOptions = Object.freeze({
  seed: DEFAULT_SEED_VALUE,
  seedHash: DEFAULT_SEED_HASH,
  chunkSize: getDescriptorDefault(["chunkSize"]),
  baseHeight: getDescriptorDefault(["baseHeight"]),
  maxHeight: getDescriptorDefault(["maxHeight"]),
  waterLevel: getDescriptorDefault(["waterLevel"]),
  chunk: Object.freeze({
    size: getDescriptorDefault(["chunk", "size"]),
  }),
  water: Object.freeze({
    level: getDescriptorDefault(["water", "level"]),
  }),
  terrain: defaultTerrainOptions,
  biomes: defaultBiomeTuning,
});

function createMutableWorldOptions() {
  const seedInfo = resolveSeed(
    DEFAULT_SEED_VALUE,
    DEFAULT_SEED_VALUE,
    DEFAULT_SEED_HASH,
  );
  return {
    seed: seedInfo.value,
    seedHash: seedInfo.hash,
    chunkSize: defaultWorldOptions.chunkSize,
    baseHeight: defaultWorldOptions.baseHeight,
    maxHeight: defaultWorldOptions.maxHeight,
    waterLevel: defaultWorldOptions.waterLevel,
    chunk: { size: defaultWorldOptions.chunk.size },
    water: { level: defaultWorldOptions.water.level },
    terrain: {
      baseHeight: defaultTerrainOptions.baseHeight,
      maxHeight: defaultTerrainOptions.maxHeight,
      clamp: { ...defaultTerrainOptions.clamp },
      primaryFrequency: defaultTerrainOptions.primaryFrequency,
      primaryAmplitude: defaultTerrainOptions.primaryAmplitude,
      primaryOffset: defaultTerrainOptions.primaryOffset,
      detailFrequency: defaultTerrainOptions.detailFrequency,
      detailAmplitude: defaultTerrainOptions.detailAmplitude,
      detailOffset: defaultTerrainOptions.detailOffset,
      ridgeFrequency: defaultTerrainOptions.ridgeFrequency,
      ridgeStrength: defaultTerrainOptions.ridgeStrength,
      ridgeOffset: defaultTerrainOptions.ridgeOffset,
      climateHeightInfluence: defaultTerrainOptions.climateHeightInfluence,
      fm: {
        base: defaultTerrainOptions.fm.base,
        min: defaultTerrainOptions.fm.min,
        max: defaultTerrainOptions.fm.max,
        slopeWeight: defaultTerrainOptions.fm.slopeWeight,
        altitudeWeight: defaultTerrainOptions.fm.altitudeWeight,
        biomeBlendStrength: defaultTerrainOptions.fm.biomeBlendStrength,
        operators: defaultTerrainOptions.fm.operators.map((operator) =>
          cloneFmOperatorDefinition(operator),
        ),
      },
    },
    biomes: { ...defaultWorldOptions.biomes },
  };
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function normalizeNumber(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function normalizeWithDescriptor(value, fallback, path) {
  const descriptor = getDescriptorForPath(path);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  let normalized = value;
  if (descriptor && Number.isFinite(descriptor.min)) {
    normalized = Math.max(descriptor.min, normalized);
  }
  if (descriptor && Number.isFinite(descriptor.max)) {
    normalized = Math.min(descriptor.max, normalized);
  }
  return normalized;
}

function cloneFmOperatorDefinition(operator) {
  if (!operator || typeof operator !== "object") {
    return {
      id: "",
      ratio: 1,
      detuneX: 0,
      detuneZ: 0,
      amplitude: 0,
      bias: 0,
      bus: 0,
      slope: 0,
      altitude: 0,
      modulationDepth: 1,
      targets: [],
    };
  }

  const targets = Array.isArray(operator.targets)
    ? operator.targets.map((target) => ({
        index: Number.isFinite(target?.index) ? target.index : 0,
        mode: target?.mode === "amplitude" ? "amplitude" : "frequency",
        depth: Number.isFinite(target?.depth) ? target.depth : 0,
      }))
    : [];

  return {
    id: typeof operator.id === "string" ? operator.id : "",
    ratio: Number.isFinite(operator.ratio) ? operator.ratio : 1,
    detuneX: Number.isFinite(operator.detuneX) ? operator.detuneX : 0,
    detuneZ: Number.isFinite(operator.detuneZ) ? operator.detuneZ : 0,
    amplitude: Number.isFinite(operator.amplitude) ? operator.amplitude : 0,
    bias: Number.isFinite(operator.bias) ? operator.bias : 0,
    bus: Number.isFinite(operator.bus) ? operator.bus : 0,
    slope: Number.isFinite(operator.slope) ? operator.slope : 0,
    altitude: Number.isFinite(operator.altitude) ? operator.altitude : 0,
    modulationDepth: Number.isFinite(operator.modulationDepth)
      ? operator.modulationDepth
      : 1,
    targets,
  };
}

export const worldOptions = createMutableWorldOptions();

export function getWorldOptions() {
  return worldOptions;
}

export function applyWorldOptions(overrides = {}) {
  if (!isObject(overrides)) {
    return worldOptions;
  }

  if ("seed" in overrides) {
    const seedInfo = resolveSeed(
      overrides.seed,
      worldOptions.seed,
      worldOptions.seedHash,
    );
    worldOptions.seed = seedInfo.value;
    worldOptions.seedHash = seedInfo.hash;
  }

  const chunkOverrides = isObject(overrides.chunk) ? overrides.chunk : null;
  const resolvedChunkSize = normalizeNumber(
    chunkOverrides?.size ?? overrides.chunkSize,
    null,
  );
  if (resolvedChunkSize !== null) {
    const floored = Math.floor(resolvedChunkSize);
    const positive = Math.max(1, floored);
    const normalizedChunkSize = normalizeWithDescriptor(
      positive,
      worldOptions.chunk.size,
      ["chunk", "size"],
    );
    worldOptions.chunk.size = normalizedChunkSize;
    worldOptions.chunkSize = normalizeWithDescriptor(
      normalizedChunkSize,
      worldOptions.chunkSize,
      ["chunkSize"],
    );
  }

  const terrainOverrides = isObject(overrides.terrain)
    ? overrides.terrain
    : null;

  const resolvedBaseHeight = normalizeNumber(
    terrainOverrides?.baseHeight ?? overrides.baseHeight,
    null,
  );
  if (resolvedBaseHeight !== null) {
    const baseHeight = normalizeWithDescriptor(
      resolvedBaseHeight,
      worldOptions.terrain.baseHeight,
      ["terrain", "baseHeight"],
    );
    worldOptions.baseHeight = baseHeight;
    worldOptions.terrain.baseHeight = baseHeight;
  }

  const resolvedMaxHeight = normalizeNumber(
    terrainOverrides?.maxHeight ?? overrides.maxHeight,
    null,
  );
  if (resolvedMaxHeight !== null) {
    const maxHeight = normalizeWithDescriptor(
      resolvedMaxHeight,
      worldOptions.terrain.maxHeight,
      ["terrain", "maxHeight"],
    );
    worldOptions.maxHeight = maxHeight;
    worldOptions.terrain.maxHeight = maxHeight;
    worldOptions.terrain.clamp.max = Math.max(
      worldOptions.terrain.clamp.max,
      maxHeight,
    );
  }

  const clampOverrides = isObject(terrainOverrides?.clamp)
    ? terrainOverrides.clamp
    : null;
  const resolvedClampMin = normalizeNumber(clampOverrides?.min, null);
  if (resolvedClampMin !== null) {
    worldOptions.terrain.clamp.min = normalizeWithDescriptor(
      resolvedClampMin,
      worldOptions.terrain.clamp.min,
      ["terrain", "clamp", "min"],
    );
  }
  const resolvedClampMax = normalizeNumber(clampOverrides?.max, null);
  if (resolvedClampMax !== null) {
    const clampMax = normalizeWithDescriptor(
      resolvedClampMax,
      worldOptions.terrain.clamp.max,
      ["terrain", "clamp", "max"],
    );
    worldOptions.terrain.clamp.max = clampMax;
    worldOptions.maxHeight = Math.max(worldOptions.maxHeight, clampMax);
  }

  const terrainOptionKeys = [
    "primaryFrequency",
    "primaryAmplitude",
    "primaryOffset",
    "detailFrequency",
    "detailAmplitude",
    "detailOffset",
    "ridgeFrequency",
    "ridgeStrength",
    "ridgeOffset",
    "climateHeightInfluence",
  ];

  terrainOptionKeys.forEach((key) => {
    if (key in (terrainOverrides ?? {})) {
      worldOptions.terrain[key] = normalizeWithDescriptor(
        terrainOverrides[key],
        worldOptions.terrain[key],
        ["terrain", key],
      );
    }
  });

  const fmOverrides = isObject(terrainOverrides?.fm)
    ? terrainOverrides.fm
    : null;
  if (fmOverrides) {
    const fmOptions = worldOptions.terrain.fm;
    const numericKeys = ["base", "min", "max", "slopeWeight", "altitudeWeight"];
    numericKeys.forEach((key) => {
      if (key in fmOverrides) {
        fmOptions[key] = normalizeNumber(fmOverrides[key], fmOptions[key]);
      }
    });

    if ("biomeBlendStrength" in fmOverrides) {
      const normalizedBlend = normalizeNumber(
        fmOverrides.biomeBlendStrength,
        fmOptions.biomeBlendStrength,
      );
      fmOptions.biomeBlendStrength = Math.max(0, Math.min(1, normalizedBlend));
    }

    if (fmOptions.min > fmOptions.max) {
      const midpoint = (fmOptions.min + fmOptions.max) / 2;
      fmOptions.min = midpoint;
      fmOptions.max = midpoint;
    }
  }

  worldOptions.baseHeight = normalizeWithDescriptor(
    worldOptions.baseHeight,
    defaultTerrainOptions.baseHeight,
    ["baseHeight"],
  );
  worldOptions.terrain.baseHeight = worldOptions.baseHeight;

  const minimumMaxHeight = Math.max(
    worldOptions.baseHeight,
    worldOptions.terrain.baseHeight,
  );
  worldOptions.terrain.maxHeight = Math.max(
    normalizeWithDescriptor(
      worldOptions.terrain.maxHeight,
      defaultTerrainOptions.maxHeight,
      ["terrain", "maxHeight"],
    ),
    minimumMaxHeight,
  );
  worldOptions.maxHeight = Math.max(
    normalizeWithDescriptor(
      worldOptions.maxHeight,
      defaultTerrainOptions.maxHeight,
      ["maxHeight"],
    ),
    worldOptions.terrain.maxHeight,
  );

  const ridgeContribution = Math.max(0, worldOptions.terrain.ridgeStrength);
  const estimatedTerrainMax =
    worldOptions.terrain.baseHeight +
    worldOptions.terrain.primaryAmplitude +
    worldOptions.terrain.detailAmplitude +
    ridgeContribution;

  if (worldOptions.terrain.maxHeight < estimatedTerrainMax) {
    worldOptions.terrain.maxHeight = estimatedTerrainMax;
  }
  if (worldOptions.maxHeight < estimatedTerrainMax) {
    worldOptions.maxHeight = estimatedTerrainMax;
  }

  worldOptions.terrain.clamp.min = normalizeWithDescriptor(
    worldOptions.terrain.clamp.min,
    defaultTerrainOptions.clamp.min,
    ["terrain", "clamp", "min"],
  );
  worldOptions.terrain.clamp.max = Math.max(
    normalizeWithDescriptor(
      worldOptions.terrain.clamp.max,
      defaultTerrainOptions.clamp.max,
      ["terrain", "clamp", "max"],
    ),
    worldOptions.terrain.clamp.min,
    worldOptions.maxHeight,
  );
  worldOptions.maxHeight = Math.max(
    worldOptions.maxHeight,
    worldOptions.terrain.clamp.max,
  );

  const waterOverrides = isObject(overrides.water) ? overrides.water : null;
  const resolvedWaterLevel = normalizeNumber(
    waterOverrides?.level ?? overrides.waterLevel,
    null,
  );
  if (resolvedWaterLevel !== null) {
    const normalizedWaterLevel = normalizeWithDescriptor(
      resolvedWaterLevel,
      worldOptions.water.level,
      ["water", "level"],
    );
    worldOptions.water.level = normalizedWaterLevel;
    worldOptions.waterLevel = normalizeWithDescriptor(
      normalizedWaterLevel,
      worldOptions.waterLevel,
      ["waterLevel"],
    );
  }

  if ("biomes" in overrides && isObject(overrides.biomes)) {
    Object.entries(overrides.biomes).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(worldOptions.biomes, key)) {
        return;
      }
      const normalizedInput = normalizeNumber(value, null);
      if (normalizedInput === null) {
        return;
      }
      worldOptions.biomes[key] = normalizeWithDescriptor(
        normalizedInput,
        worldOptions.biomes[key],
        ["biomes", key],
      );
    });
  }

  return worldOptions;
}

export function resetWorldOptions() {
  const fresh = createMutableWorldOptions();

  worldOptions.seed = fresh.seed;
  worldOptions.seedHash = fresh.seedHash;
  worldOptions.chunkSize = fresh.chunkSize;
  worldOptions.baseHeight = fresh.baseHeight;
  worldOptions.maxHeight = fresh.maxHeight;
  worldOptions.waterLevel = fresh.waterLevel;

  Object.assign(worldOptions.chunk, fresh.chunk);
  Object.assign(worldOptions.water, fresh.water);
  Object.assign(worldOptions.terrain, fresh.terrain);
  worldOptions.terrain.clamp.min = fresh.terrain.clamp.min;
  worldOptions.terrain.clamp.max = fresh.terrain.clamp.max;

  Object.keys(worldOptions.biomes).forEach((key) => {
    delete worldOptions.biomes[key];
  });
  Object.assign(worldOptions.biomes, fresh.biomes);

  return worldOptions;
}
