import { ValueNoise2D } from './noise.js';
import { createBiomeEngine } from './biome-engine.js';

export function createTerrainEngine({ THREE, seed = 1337, worldConfig = {} } = {}) {
  if (!THREE) {
    throw new Error('createTerrainEngine requires a THREE instance');
  }

  const config = {
    baseHeight: worldConfig.baseHeight ?? 6,
    maxHeight: worldConfig.maxHeight ?? 20,
  };

  const elevationNoise = new ValueNoise2D(seed * 1.11 + 67);
  const detailNoise = new ValueNoise2D(seed * 1.59 + 139);
  const ridgeNoise = new ValueNoise2D(seed * 2.03 + 211);

  const biomeEngine = createBiomeEngine({ THREE, seed: seed * 1.37 + 19 });

  function computeElevation(x, z) {
    const n1 = elevationNoise.noise(x * 0.06, z * 0.06);
    const n2 = detailNoise.noise(x * 0.12 + 100, z * 0.12 + 100);
    const ridges = ridgeNoise.noise(x * 0.02 + 220, z * 0.02 + 220);
    const ridgeInfluence = (ridges - 0.5) * 2.4;
    return config.baseHeight + n1 * 8 + n2 * 3 + ridgeInfluence;
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeElevation(x, z);
    const climateAdjustment = (biomeSample.climate.moisture - 0.5) * 1.2;
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
  };
}
