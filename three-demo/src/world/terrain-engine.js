import { createBiomeEngine } from './biome-engine.js';
import { defaultWorldOptions } from './world-settings.js';
import { createTfmsNetwork } from './tfms/operators.js';

export function createTerrainEngine({
  THREE,
  seed = defaultWorldOptions.seedHash,
  worldConfig = {},
} = {}) {
  if (!THREE) {
    throw new Error('createTerrainEngine requires a THREE instance');
  }

  const defaults = defaultWorldOptions.terrain;
  const terrainConfig = worldConfig.terrain ?? {};

  const baseHeight = Number.isFinite(worldConfig.baseHeight)
    ? worldConfig.baseHeight
    : Number.isFinite(terrainConfig.baseHeight)
      ? terrainConfig.baseHeight
      : defaults.baseHeight;

  const maxHeight = Number.isFinite(worldConfig.maxHeight)
    ? worldConfig.maxHeight
    : Number.isFinite(terrainConfig.maxHeight)
      ? terrainConfig.maxHeight
      : defaults.maxHeight;

  const config = {
    baseHeight,
    maxHeight,
    primaryFrequency:
      Number.isFinite(terrainConfig.primaryFrequency)
        ? terrainConfig.primaryFrequency
        : defaults.primaryFrequency,
    primaryAmplitude:
      Number.isFinite(terrainConfig.primaryAmplitude)
        ? terrainConfig.primaryAmplitude
        : defaults.primaryAmplitude,
    primaryOffset:
      Number.isFinite(terrainConfig.primaryOffset)
        ? terrainConfig.primaryOffset
        : defaults.primaryOffset,
    detailFrequency:
      Number.isFinite(terrainConfig.detailFrequency)
        ? terrainConfig.detailFrequency
        : defaults.detailFrequency,
    detailAmplitude:
      Number.isFinite(terrainConfig.detailAmplitude)
        ? terrainConfig.detailAmplitude
        : defaults.detailAmplitude,
    detailOffset:
      Number.isFinite(terrainConfig.detailOffset)
        ? terrainConfig.detailOffset
        : defaults.detailOffset,
    ridgeFrequency:
      Number.isFinite(terrainConfig.ridgeFrequency)
        ? terrainConfig.ridgeFrequency
        : defaults.ridgeFrequency,
    ridgeStrength:
      Number.isFinite(terrainConfig.ridgeStrength)
        ? terrainConfig.ridgeStrength
        : defaults.ridgeStrength,
    ridgeOffset:
      Number.isFinite(terrainConfig.ridgeOffset)
        ? terrainConfig.ridgeOffset
        : defaults.ridgeOffset,
    climateHeightInfluence:
      Number.isFinite(terrainConfig.climateHeightInfluence)
        ? terrainConfig.climateHeightInfluence
        : defaults.climateHeightInfluence,
  };

  const tfmsConfig = normalizeTfmsConfiguration({
    seed,
    terrainConfig,
    defaults: config,
  });

  const tfmsNetwork = createTfmsNetwork({
    seed: seed * 1.91 + 73,
    operators: tfmsConfig.operators,
    modulationMatrix: tfmsConfig.modulationMatrix,
    transferFunctions: tfmsConfig.transferFunctions,
    tectonic: tfmsConfig.tectonic,
  });

  const biomeEngine = createBiomeEngine({
    THREE,
    seed: seed * 1.37 + 19,
    biomeOptions: worldConfig.biomes,
  });

  function computeElevation(x, z) {
    const { envelope } = tfmsNetwork.evaluate({
      x,
      z,
      context: { terrain: config },
    });
    return config.baseHeight + envelope;
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeElevation(x, z);
    const climateAdjustment =
      (biomeSample.climate.moisture - 0.5) * config.climateHeightInfluence;
    height += climateAdjustment;
    const biomeOffset = biomeSample.biome.terrain.heightOffset ?? 0;
    height += biomeOffset;

    if (terrainConfig?.clamp) {
      const minClamp = terrainConfig.clamp.min;
      const maxClamp = terrainConfig.clamp.max;
      if (Number.isFinite(minClamp)) {
        height = Math.max(minClamp, height);
      }
      if (Number.isFinite(maxClamp)) {
        height = Math.min(maxClamp, height);
      }
    }
    if (Number.isFinite(config.maxHeight)) {
      height = Math.min(config.maxHeight, height);
    }
    return {
      ...biomeSample,
      height,
    };
  }

  return {
    sampleColumn,
    getBiomeAt: (x, z) => biomeEngine.getBiomeAt(x, z),
    getBlockColor: (biome, type) => biomeEngine.getBlockColor(biome, type),
    getDefaultBlockColor: () => biomeEngine.getDefaultBlockColor(),
    biomeEngine,
    dispose() {
      biomeEngine.dispose?.();
    },
  };
}

function normalizeTfmsConfiguration({ seed, terrainConfig, defaults }) {
  const fallback = createDefaultTfmsConfiguration({ seed, terrainConfig, defaults });
  const custom = terrainConfig.tfms ?? {};
  const operators = Array.isArray(custom.operators)
    ? fallback.operators.map((defaultOperator, index) => ({
        ...defaultOperator,
        ...(custom.operators[index] ?? {}),
      }))
    : fallback.operators;
  return {
    operators,
    modulationMatrix: Array.isArray(custom.modulationMatrix)
      ? custom.modulationMatrix
      : fallback.modulationMatrix,
    tectonic: {
      ...fallback.tectonic,
      ...(typeof custom.tectonic === 'object' ? custom.tectonic : {}),
    },
    transferFunctions:
      typeof custom.transferFunctions === 'object'
        ? custom.transferFunctions
        : fallback.transferFunctions,
  };
}

