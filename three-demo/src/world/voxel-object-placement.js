import {
  getWeightedVoxelObject,
  isVoxelObjectAllowedInBiome,
} from './voxel-object-library.js';
import {
  ZERO_OFFSET,
  cloneOffset,
  cloneScale,
  computeVoxelObjectPlacements,
  getVoxelObjectPrototype,
} from './voxel-object-prototypes.js';
import {
  getSectorPlacementsForColumn,
  markPlacementCompleted,
} from './sector-object-planner.js';
import { ValueNoise2D } from './noise.js';
import {
  cloneDecorationOptions,
  getDecorationMeshTemplate,
} from './voxel-object-decoration-mesh.js';

const objectDensityField = new ValueNoise2D(9103);

function ensureRandomSource(randomSource) {
  if (typeof randomSource === 'function') {
    return randomSource;
  }
  return () => Math.random();
}

export function placeVoxelObject(
  { addBlock, addDecorationInstance, addPrototypeInstance, addDecorationMesh } = {},
  object,
  { origin, biome } = {},
) {
  if (!object || typeof addBlock !== 'function') {
    return;
  }

  const decorationCollector =
    typeof addDecorationInstance === 'function' ? addDecorationInstance : addBlock;

  const base = origin ?? { x: 0, y: 0, z: 0 };
  const groundAnchorOffset = object.attachment?.groundOffset ?? object.voxelScale;
  const anchor = {
    x: base.x,
    y: base.y - groundAnchorOffset,
    z: base.z,
  };

  const usePrototypePlacement =
    object?.destructionMode !== 'per-voxel' && typeof addPrototypeInstance === 'function';

  if (usePrototypePlacement) {
    const prototype = getVoxelObjectPrototype(object);
    if (prototype) {
      const instanceKey = [
        object.id ?? 'object',
        anchor.x.toFixed(3),
        anchor.y.toFixed(3),
        anchor.z.toFixed(3),
      ].join('|');
      addPrototypeInstance(prototype, {
        anchor,
        biome,
        instanceKey,
      });
      return;
    }
  }

  const decorationTemplate = getDecorationMeshTemplate(object, () =>
    computeVoxelObjectPlacements(object),
  );
  const placements = decorationTemplate?.placements ?? computeVoxelObjectPlacements(object);
  if (!placements) {
    return;
  }

  const blockPlacements = Array.isArray(placements.blocks) ? placements.blocks : [];

  blockPlacements.forEach((block, index) => {
    const worldX = anchor.x + block.position.x;
    const worldY = anchor.y + block.position.y;
    const worldZ = anchor.z + block.position.z;
    const key = `${object.id ?? 'object'}|${block.voxelIndex}|${worldX}|${worldY}|${worldZ}`;

    addBlock(block.type, worldX, worldY, worldZ, biome, {
      scale: cloneScale(block.scale),
      visualScale: cloneScale(block.visualScale),
      visualOffset: cloneOffset(block.visualOffset ?? ZERO_OFFSET),
      collisionMode: block.collisionMode,
      isSolid: block.collisionMode === 'solid',
      destructible: block.destructible,
      tint: block.tint,
      sourceObjectId: block.sourceObjectId ?? object.id ?? null,
      voxelIndex: block.voxelIndex,
      metadata: block.metadata,
      key,
    });
  });

  const decorationEntries = decorationTemplate?.decorations ?? placements.decorations ?? [];
  let decorationsHandled = false;
  if (
    decorationTemplate &&
    typeof addDecorationMesh === 'function' &&
    decorationEntries.length > 0
  ) {
    decorationsHandled = addDecorationMesh(decorationTemplate, { anchor, biome, object });
  }

  if (decorationsHandled) {
    return;
  }

  decorationEntries.forEach((decoration, index) => {
    const worldX = anchor.x + decoration.position.x;
    const worldY = anchor.y + decoration.position.y;
    const worldZ = anchor.z + decoration.position.z;
    const options = cloneDecorationOptions(decoration.options ?? {});
    const fallbackKey = `${object.id ?? 'object'}|decor|${index}`;
    const keyBase = decoration.baseKey ?? options.key ?? fallbackKey;
    options.key = `${keyBase}|${worldX}|${worldY}|${worldZ}`;

    decorationCollector(decoration.type, worldX, worldY, worldZ, biome, options);
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
  addDecorationInstance,
  addPrototypeInstance,
  addDecorationMesh,
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
  const columnBaseOffset = {
    x: (random(7) - 0.5) * 0.8,
    z: (random(8) - 0.5) * 0.8,
  };
  const densityNoise = objectDensityField.noise(worldX * 0.11, worldZ * 0.11);
  const densityScale = 0.28 + densityNoise * 0.32;

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

  let plannedStructurePlacements = 0;
  const applySectorPlacements = () => {
    const { placements } = getSectorPlacementsForColumn(worldX, worldZ);
    plannedStructurePlacements = placements.reduce((count, placement) => {
      return placement.category === 'structures' ? count + 1 : count;
    }, 0);
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
        ? 0.85
        : 0;
    const baseX =
      typeof options.baseX === 'number' ? options.baseX : worldX + columnBaseOffset.x;
    const baseZ =
      typeof options.baseZ === 'number' ? options.baseZ : worldZ + columnBaseOffset.z;
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
      const placementHandlers = {
        addBlock,
        addDecorationInstance,
        addDecorationMesh,
      };
      if (
        object.destructionMode !== 'per-voxel' &&
        typeof addPrototypeInstance === 'function'
      ) {
        placementHandlers.addPrototypeInstance = addPrototypeInstance;
      }
      placeVoxelObject(placementHandlers, object, { origin, biome });
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

  const structureChanceRaw = Math.max(0, terrain.structureChance ?? 0);
  const structureChance = Math.min(1, structureChanceRaw) * densityScale;
  const adjustedStructureChance =
    plannedStructurePlacements > 0 ? structureChance * 0.1 : structureChance;
  if (adjustedStructureChance > 0) {
    attemptCategory('structures', adjustedStructureChance, 151, {
      allowUnderwater: true,
    });
  }
}

