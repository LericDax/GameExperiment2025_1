import test from 'node:test';
import assert from 'node:assert/strict';

import { isBlockOccluding } from '../block-occlusion.js';
import {
  clearVoxelObjectPrototypeCache,
  getVoxelObjectPrototype,
} from '../voxel-object-prototypes.js';
import skywaveRelayDefinition from '../voxel-objects/structures/skywave_relay.json' with {
  type: 'json',
};

function asArray(value, dimension, label) {
  if (!Array.isArray(value) || value.length !== dimension) {
    throw new Error(`Invalid ${label}; expected array of length ${dimension}.`);
  }
  return value.map((component) => {
    if (typeof component !== 'number' || Number.isNaN(component)) {
      throw new Error(`Invalid ${label} component in voxel object definition.`);
    }
    return component;
  });
}

function parseSize(value) {
  if (value === undefined || value === null) {
    return { x: 1, y: 1, z: 1 };
  }
  if (typeof value === 'number') {
    return { x: value, y: value, z: value };
  }
  if (Array.isArray(value)) {
    const [x, y, z] = asArray(value, 3, 'size');
    return { x, y, z };
  }
  if (typeof value === 'object') {
    const x = typeof value.x === 'number' ? value.x : 1;
    const y = typeof value.y === 'number' ? value.y : 1;
    const z = typeof value.z === 'number' ? value.z : 1;
    return { x, y, z };
  }
  throw new Error('Unsupported size value in voxel object definition.');
}

function normalizeVoxel(voxel, index) {
  if (!voxel || typeof voxel !== 'object') {
    throw new Error(`Invalid voxel entry at index ${index}.`);
  }
  if (typeof voxel.type !== 'string' || voxel.type.trim().length === 0) {
    throw new Error(`Voxel entry at index ${index} is missing a valid block type.`);
  }
  const [px, py, pz] = asArray(voxel.position, 3, 'position');
  const size = parseSize(voxel.size);
  const collisionMode =
    typeof voxel.collision === 'string'
      ? voxel.collision.toLowerCase()
      : typeof voxel.collision?.mode === 'string'
      ? voxel.collision.mode.toLowerCase()
      : null;

  return {
    index,
    type: voxel.type,
    position: { x: px, y: py, z: pz },
    size,
    tint: typeof voxel.tint === 'string' ? voxel.tint : null,
    isSolid: typeof voxel.isSolid === 'boolean' ? voxel.isSolid : undefined,
    destructible:
      typeof voxel.destructible === 'boolean' ? voxel.destructible : undefined,
    ignoreBiomeTint:
      typeof voxel.ignoreBiomeTint === 'boolean' ? voxel.ignoreBiomeTint : undefined,
    collisionMode,
    metadata: typeof voxel.metadata === 'object' ? { ...voxel.metadata } : null,
  };
}

function normalizeDefinition(rawInput) {
  const definition = rawInput?.default ?? rawInput;
  if (!definition || typeof definition !== 'object') {
    throw new Error('Voxel object definition is invalid.');
  }

  const collisionSource = (() => {
    if (typeof definition.collision === 'string') {
      return definition.collision.toLowerCase();
    }
    if (typeof definition.collision?.mode === 'string') {
      return definition.collision.mode.toLowerCase();
    }
    return 'auto';
  })();
  const collisionMode = ['auto', 'solid', 'none', 'soft'].includes(collisionSource)
    ? collisionSource
    : 'auto';

  const voxels = Array.isArray(definition.voxels)
    ? definition.voxels.map((voxel, index) => normalizeVoxel(voxel, index))
    : [];

  return {
    id: definition.id,
    label: typeof definition.label === 'string' ? definition.label : definition.id,
    description: typeof definition.description === 'string' ? definition.description : '',
    author: typeof definition.author === 'string' ? definition.author : 'unknown',
    category:
      typeof definition.category === 'string' ? definition.category : 'uncategorized',
    voxelScale: definition.voxelScale,
    attachment: {
      groundOffset:
        typeof definition?.attachment?.groundOffset === 'number'
          ? definition.attachment.groundOffset
          : definition.voxelScale,
    },
    placement: definition.placement ?? {},
    voxels,
    boundingBox: null,
    destructionMode:
      typeof definition.destructionMode === 'string'
        ? definition.destructionMode.toLowerCase()
        : 'prototype',
    ignoreBiomeTint: definition.ignoreBiomeTint === true,
    collision: { mode: collisionMode },
    path: 'skywave_relay.json',
    raw: definition,
  };
}

const neighborOffsets3D = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

