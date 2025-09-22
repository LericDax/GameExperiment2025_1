import { getWeightedVoxelObject, isVoxelObjectAllowedInBiome } from './voxel-object-library.js';

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

  const defaultSolidOverride = object.voxelScale < 1;


  object.voxels.forEach((voxel) => {
    const scale = resolveScaleVector(voxel, object.voxelScale);
    const worldX = base.x + voxel.position.x * object.voxelScale;
    const worldY = base.y + voxel.position.y * object.voxelScale;
    const worldZ = base.z + voxel.position.z * object.voxelScale;

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
  groundHeight,
  randomSource,
  worldX,
  worldZ,
}) {
  if (!biome) {
    return;
  }
  const random = ensureRandomSource(randomSource);
  const terrain = biome.terrain ?? {};

  const placeObject = (object) => {
    if (!object) {
      return false;
    }
    const origin = {
      x: worldX,
      y: groundHeight + (object.attachment?.groundOffset ?? object.voxelScale),
      z: worldZ,
    };
    placeVoxelObject(addBlock, object, { origin, biome });
    return true;
  };

  const treeDensity = Math.max(0, terrain.treeDensity ?? 0);
  if (treeDensity > 0) {
    const roll = random(31);
    if (roll > 1 - treeDensity) {
      const tree = selectObject('large-plants', biome, random, 41);
      placeObject(tree);
    }
  }

  const shrubChance = Math.max(0, terrain.shrubChance ?? 0);
  if (shrubChance > 0) {
    const roll = random(51);
    if (roll > 1 - shrubChance) {
      const shrub = selectObject('small-plants', biome, random, 61);
      placeObject(shrub);
    }
  }

  const flowerChanceRaw = terrain.flowerChance ?? shrubChance * 0.65;
  const flowerChance = Math.max(0, Math.min(1, flowerChanceRaw || 0));
  if (flowerChance > 0) {
    const roll = random(71);
    if (roll > 1 - flowerChance) {
      const flower = selectObject('flowers', biome, random, 81);
      if (flower) {
        const maxInstances = Math.max(1, flower.placement.maxInstancesPerColumn || 1);
        for (let i = 0; i < maxInstances; i++) {
          const offsetAngle = random(82 + i) * Math.PI * 2;
          const radialDistance = flower.voxelScale < 1 ? random(83 + i) * 0.35 : 0;
          const origin = {
            x:
              worldX +
              Math.cos(offsetAngle) * radialDistance,
            y:
              groundHeight + (flower.attachment?.groundOffset ?? flower.voxelScale),
            z:
              worldZ +
              Math.sin(offsetAngle) * radialDistance,
          };
          placeVoxelObject(addBlock, flower, { origin, biome });
        }
      }
    }
  }
}