function createDefaultTfmsConfiguration({ seed, terrainConfig, defaults }) {
  const terrain = terrainConfig ?? {};
  const baseAmplitude = terrain.primaryAmplitude ?? defaults.primaryAmplitude;
  const baseFrequency = terrain.primaryFrequency ?? defaults.primaryFrequency;
  const baseOffset = terrain.primaryOffset ?? defaults.primaryOffset;
  const detailAmplitude = terrain.detailAmplitude ?? defaults.detailAmplitude;
  const detailFrequency = terrain.detailFrequency ?? defaults.detailFrequency;
  const detailOffset = terrain.detailOffset ?? defaults.detailOffset;
  const ridgeStrength = terrain.ridgeStrength ?? defaults.ridgeStrength;
  const ridgeFrequency = terrain.ridgeFrequency ?? defaults.ridgeFrequency;
  const ridgeOffset = terrain.ridgeOffset ?? defaults.ridgeOffset;

  const operators = [
    {
      id: 'primary-fbm',
      type: 'fbm',
      seed: seed * 1.11 + 113,
      amplitude: baseAmplitude,
      frequency: baseFrequency,
      phase: { x: baseOffset, z: baseOffset },
      octaves: 6,
      lacunarity: 2,
      gain: 0.48,
      weight: 1,
      transfer: 'identity',
      tectonic: { weight: 0.18 },
    },
    {
      id: 'ridge-noise',
      type: 'ridged',
      seed: seed * 1.59 + 223,
      amplitude: ridgeStrength,
      frequency: ridgeFrequency,
      phase: { x: ridgeOffset, z: ridgeOffset },
      octaves: 3,
      lacunarity: 2.05,
      gain: 0.5,
      weight: 0.75,
      transfer: 'abs',
    },
    {
      id: 'anisotropic-banding',
      type: 'anisotropicSine',
      seed: seed * 1.73 + 257,
      amplitude: detailAmplitude * 0.75,
      frequency: detailFrequency * 1.5,
      phase: { x: detailOffset, z: detailOffset },
      orientation: Math.PI / 5,
      harmonics: 3,
      bias: 0,
      weight: 0.5,
      transfer: 'tanh',
    },
    {
      id: 'tectonic-worley',
      type: 'worley',
      seed: seed * 1.91 + 307,
      amplitude: detailAmplitude * 0.45,
      frequency: Math.max(0.0001, baseFrequency * 0.45),
      jitter: 0.85,
      falloff: 1.35,
      distanceMetric: 'euclidean',
      weight: 0.35,
      transfer: 'smoothstep',
      transferSettings: { smoothness: 0.4 },
      tectonic: { weight: 0.4 },
    },
    {
      id: 'domain-warp',
      type: 'domainWarp',
      seed: seed * 2.13 + 353,
      amplitude: baseAmplitude * 0.32,
      frequency: Math.max(0.0001, baseFrequency * 0.65),
      power: 1.1,
      gain: 0.9,
      weight: 0,
      transfer: 'identity',
    },
    {
      id: 'diffusion-mask',
      type: 'diffusion',
      seed: seed * 2.31 + 409,
      amplitude: detailAmplitude * 0.35,
      frequency: Math.max(0.0001, detailFrequency * 1.2),
      smoothing: 0.68,
      weight: 0.55,
      transfer: 'tanh',
    },
  ];

  const modulationMatrix = [
    {
      source: 5,
      target: 0,
      routing: 'amplitude',
      channel: 'transferred',
      gain: 0.4,
    },
    {
      source: 5,
      target: 1,
      routing: 'amplitude',
      channel: 'transferred',
      gain: 0.3,
    },
    {
      source: 5,
      target: 2,
      routing: 'amplitude',
      channel: 'transferred',
      gain: 0.25,
    },
    {
      source: 4,
      target: 0,
      routing: 'domainWarp',
      channel: 'domainX',
      gain: 0.7,
      axis: 'x',
    },
    {
      source: 4,
      target: 0,
      routing: 'domainWarp',
      channel: 'domainZ',
      gain: 0.7,
      axis: 'z',
    },
    {
      source: 4,
      target: 1,
      routing: 'domainWarp',
      channel: 'domainX',
      gain: 0.5,
      axis: 'x',
    },
    {
      source: 4,
      target: 1,
      routing: 'domainWarp',
      channel: 'domainZ',
      gain: 0.5,
      axis: 'z',
    },
    {
      source: 3,
      target: 1,
      routing: 'amplitude',
      channel: 'raw',
      gain: 0.35,
    },
    {
      source: 3,
      target: 2,
      routing: 'frequency',
      channel: 'raw',
      gain: 0.2,
    },
    {
      source: 1,
      target: 4,
      routing: 'amplitude',
      channel: 'transferred',
      gain: 0.35,
    },
    {
      source: 3,
      target: 5,
      routing: 'amplitude',
      channel: 'raw',
      gain: 0.45,
    },
  ];

  const tectonic = {
    blend: 'additive',
    strength: 0.35,
    bias: 0,
  };

  const transferFunctions = {};

  return {
    operators,
    modulationMatrix,
    tectonic,
    transferFunctions,
  };
}
