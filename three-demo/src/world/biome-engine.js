import { ValueNoise2D } from './noise.js';

import temperate from './biomes/temperate.json' with { type: 'json' };
import desert from './biomes/desert.json' with { type: 'json' };
import tundra from './biomes/tundra.json' with { type: 'json' };
import librarium from './biomes/pseudo_borgesian_librarium.json' with {
  type: 'json',
};
import vaporwave from './biomes/fading_vaporwave_dimension.json' with {
  type: 'json',
};
import auroral from './biomes/auroral_glass_reef.json' with { type: 'json' };
import noctilucent from './biomes/noctilucent_fungus_glade.json' with {
  type: 'json',
};


const rawBiomeDefinitions = [
  temperate,
  desert,
  tundra,
  librarium,
  vaporwave,
  auroral,
  noctilucent,
];

const NEUTRAL_BASE_PALETTE = {
  grass: '#4a9c47',
  dirt: '#6b4a2f',
  stone: '#8c8c8c',
  sand: '#d7c27a',
  water: '#1f4d8f',
  leaf: '#3f7c35',
  log: '#725032',
  cloud: '#f7f8fb',
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mixValues(a, b, weight) {
  return a * (1 - weight) + b * weight;
}

export function createBiomeEngine({ THREE, seed = 1337 } = {}) {
  if (!THREE) {
    throw new Error('createBiomeEngine requires a THREE instance');
  }

  const temperatureNoise = new ValueNoise2D(seed * 1.37 + 97);
  const temperatureDetailNoise = new ValueNoise2D(seed * 1.91 + 227);
  const moistureNoise = new ValueNoise2D(seed * 1.51 + 157);
  const moistureDetailNoise = new ValueNoise2D(seed * 2.03 + 311);
  const varianceNoise = new ValueNoise2D(seed * 1.73 + 443);

  const climateScale = 0.003;
  const detailScale = climateScale * 2.15;
  const varianceScale = climateScale * 0.45;

  const defaultColor = new THREE.Color(0xffffff);
  const basePaletteColors = Object.fromEntries(
    Object.entries(NEUTRAL_BASE_PALETTE).map(([type, hex]) => [
      type,
      new THREE.Color(hex),
    ]),
  );

  const biomes = rawBiomeDefinitions.map((definition, index) => {
    const palette = { ...NEUTRAL_BASE_PALETTE, ...(definition.palette ?? {}) };
    const paletteColors = Object.fromEntries(
      Object.entries(palette).map(([type, hex]) => {
        const targetColor = new THREE.Color(hex);
        const baseColor = basePaletteColors[type] ?? defaultColor;
        const tint = new THREE.Color(
          baseColor.r === 0 ? 1 : targetColor.r / baseColor.r,
          baseColor.g === 0 ? 1 : targetColor.g / baseColor.g,
          baseColor.b === 0 ? 1 : targetColor.b / baseColor.b,
        );
        return [type, tint];
      }),
    );

    const terrainDefinition = definition.terrain ?? {};
    const treeHeight = terrainDefinition.treeHeight ?? {};

    const shaderDefinition = definition.shader ?? {};

    return {
      id: definition.id ?? `biome_${index}`,
      label: definition.label ?? definition.id ?? `Biome ${index + 1}`,
      tags: Array.isArray(definition.tags)
        ? definition.tags.filter((tag) => typeof tag === 'string')
        : [],
      climate: {
        temperature: clamp01(definition.climate?.temperature ?? 0.5),
        moisture: clamp01(definition.climate?.moisture ?? 0.5),
        weight: Math.max(0.001, definition.climate?.weight ?? 1),
      },
      palette,
      paletteColors,
      terrain: {
        surfaceBlock: terrainDefinition.surfaceBlock ?? 'grass',
        shoreBlock: terrainDefinition.shoreBlock ?? 'sand',
        subSurfaceBlock: terrainDefinition.subSurfaceBlock ?? 'dirt',
        subSurfaceDepth: Math.max(1, Math.floor(terrainDefinition.subSurfaceDepth ?? 4)),
        deepBlock: terrainDefinition.deepBlock ?? 'stone',
        treeDensity: clamp01(terrainDefinition.treeDensity ?? 0.08),
        shrubChance: clamp01(terrainDefinition.shrubChance ?? 0.02),
        flowerChance: clamp01(terrainDefinition.flowerChance ?? 0.01),
        rockChance: clamp01(terrainDefinition.rockChance ?? 0),
        fungiChance: clamp01(terrainDefinition.fungiChance ?? 0),
        waterPlantChance: clamp01(terrainDefinition.waterPlantChance ?? 0),
        structureChance: clamp01(terrainDefinition.structureChance ?? 0),
        treeHeight: {
          min: Math.max(1, Math.floor(treeHeight.min ?? 3)),
          max: Math.max(Math.floor(treeHeight.max ?? 6), Math.floor(treeHeight.min ?? 3)),
        },
        heightOffset: terrainDefinition.heightOffset ?? 0,
      },
      shader: {
        fogColor: new THREE.Color(shaderDefinition.fogColor ?? '#a9d6ff'),
        tintColor: new THREE.Color(shaderDefinition.tintColor ?? '#ffffff'),
        tintStrength: clamp01(shaderDefinition.tintStrength ?? 0),
      },
    };
  });

  function sampleNoisePair(noiseA, noiseB, x, z, baseScale, detailScale) {
    const base = noiseA.noise(x * baseScale, z * baseScale);
    const detail = noiseB.noise(x * detailScale, z * detailScale);
    return clamp01(mixValues(base, detail, 0.35));
  }

  function sampleClimate(x, z) {
    const temperature = sampleNoisePair(
      temperatureNoise,
      temperatureDetailNoise,
      x,
      z,
      climateScale,
      detailScale,
    );
    const moisture = sampleNoisePair(
      moistureNoise,
      moistureDetailNoise,
      x,
      z,
      climateScale,
      detailScale * 1.18,
    );

    return { temperature, moisture };
  }

  function selectBiome(climate, x, z) {
    let selected = biomes[0];
    let bestScore = Number.POSITIVE_INFINITY;

    biomes.forEach((biome, index) => {
      const dx = climate.temperature - biome.climate.temperature;
      const dy = climate.moisture - biome.climate.moisture;
      const distance = Math.sqrt(dx * dx + dy * dy) / biome.climate.weight;
      const variation = varianceNoise.noise(
        x * varianceScale + index * 17.13,
        z * varianceScale + index * 31.17,
      );
      const adjustedDistance = distance - (variation - 0.5) * 0.18;
      if (adjustedDistance < bestScore) {
        bestScore = adjustedDistance;
        selected = biome;
      }
    });

    return { biome: selected, score: bestScore };
  }

  function getBiomeAt(x, z) {
    const climate = sampleClimate(x, z);
    const selection = selectBiome(climate, x, z);
    return {
      biome: selection.biome,
      climate,
      score: selection.score,
    };
  }

  function getBlockColor(biome, type) {
    if (!biome?.paletteColors) {
      return defaultColor;
    }
    return biome.paletteColors[type] ?? defaultColor;
  }

  return {
    biomes,
    sampleClimate,
    getBiomeAt,
    getBlockColor,
    getDefaultBlockColor() {
      return defaultColor;
    },
  };
}
