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

const makeCoordinateKey = (position) =>
  `${Math.round(position.x)}|${Math.round(position.y)}|${Math.round(position.z)}`;

test('cryoshard glass remains visible and does not occlude neighbors', () => {
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

    const coordinateKey = makeCoordinateKey(position);

    return {
      type,
      position,
      gridPosition,
      collisionMode: 'solid',
      isSolid: true,
      index: -1,
      mesh: null,
      tintAttribute: null,
      coordinateKey,
      key: coordinateKey,
    };
  };

  const glassEntry = createEntry('cryoshard_glass', { x: 0, y: 0, z: 0 });
  const stoneEntry = createEntry('stone', { x: 0, y: 0, z: 1 });

  occupancyData[toIndex(0, 0, 0)] = glassEntry;
  occupancyData[toIndex(0, 0, 1)] = stoneEntry;

  const instancedData = new Map();
  const entries = [glassEntry, stoneEntry];

  entries.forEach((entry) => {
    entry.isOccluding = isBlockOccluding(entry, blockMaterials);
  });

  const populateInstancing = () => {
    instancedData.clear();
    entries.forEach((entry) => {
      entry.index = -1;
      entry.mesh = null;
      entry.tintAttribute = null;
      entry.isVisible = false;
    });

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
        const neighborOccluding =
          typeof neighborEntry.isOccluding === 'boolean'
            ? neighborEntry.isOccluding
            : isBlockOccluding(neighborEntry, blockMaterials);
        if (!neighborOccluding) {
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

    instancedData.forEach((typeEntries) => {
      typeEntries.forEach((entry, index) => {
        entry.index = index;
      });
    });
  };

  populateInstancing();

  const glassInstances = instancedData.get('cryoshard_glass') ?? [];
  const stoneInstances = instancedData.get('stone') ?? [];

  assert.equal(glassInstances.length, 1, 'glass block should remain instanced');
  assert.equal(stoneInstances.length, 1, 'stone block should remain instanced');
  assert.equal(glassEntry.isVisible, true, 'glass block should be considered visible');
  assert.equal(stoneEntry.isVisible, true, 'stone block should remain visible');

  populateInstancing();

  const makeKey = (x, y, z) => `${x}|${y}|${z}`;
  const chunk = {
    blockLookup: new Map(),
    fluidBlockKeys: new Set(),
  };

  entries.forEach((entry) => {
    chunk.blockLookup.set(
      makeKey(
        Math.round(entry.position.x),
        Math.round(entry.position.y),
        Math.round(entry.position.z),
      ),
      entry,
    );
  });

  const computeVisibility = (chunkRef, entry) => {
    if (!chunkRef || !entry) {
      return false;
    }
    const baseX = Math.round(entry.position.x);
    const baseY = Math.round(entry.position.y);
    const baseZ = Math.round(entry.position.z);
    for (let i = 0; i < neighborOffsets3D.length; i += 1) {
      const offset = neighborOffsets3D[i];
      const neighborKey = makeKey(
        baseX + offset.dx,
        baseY + offset.dy,
        baseZ + offset.dz,
      );
      const neighborEntry = chunkRef.blockLookup.get(neighborKey);
      if (neighborEntry && neighborEntry !== entry) {
        const neighborOccluding =
          typeof neighborEntry.isOccluding === 'boolean'
            ? neighborEntry.isOccluding
            : isBlockOccluding(neighborEntry, blockMaterials);
        if (neighborOccluding) {
          continue;
        }
      }
      if (chunkRef.fluidBlockKeys.has(neighborKey)) {
        return true;
      }
      if (
        !neighborEntry ||
        !(typeof neighborEntry.isOccluding === 'boolean'
          ? neighborEntry.isOccluding
          : isBlockOccluding(neighborEntry, blockMaterials))
      ) {
        return true;
      }
    }
    return false;
  };

  const refreshPositions = entries.map((entry) => ({
    x: Math.round(entry.position.x),
    y: Math.round(entry.position.y),
    z: Math.round(entry.position.z),
  }));

  refreshPositions.forEach((pos) => {
    const entry = chunk.blockLookup.get(makeKey(pos.x, pos.y, pos.z));
    const shouldBeVisible = computeVisibility(chunk, entry);
    assert.equal(
      shouldBeVisible,
      true,
      `${entry.type} block should remain visible after visibility refresh`,
    );
    entry.isVisible = shouldBeVisible;
  });
});
