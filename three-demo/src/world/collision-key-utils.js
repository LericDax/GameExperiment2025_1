import { isBlockOccluding } from './block-occlusion.js';

const isCoordinateKey = (key) => {
  if (typeof key !== 'string') {
    return false;
  }
  const parts = key.split('|');
  if (parts.length !== 3) {
    return false;
  }
  return parts.every((part) => part.trim().length > 0 && !Number.isNaN(Number(part)));
};

const resolveCoordinateKey = (entry, hint) => {
  if (typeof hint === 'string' && hint) {
    return hint;
  }
  if (entry?.coordinateKey) {
    return String(entry.coordinateKey);
  }
  if (entry?.payload?.coordinateKey) {
    return String(entry.payload.coordinateKey);
  }
  if (entry?.key && isCoordinateKey(String(entry.key))) {
    return String(entry.key);
  }
  return null;
};

const resolveCollisionMode = (entry) => entry?.collisionMode ?? entry?.payload?.collisionMode ?? null;

const shouldAddToSolid = (entry, collisionMode) => {
  if (!entry) {
    return false;
  }
  if (entry.isSolid === true) {
    return true;
  }
  return collisionMode === 'solid';
};

const shouldAddToSoft = (entry, collisionMode) => {
  if (!entry) {
    return false;
  }
  if (entry.isSoft === true) {
    return true;
  }
  return collisionMode === 'soft';
};

const parseCoordinateKey = (key) => {
  if (!isCoordinateKey(key)) {
    return null;
  }
  const [x, y, z] = key.split('|').map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
};

const makeCoordinateKey = (x, y, z) => `${x}|${y}|${z}`;

const neighborOffsets = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

const isEntryFullyOccluded = (entry, coordinates, blockLookup, blockMaterials) => {
  if (!coordinates) {
    return false;
  }
  return neighborOffsets.every((offset) => {
    const neighborKey = makeCoordinateKey(
      coordinates.x + offset.dx,
      coordinates.y + offset.dy,
      coordinates.z + offset.dz,
    );
    const neighborEntry = blockLookup?.get(neighborKey);
    if (!neighborEntry) {
      return false;
    }
    return isBlockOccluding(neighborEntry, blockMaterials);
  });
};

export const deriveCollisionKeySetsFromMesh = ({
  typeData,
  blockLookup,
  blockMaterials,
} = {}) => {
  const solidBlockKeys = new Set();
  const softBlockKeys = new Set();
  const processedCoordinates = new Set();
  const occludedCoordinates = new Set();
  const occludedEntries = new Set();

  const addEntry = (entry, hint) => {
    const coordinateKey = resolveCoordinateKey(entry, hint);
    if (!coordinateKey) {
      return;
    }
    if (entry && entry.isVisible === false) {
      occludedCoordinates.add(coordinateKey);
      occludedEntries.add(entry);
      return;
    }
    const coordinates = parseCoordinateKey(coordinateKey);
    if (isEntryFullyOccluded(entry, coordinates, blockLookup, blockMaterials)) {
      occludedCoordinates.add(coordinateKey);
      if (entry) {
        occludedEntries.add(entry);
      }
      return;
    }
    if (processedCoordinates.has(coordinateKey)) {
      return;
    }
    processedCoordinates.add(coordinateKey);
    if (entry && typeof entry === 'object' && typeof entry.isVisible !== 'boolean') {
      entry.isVisible = true;
    }
    const collisionMode = resolveCollisionMode(entry);
    if (shouldAddToSolid(entry, collisionMode)) {
      solidBlockKeys.add(coordinateKey);
    }
    if (shouldAddToSoft(entry, collisionMode)) {
      softBlockKeys.add(coordinateKey);
    }
  };

  if (blockLookup?.forEach) {
    blockLookup.forEach((entry, key) => {
      if (!isCoordinateKey(key)) {
        return;
      }
      addEntry(entry, key);
    });
  }

  if (typeData?.forEach) {
    typeData.forEach((record) => {
      const entries = Array.isArray(record?.entries) ? record.entries : [];
      entries.forEach((entry) => addEntry(entry));
    });
  }

  return { solidBlockKeys, softBlockKeys, occludedCoordinates, occludedEntries };
};
