import {
  getWeightedVoxelObject,
  isVoxelObjectAllowedInBiome,
} from './voxel-object-library.js';
import { resolveVoxelObjectVoxels } from './voxel-object-processor.js';

function ensureRandomSource(randomSource) {
  if (typeof randomSource === 'function') {
    return randomSource;
  }
  return () => Math.random();
}

function resolveScaleVector({ size }, voxelScale) {
  return {
    x: (size.x ?? 1) * voxelScale,
    y: (size.y ?? 1) * voxelScale,
    z: (size.z ?? 1) * voxelScale,
  };
}


function resolveCollisionMode(voxel, object) {
  if (voxel?.collisionMode) {
    return voxel.collisionMode;
  }
  if (typeof voxel?.isSolid === 'boolean') {
    return voxel.isSolid ? 'solid' : 'none';
  }
  const objectMode = object?.collision?.mode ?? 'auto';
  if (objectMode !== 'auto') {
    return objectMode;
  }
  return object.voxelScale < 1 ? 'none' : 'solid';
}


export function placeVoxelObject(addBlock, object, { origin, biome } = {}) {
  if (!object || typeof addBlock !== 'function') {
    return;
  }
  const base = origin ?? { x: 0, y: 0, z: 0 };
  const groundAnchorOffset = object.attachment?.groundOffset ?? object.voxelScale;
  const anchor = {
    x: base.x,
    y: base.y - groundAnchorOffset,
    z: base.z,
  };

  const defaultSolidOverride = object.voxelScale < 1;


  const voxels = resolveVoxelObjectVoxels(object);

  voxels.forEach((voxel) => {
    const scale = resolveScaleVector(voxel, object.voxelScale);
    const worldX = anchor.x + voxel.position.x * object.voxelScale;
    const worldY = anchor.y + voxel.position.y * object.voxelScale + scale.y / 2;
    const worldZ = anchor.z + voxel.position.z * object.voxelScale;

    const collisionMode = resolveCollisionMode(voxel, object);

    addBlock(voxel.type, worldX, worldY, worldZ, biome, {
      scale,
      collisionMode,
      isSolid: collisionMode === 'solid',

      destructible: voxel.destructible,
      tint: voxel.tint,
      sourceObjectId: object.id,
      voxelIndex: voxel.index,
      metadata: voxel.metadata,
      key: `${object.id}|${voxel.index}|${worldX}|${worldY}|${worldZ}`,
    });
  });
}

function selectObject(category, biome, randomSource, randomOffset) {
  const randomValue = randomSource(randomOffset);
  const object = getWeightedVoxelObject(category, biome, randomValue);
  if (!object) {
    return null;
  }
  if (!isVoxelObjectAllowedInBiome(object, biome)) {
    return null;
  }
  return object;
}

