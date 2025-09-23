import {
  getWeightedVoxelObject,
  isVoxelObjectAllowedInBiome,
} from './voxel-object-library.js';
import { resolveVoxelObjectVoxels } from './voxel-object-processor.js';
import {
  getSectorPlacementsForColumn,
  markPlacementCompleted,
} from './sector-object-planner.js';

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

  const applySectorPlacements = () => {
    const { placements } = getSectorPlacementsForColumn(worldX, worldZ);
    placements.forEach((placement) => {
      if (placement.completed) {
        return;
      }
      if (placement.requireUnderwater && !isUnderwater) {
        markPlacementCompleted(placement);
        return;
      }
      if (!placement.allowUnderwater && isUnderwater) {
        markPlacementCompleted(placement);
        return;
      }
      if (placement.preferShore && distanceToWater > 3) {
        markPlacementCompleted(placement);
        return;
      }

      const object = selectObject(
        placement.category,
        biome,
        random,
        placement.randomSeed,
      );
      if (!object) {
        markPlacementCompleted(placement);
        return;
      }
      if (!canPlaceObject(object)) {
        markPlacementCompleted(placement);
        return;
      }

      const baseX = placement.anchor?.x ?? worldX;
      const baseZ = placement.anchor?.z ?? worldZ;
      const jitterRadius =
        placement.jitterRadius !== undefined && placement.jitterRadius !== null
          ? placement.jitterRadius
          : object.voxelScale < 1
          ? 0.5
          : 0.75;

      const placed = placeObject(object, placement.randomSeed, {
        baseX,
        baseZ,
        jitterRadius,
        instances: placement.instances,
        angleSeed: 320 + placement.randomSeed,
        radiusSeed: 420 + placement.randomSeed,
      });

      if (placed) {
        markPlacementCompleted(placement);
      }
    });
  };

  const placeObject = (object, seedOffset = 0, options = {}) => {
    if (!canPlaceObject(object)) {
      return false;
    }
    const placement = object.placement ?? {};
    const instancePreference =
      typeof options.instances === 'number'
        ? options.instances
        : placement.maxInstancesPerColumn || 1;
    const instances = Math.max(1, instancePreference);
    const jitterRadius =
      options.jitterRadius !== null && options.jitterRadius !== undefined
        ? options.jitterRadius
        : placement.jitterRadius !== null && placement.jitterRadius !== undefined
        ? placement.jitterRadius
        : object.voxelScale < 1
        ? 0.35
        : 0;
    const baseX =
      typeof options.baseX === 'number' ? options.baseX : worldX;
    const baseZ =
      typeof options.baseZ === 'number' ? options.baseZ : worldZ;
    const angleSeedOffset = options.angleSeed ?? 120 + seedOffset * 13;
    const radiusSeedOffset = options.radiusSeed ?? 220 + seedOffset * 17;
    for (let i = 0; i < instances; i++) {
      const angle =
        options.fixedAngle !== undefined
          ? options.fixedAngle
          : random(angleSeedOffset + i) * Math.PI * 2;
      const radius =
        options.fixedRadius !== undefined
          ? options.fixedRadius
          : jitterRadius > 0
          ? random(radiusSeedOffset + i) * jitterRadius
          : 0;
      const origin = {
        x: baseX + Math.cos(angle) * radius,
        y: groundHeight + (object.attachment?.groundOffset ?? object.voxelScale),
        z: baseZ + Math.sin(angle) * radius,
      };
      placeVoxelObject(addBlock, object, { origin, biome });
    }
    return true;
  };

  applySectorPlacements();

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

  const densityScale = 0.45;
  const treeDensity = Math.max(0, terrain.treeDensity ?? 0) * densityScale;
  if (treeDensity > 0 && !isUnderwater) {
    const roll = random(31);
    if (roll > 1 - treeDensity) {
      const tree = selectObject('large-plants', biome, random, 41);
      placeObject(tree, 31);
    }
  }

  const shrubChance = Math.max(0, terrain.shrubChance ?? 0) * densityScale;
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

  attemptCategory(
    'rocks',
    Math.max(0, terrain.rockChance ?? 0) * densityScale,
    91,
    {
      allowUnderwater: false,
    },
  );

  attemptCategory('fungi', Math.max(0, terrain.fungiChance ?? 0) * densityScale, 111, {
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

