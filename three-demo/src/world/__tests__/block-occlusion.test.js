import test from 'node:test';
import assert from 'node:assert/strict';

import { isBlockOccluding } from '../block-occlusion.js';

const neighborOffsets3D = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

test('cryoshard glass remains visible and does not occlude neighbors', () => {
  const blockMaterials = {
    stone: {
      transparent: false,
      opacity: 1,
      depthWrite: true,
    },
  };

  assert.equal(
    isBlockOccluding(
      { type: 'cryoshard_glass', collisionMode: 'solid' },
      {
        cryoshard_glass: {
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        },
      },
    ),
    false,
    'cryoshard glass should not occlude when its material is translucent',
  );

  const minX = 0;
  const minZ = 0;
  const occupancyMinY = 0;
  const occupancyWidth = 1;
  const occupancyDepth = 2;
  const occupancyHeight = 1;
  const occupancyArea = occupancyWidth * occupancyDepth;
  const occupancyData = new Array(occupancyArea * occupancyHeight).fill(null);
  const fluidOccupancy = new Uint8Array(occupancyArea * occupancyHeight);

  const toIndex = (lx, ly, lz) => ly * occupancyArea + lz * occupancyWidth + lx;

  const createEntry = (type, position) => {
    const gridPosition = {
      x: Math.round(position.x - minX),
      y: Math.round(position.y) - occupancyMinY,
      z: Math.round(position.z - minZ),
    };

    return {
      type,
      position,
      gridPosition,
      collisionMode: 'solid',
      index: -1,
      mesh: null,
      tintAttribute: null,
    };
  };

  const glassEntry = createEntry('cryoshard_glass', { x: 0, y: 0, z: 0 });
  const stoneEntry = createEntry('stone', { x: 0, y: 0, z: 1 });

  occupancyData[toIndex(0, 0, 0)] = glassEntry;
  occupancyData[toIndex(0, 0, 1)] = stoneEntry;

  const instancedData = new Map();
  const entries = [glassEntry, stoneEntry];

  entries.forEach((entry) => {
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
        if (fluidOccupancy[neighborIndex] === 1) {
          exposed = true;
          break;
        }
        exposed = true;
        break;
      }
      if (neighborEntry === entry) {
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

  const glassInstances = instancedData.get('cryoshard_glass') ?? [];
  const stoneInstances = instancedData.get('stone') ?? [];

  assert.equal(glassInstances.length, 1, 'glass block should remain instanced');
  assert.equal(stoneInstances.length, 1, 'stone block should remain instanced');
  assert.equal(glassEntry.isVisible, true, 'glass block should be considered visible');
  assert.equal(stoneEntry.isVisible, true, 'stone block should remain visible');
});
