import generateNodeGrowthVoxels from './procedural/node-growth-generator.js';
import { invalidateDecorationMeshCache } from './voxel-object-decoration-mesh.js';

const resolvedVoxelCache = new WeakMap();

function cloneVoxel(voxel) {
  return {
    ...voxel,
    position: voxel.position ? { ...voxel.position } : { x: 0, y: 0, z: 0 },
    size: voxel.size ? { ...voxel.size } : { x: 1, y: 1, z: 1 },
    metadata: voxel.metadata ? { ...voxel.metadata } : null,
  };
}

function computeBoundingBox(voxels, voxelScale) {
  if (!voxels || voxels.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  voxels.forEach((voxel) => {
    const { position, size } = voxel;
    const sizeX = size?.x ?? 1;
    const sizeY = size?.y ?? 1;
    const sizeZ = size?.z ?? 1;
    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;

    const minLocalX = (position.x - halfX) * voxelScale;
    const maxLocalX = (position.x + halfX) * voxelScale;
    const minLocalZ = (position.z - halfZ) * voxelScale;
    const maxLocalZ = (position.z + halfZ) * voxelScale;

    const minLocalY = position.y * voxelScale;
    const maxLocalY = (position.y + sizeY) * voxelScale;

    minX = Math.min(minX, minLocalX);
    minY = Math.min(minY, minLocalY);
    minZ = Math.min(minZ, minLocalZ);
    maxX = Math.max(maxX, maxLocalX);
    maxY = Math.max(maxY, maxLocalY);
    maxZ = Math.max(maxZ, maxLocalZ);
  });

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}

export function resolveVoxelObjectVoxels(object) {
  if (!object) {
    return [];
  }
  if (resolvedVoxelCache.has(object)) {
    return resolvedVoxelCache.get(object);
  }

  const baseVoxels = Array.isArray(object.voxels)
    ? object.voxels.map((voxel) => cloneVoxel(voxel))
    : [];

  let proceduralVoxels = [];
  const proceduralConfigCandidate =
    object.raw?.procedural ?? object.procedural ?? object.rawProcedural ?? null;
  const proceduralConfig =
    proceduralConfigCandidate && typeof proceduralConfigCandidate === 'object'
      ? proceduralConfigCandidate
      : null;
  if (proceduralConfig?.nodeGrowth) {
    proceduralVoxels = generateNodeGrowthVoxels(object, proceduralConfig.nodeGrowth);
  }

  const combined = [...baseVoxels, ...proceduralVoxels].map((voxel, index) => ({
    ...voxel,
    index,
  }));

  if (combined.length > 0) {
    object.boundingBox = computeBoundingBox(combined, object.voxelScale);
  }

  resolvedVoxelCache.set(object, combined);
  return combined;
}

export function invalidateResolvedVoxelCache(object) {
  if (!object) {
    return;
  }
  resolvedVoxelCache.delete(object);
  invalidateDecorationMeshCache(object);
}