test('cryoshard structures leave adjacent terrain instanced after meshing', () => {
  clearVoxelObjectPrototypeCache();

  const object = normalizeDefinition(skywaveRelayDefinition);
  assert.ok(object, 'expected skywave_relay object definition');

  const prototype = getVoxelObjectPrototype(object);
  assert.ok(prototype, 'expected a prototype for the skywave relay');

  const cryoshardBlock = prototype.blocks.find(
    (block) => block.type === 'cryoshard_glass',
  );
  assert.ok(cryoshardBlock, 'prototype should include a cryoshard block');
  assert.equal(
    cryoshardBlock.collisionMode,
    'soft',
    'cryoshard block should use soft collision in the prototype',
  );

  const anchor = { x: 48, y: 12, z: -24 };

  const cryoshardEntry = {
    type: cryoshardBlock.type,
    collisionMode: cryoshardBlock.collisionMode ?? 'none',
    position: {
      x: anchor.x + cryoshardBlock.position.x,
      y: anchor.y + cryoshardBlock.position.y,
      z: anchor.z + cryoshardBlock.position.z,
    },
  };

  const terrainEntry = {
    type: 'stone',
    collisionMode: 'solid',
    position: {
      x: Math.round(cryoshardEntry.position.x) + 1,
      y: Math.round(cryoshardEntry.position.y),
      z: Math.round(cryoshardEntry.position.z),
    },
  };

  const occluderEntries = [
    { x: terrainEntry.position.x + 1, y: terrainEntry.position.y, z: terrainEntry.position.z },
    { x: terrainEntry.position.x, y: terrainEntry.position.y + 1, z: terrainEntry.position.z },
    { x: terrainEntry.position.x, y: terrainEntry.position.y - 1, z: terrainEntry.position.z },
    { x: terrainEntry.position.x, y: terrainEntry.position.y, z: terrainEntry.position.z + 1 },
    { x: terrainEntry.position.x, y: terrainEntry.position.y, z: terrainEntry.position.z - 1 },
  ].map((position, index) => ({
    type: 'stone',
    collisionMode: 'solid',
    position,
    skipVisibilityCheck: true,
    key: `occluder-${index}`,
  }));

  const allEntries = [cryoshardEntry, terrainEntry, ...occluderEntries];

  const roundedPositions = allEntries.map((entry) => ({
    x: Math.round(entry.position.x),
    y: Math.round(entry.position.y),
    z: Math.round(entry.position.z),
  }));

  const minX = Math.min(...roundedPositions.map((p) => p.x));
  const maxX = Math.max(...roundedPositions.map((p) => p.x));
  const minY = Math.min(...roundedPositions.map((p) => p.y));
  const maxY = Math.max(...roundedPositions.map((p) => p.y));
  const minZ = Math.min(...roundedPositions.map((p) => p.z));
  const maxZ = Math.max(...roundedPositions.map((p) => p.z));

  const occupancyWidth = maxX - minX + 1;
  const occupancyDepth = maxZ - minZ + 1;
  const occupancyHeight = maxY - minY + 1;
  const occupancyArea = occupancyWidth * occupancyDepth;

  const occupancyData = new Array(occupancyArea * occupancyHeight).fill(null);

  const toIndex = (lx, ly, lz) => ly * occupancyArea + lz * occupancyWidth + lx;

  allEntries.forEach((entry) => {
    const rounded = {
      x: Math.round(entry.position.x),
      y: Math.round(entry.position.y),
      z: Math.round(entry.position.z),
    };

    entry.gridPosition = {
      x: rounded.x - minX,
      y: rounded.y - minY,
      z: rounded.z - minZ,
    };

    const index = toIndex(entry.gridPosition.x, entry.gridPosition.y, entry.gridPosition.z);
    occupancyData[index] = entry;
  });

  const blockMaterials = {
    stone: {
      transparent: false,
      opacity: 1,
      depthWrite: true,
    },
    cryoshard_glass: {
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    },
  };

  const instancedData = new Map();

  [cryoshardEntry, terrainEntry].forEach((entry) => {
    const local = entry.gridPosition;
    let exposed = false;

    for (let i = 0; i < neighborOffsets3D.length; i += 1) {
      const offset = neighborOffsets3D[i];
      const nx = local.x + offset.dx;
      const ny = local.y + offset.dy;
      const nz = local.z + offset.dz;

      if (
        nx < 0 ||
        nx >= occupancyWidth ||
        nz < 0 ||
        nz >= occupancyDepth ||
        ny < 0 ||
        ny >= occupancyHeight
      ) {
        exposed = true;
        break;
      }

      const neighborIndex = toIndex(nx, ny, nz);
      const neighborEntry = occupancyData[neighborIndex];
      if (!neighborEntry) {
        exposed = true;
        break;
      }
      if (neighborEntry === entry || neighborEntry.skipVisibilityCheck) {
        continue;
      }
      if (!isBlockOccluding(neighborEntry, blockMaterials)) {
        exposed = true;
        break;
      }
    }

    if (exposed) {
      if (!instancedData.has(entry.type)) {
        instancedData.set(entry.type, []);
      }
      instancedData.get(entry.type).push(entry);
    }
    entry.isVisible = exposed;
  });

  const cryoshardInstances = instancedData.get('cryoshard_glass') ?? [];
  const terrainInstances = instancedData.get('stone') ?? [];

  assert.equal(cryoshardInstances.length, 1, 'cryoshard block should remain instanced');
  assert.equal(terrainInstances.length, 1, 'adjacent terrain block should remain instanced');
  assert.equal(
    terrainEntry.isVisible,
    true,
    'adjacent terrain block should be treated as visible when next to soft collision cryoshard',
  );
});