export function populateColumnWithVoxelObjects({
  addBlock,
  biome,
  columnSample,
  groundHeight,
  randomSource,
  slope = 0,
  worldX,
  worldZ,
  isUnderwater = false,
  isShore = false,
  waterLevel = 0,
  distanceToWater = Infinity,
}) {
  if (!biome) {
    return;
  }
  const random = ensureRandomSource(randomSource);
  const terrain = biome.terrain ?? {};

  const climate = columnSample?.climate ?? biome?.climate ?? {};

  const canPlaceObject = (object) => {
    if (!object) {
      return false;
    }
    const placement = object.placement ?? {};
    if (placement.minSlope !== null && slope < placement.minSlope) {
      return false;
    }
    if (placement.maxSlope !== null && slope > placement.maxSlope) {
      return false;
    }
    if (placement.requiresUnderwater && !isUnderwater) {
      return false;
    }
    if (placement.forbidUnderwater && isUnderwater) {
      return false;
    }
    if (placement.onlyOnShore && !isShore) {
      return false;
    }
    if (placement.forbidShore && isShore) {
      return false;
    }
    if (
      typeof placement.minHeight === 'number' &&
      groundHeight < placement.minHeight
    ) {
      return false;
    }
    if (
      typeof placement.maxHeight === 'number' &&
      groundHeight > placement.maxHeight
    ) {
      return false;
    }
    if (
      typeof placement.minMoisture === 'number' &&
      climate.moisture < placement.minMoisture
    ) {
      return false;
    }
    if (
      typeof placement.maxMoisture === 'number' &&
      climate.moisture > placement.maxMoisture
    ) {
      return false;
    }
    if (
      typeof placement.minTemperature === 'number' &&
      climate.temperature < placement.minTemperature
    ) {
      return false;
    }
    if (
      typeof placement.maxTemperature === 'number' &&
      climate.temperature > placement.maxTemperature
    ) {
      return false;
    }
    if (placement.requiresWaterProximity) {
      const radius =
        typeof placement.waterProximityRadius === 'number'
          ? placement.waterProximityRadius
          : 1;
      if (distanceToWater > radius) {
        return false;
      }
    }
    return true;
  };

  const placeObject = (object, seedOffset = 0) => {
    if (!canPlaceObject(object)) {
      return false;
    }
    const placement = object.placement ?? {};
    const instances = Math.max(1, placement.maxInstancesPerColumn || 1);
    const jitterRadius =
      placement.jitterRadius !== null && placement.jitterRadius !== undefined
        ? placement.jitterRadius
        : object.voxelScale < 1
        ? 0.35
        : 0;
    for (let i = 0; i < instances; i++) {
      const angle = random(120 + seedOffset * 13 + i) * Math.PI * 2;
      const radius = jitterRadius > 0 ? random(220 + seedOffset * 17 + i) * jitterRadius : 0;
      const origin = {
        x: worldX + Math.cos(angle) * radius,
        y: groundHeight + (object.attachment?.groundOffset ?? object.voxelScale),
        z: worldZ + Math.sin(angle) * radius,
      };
      placeVoxelObject(addBlock, object, { origin, biome });
    }
    return true;
  };

  const attemptCategory = (
    category,
    chance,
    randomOffset,
    { allowUnderwater = false, requireUnderwater = false } = {},
  ) => {
    if (chance <= 0) {
      return false;
    }
    if (requireUnderwater && !isUnderwater) {
      return false;
    }
    if (!allowUnderwater && isUnderwater) {
      return false;
    }
    const roll = random(randomOffset);
    if (roll <= 1 - chance) {
      return false;
    }
    const object = selectObject(category, biome, random, randomOffset + 11);
    return placeObject(object, randomOffset);
  };

  const treeDensity = Math.max(0, terrain.treeDensity ?? 0);
  if (treeDensity > 0 && !isUnderwater) {
    const roll = random(31);
    if (roll > 1 - treeDensity) {
      const tree = selectObject('large-plants', biome, random, 41);
      placeObject(tree, 31);
    }
  }

  const shrubChance = Math.max(0, terrain.shrubChance ?? 0);
  if (shrubChance > 0 && !isUnderwater) {
    const roll = random(51);
    if (roll > 1 - shrubChance) {
      const shrub = selectObject('small-plants', biome, random, 61);
      placeObject(shrub, 51);
    }
  }

  const flowerChanceRaw = terrain.flowerChance ?? shrubChance * 0.65;
  const flowerChance = Math.max(0, Math.min(1, flowerChanceRaw || 0));
  if (flowerChance > 0 && !isUnderwater) {
    const roll = random(71);
    if (roll > 1 - flowerChance) {
      const flower = selectObject('flowers', biome, random, 81);
      placeObject(flower, 71);
    }
  }

  attemptCategory('rocks', Math.max(0, terrain.rockChance ?? 0), 91, {
    allowUnderwater: false,
  });

  attemptCategory('fungi', Math.max(0, terrain.fungiChance ?? 0), 111, {
    allowUnderwater: false,
  });

  attemptCategory(
    'water-plants',
    Math.max(0, terrain.waterPlantChance ?? 0),
    131,
    { allowUnderwater: true, requireUnderwater: true },
  );

  attemptCategory('structures', Math.max(0, terrain.structureChance ?? 0), 151, {
    allowUnderwater: true,
  });
}

