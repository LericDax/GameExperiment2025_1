import { Matrix4, Vector3 } from 'three';

const SCRATCH_MATRIX = new Matrix4();
const SCRATCH_POSITION = new Vector3();

const DEFAULT_FLOWER_RADIUS = 36;
const DEFAULT_FLOWER_LIMIT = 24;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveVector(input, fallback = null) {
  if (!input) {
    return fallback;
  }
  if (input.isVector3) {
    return { x: toNumber(input.x), y: toNumber(input.y), z: toNumber(input.z) };
  }
  if (Array.isArray(input)) {
    const [x = 0, y = 0, z = 0] = input;
    return { x: toNumber(x), y: toNumber(y), z: toNumber(z) };
  }
  if (typeof input === 'object') {
    if ('x' in input || 'y' in input || 'z' in input) {
      return {
        x: toNumber(input.x),
        y: toNumber(input.y),
        z: toNumber(input.z),
      };
    }
    if (input.position) {
      return resolveVector(input.position, fallback);
    }
  }
  return fallback;
}

function distanceSquared(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = toNumber(a.x) - toNumber(b.x);
  const dy = toNumber(a.y) - toNumber(b.y);
  const dz = toNumber(a.z) - toNumber(b.z);
  return dx * dx + dy * dy + dz * dz;
}

function normalizeCollection(collection) {
  if (!collection) {
    return [];
  }
  if (collection instanceof Set) {
    return Array.from(collection.values());
  }
  if (Array.isArray(collection)) {
    return collection.slice();
  }
  if (collection instanceof Map) {
    return Array.from(collection.values());
  }
  if (typeof collection === 'object') {
    return Object.values(collection);
  }
  return [];
}

function normalizeInstanceIndices(group, fallbackCount = 0) {
  if (Array.isArray(group?.instanceIndices) && group.instanceIndices.length > 0) {
    return group.instanceIndices.filter((index) => Number.isInteger(index) && index >= 0);
  }
  const count = Number.isInteger(fallbackCount) && fallbackCount > 0 ? fallbackCount : 0;
  return Array.from({ length: count }, (_, index) => index);
}

function readEntryFromCollection(group, entry, index) {
  if (!entry) {
    return null;
  }
  const position = resolveVector(entry.position, null);
  if (!position) {
    return null;
  }
  const type = entry.type ?? group?.type ?? 'decoration';
  const id = entry.id ?? entry.key ?? `${group?.key ?? type}:${index}`;
  return { position, type, id };
}

function readEntryFromMesh(group, mesh, index) {
  if (!mesh?.isInstancedMesh || typeof mesh.getMatrixAt !== 'function') {
    return null;
  }
  const count = Number.isInteger(mesh.count) ? mesh.count : 0;
  if (index < 0 || index >= count) {
    return null;
  }

  mesh.getMatrixAt(index, SCRATCH_MATRIX);
  SCRATCH_POSITION.setFromMatrixPosition(SCRATCH_MATRIX);
  if (mesh.matrixWorld?.isMatrix4) {
    SCRATCH_POSITION.applyMatrix4(mesh.matrixWorld);
  } else if (mesh.parent?.matrixWorld?.isMatrix4) {
    SCRATCH_POSITION.applyMatrix4(mesh.parent.matrixWorld);
  }

  return {
    position: {
      x: SCRATCH_POSITION.x,
      y: SCRATCH_POSITION.y,
      z: SCRATCH_POSITION.z,
    },
    type: group?.type ?? mesh.userData?.type ?? 'decoration',
    id: `${group?.key ?? mesh.uuid}:${index}`,
  };
}

function collectGroupEntries(group) {
  if (!group) {
    return [];
  }
  const directEntries = Array.isArray(group.entries)
    ? group.entries
    : Array.isArray(group.instances)
      ? group.instances
      : null;

  if (directEntries) {
    const results = [];
    const indices = normalizeInstanceIndices(group, directEntries.length);
    indices.forEach((index) => {
      const entry = directEntries[index];
      const normalized = readEntryFromCollection(group, entry, index);
      if (normalized) {
        results.push(normalized);
      }
    });
    if (results.length > 0) {
      return results;
    }
  }

  const mesh = group.mesh ?? null;
  if (!mesh) {
    return [];
  }
  if (typeof mesh.count !== 'number' || mesh.count <= 0) {
    return [];
  }

  const indices = normalizeInstanceIndices(group, mesh.count);
  const results = [];
  indices.forEach((index) => {
    const entry = readEntryFromMesh(group, mesh, index);
    if (entry) {
      results.push(entry);
    }
  });
  return results;
}

function collectDecorationGroups(chunkManager, type) {
  if (!chunkManager) {
    return [];
  }
  const groups = new Set();
  const typeIndex = chunkManager.decorationTypeIndex ?? null;
  if (typeIndex instanceof Map) {
    const bucket = typeIndex.get(type);
    normalizeCollection(bucket).forEach((group) => groups.add(group));
  } else if (Array.isArray(typeIndex)) {
    typeIndex
      .filter((entry) => entry?.type === type)
      .forEach((entry) => groups.add(entry));
  } else if (typeof typeIndex === 'object' && typeIndex !== null) {
    const bucket = typeIndex[type];
    normalizeCollection(bucket).forEach((group) => groups.add(group));
  }

  if (groups.size === 0 && chunkManager.decorationGroups) {
    normalizeCollection(chunkManager.decorationGroups)
      .filter((group) => group?.type === type)
      .forEach((group) => groups.add(group));
  }

  return Array.from(groups.values());
}

export function collectNearbyFlowerPOIs({
  chunkManager,
  origin = null,
  radius = DEFAULT_FLOWER_RADIUS,
  maxResults = DEFAULT_FLOWER_LIMIT,
} = {}) {
  if (!chunkManager) {
    return [];
  }

  const groups = collectDecorationGroups(chunkManager, 'flowers');
  if (groups.length === 0) {
    return [];
  }

  const originVector = resolveVector(origin, null);
  const radiusSq = Number.isFinite(radius) && radius > 0 ? radius * radius : null;

  const candidates = [];
  groups.forEach((group) => {
    const entries = collectGroupEntries(group);
    entries.forEach((entry) => {
      if (!entry?.position) {
        return;
      }
      const distanceSq = originVector ? distanceSquared(entry.position, originVector) : 0;
      if (radiusSq !== null && distanceSq > radiusSq) {
        return;
      }
      candidates.push({ ...entry, distanceSq });
    });
  });

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => a.distanceSq - b.distanceSq);
  const limit = Number.isFinite(maxResults) && maxResults > 0 ? maxResults : candidates.length;
  return candidates.slice(0, limit).map(({ distanceSq: _distanceSq, ...entry }) => entry);
}

export function buildEnvironmentSnapshot({
  chunkManager,
  origin = null,
  radius = DEFAULT_FLOWER_RADIUS,
  maxResults = DEFAULT_FLOWER_LIMIT,
} = {}) {
  const pointsOfInterest = collectNearbyFlowerPOIs({
    chunkManager,
    origin,
    radius,
    maxResults,
  });
  return {
    pointsOfInterest,
    resourceNodes: [],
  };
}
