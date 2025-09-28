import { ValueNoise2D } from './noise.js';
import { createBiomeEngine } from './biome-engine.js';
import { defaultWorldOptions } from './world-settings.js';

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

  const elevationNoise = new ValueNoise2D(seed * 1.11 + 67);
  const detailNoise = new ValueNoise2D(seed * 1.59 + 139);
  const ridgeNoise = new ValueNoise2D(seed * 2.03 + 211);

  const biomeEngine = createBiomeEngine({
    THREE,
    seed: seed * 1.37 + 19,
    biomeOptions: worldConfig.biomes,
  });

  function computeElevation(x, z) {
    const n1 = elevationNoise.noise(
      x * config.primaryFrequency + config.primaryOffset,
      z * config.primaryFrequency + config.primaryOffset,
    );
    const n2 = detailNoise.noise(
      x * config.detailFrequency + config.detailOffset,
      z * config.detailFrequency + config.detailOffset,
    );
    const ridges = ridgeNoise.noise(
      x * config.ridgeFrequency + config.ridgeOffset,
      z * config.ridgeFrequency + config.ridgeOffset,
    );
    const ridgeInfluence = (ridges - 0.5) * config.ridgeStrength;
    return (
      config.baseHeight +
      n1 * config.primaryAmplitude +
      n2 * config.detailAmplitude +
      ridgeInfluence
    );
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeElevation(x, z);
    const climateAdjustment =
      (biomeSample.climate.moisture - 0.5) * config.climateHeightInfluence;
    height += climateAdjustment + (biomeSample.biome.terrain.heightOffset ?? 0);
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
