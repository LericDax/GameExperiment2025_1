const BITS_PER_AXIS = 12;
const AXIS_CAPACITY = 1 << BITS_PER_AXIS;
const AXIS_MASK = (1n << BigInt(BITS_PER_AXIS)) - 1n;
const BITS_Y = 28;
const Y_CAPACITY = 1 << BITS_Y;
const Y_MASK = (1n << BigInt(BITS_Y)) - 1n;
const Y_OFFSET = 1n << BigInt(BITS_Y - 1);
const SHIFT_Z = BigInt(BITS_PER_AXIS);
const SHIFT_Y = BigInt(BITS_PER_AXIS * 2);

const DEFAULT_CHUNK_SIZE = 16;

const toChunkKey = (chunkX, chunkZ) => `${chunkX}|${chunkZ}`;

const isChunkBlockIndexLike = (value) =>
  value &&
  typeof value === 'object' &&
  typeof value.add === 'function' &&
  typeof value.delete === 'function' &&
  typeof value.has === 'function' &&
  typeof value.hasColumn === 'function';

const normalizeChunkSize = (size) => {
  const numeric = Number(size);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }
  const normalized = Math.max(1, Math.floor(numeric));
  if (normalized >= AXIS_CAPACITY) {
    return AXIS_CAPACITY - 1;
  }
  return normalized;
};

const normalizeCoordinateInput = (input) => {
  if (!input) {
    return null;
  }
  if (typeof input === 'string') {
    const parts = input.split('|');
    if (parts.length !== 3) {
      return null;
    }
    const [sx, sy, sz] = parts;
    const x = Number.parseInt(sx, 10);
    const y = Number.parseInt(sy, 10);
    const z = Number.parseInt(sz, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    return { x, y, z };
  }
  if (typeof input !== 'object') {
    return null;
  }
  const resolveAxis = (value, fallbackKeys = []) => {
    if (Number.isFinite(value)) {
      return Math.round(value);
    }
    for (let i = 0; i < fallbackKeys.length; i += 1) {
      const key = fallbackKeys[i];
      const candidate = input[key];
      if (Number.isFinite(candidate)) {
        return Math.round(candidate);
      }
    }
    return null;
  };
  const x = resolveAxis(input.x, ['columnX', 0]);
  const y = resolveAxis(input.y, ['height', 1]);
  const z = resolveAxis(input.z, ['columnZ', 2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
};

const normalizeColumnInput = (input) => {
  if (!input) {
    return null;
  }
  if (typeof input === 'string') {
    const parts = input.split('|');
    if (parts.length !== 2) {
      return null;
    }
    const [sx, sz] = parts;
    const x = Number.parseInt(sx, 10);
    const z = Number.parseInt(sz, 10);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return null;
    }
    return { x, z };
  }
  if (typeof input !== 'object') {
    return null;
  }
  const resolveAxis = (value, fallbackKeys = []) => {
    if (Number.isFinite(value)) {
      return Math.round(value);
    }
    for (let i = 0; i < fallbackKeys.length; i += 1) {
      const key = fallbackKeys[i];
      const candidate = input[key];
      if (Number.isFinite(candidate)) {
        return Math.round(candidate);
      }
    }
    return null;
  };
  const x = resolveAxis(input.x, ['columnX', 0]);
  const z = resolveAxis(input.z, ['columnZ', 1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  return { x, z };
};

export const isChunkBlockIndex = isChunkBlockIndexLike;

export function createChunkBlockIndex({
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkX = null,
  chunkZ = null,
} = {}) {
  const normalizedChunkSize = normalizeChunkSize(chunkSize);
  const halfChunk = Math.floor(normalizedChunkSize / 2);
  const defaultChunkX = Number.isInteger(chunkX) ? Math.round(chunkX) : null;
  const defaultChunkZ = Number.isInteger(chunkZ) ? Math.round(chunkZ) : null;
  const defaultChunkKey =
    Number.isInteger(defaultChunkX) && Number.isInteger(defaultChunkZ)
      ? toChunkKey(defaultChunkX, defaultChunkZ)
      : null;

  const chunkEntries = new Map();

  const resolveChunkCoordinates = (coords, overrides = {}) => {
    if (
      Number.isInteger(overrides.chunkX) &&
      Number.isInteger(overrides.chunkZ)
    ) {
      return {
        chunkX: Math.round(overrides.chunkX),
        chunkZ: Math.round(overrides.chunkZ),
      };
    }
    if (defaultChunkKey) {
      return { chunkX: defaultChunkX, chunkZ: defaultChunkZ };
    }
    if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.z)) {
      return null;
    }
    const x = Math.round(coords.x);
    const z = Math.round(coords.z);
    const resolvedChunkX = Math.floor((x + halfChunk) / normalizedChunkSize);
    const resolvedChunkZ = Math.floor((z + halfChunk) / normalizedChunkSize);
    return { chunkX: resolvedChunkX, chunkZ: resolvedChunkZ };
  };

  const getEntryKey = (chunkCoords) =>
    toChunkKey(chunkCoords.chunkX, chunkCoords.chunkZ);

  const ensureEntry = (chunkCoords) => {
    const key = getEntryKey(chunkCoords);
    let entry = chunkEntries.get(key);
    if (!entry) {
      const minX = chunkCoords.chunkX * normalizedChunkSize - halfChunk;
      const minZ = chunkCoords.chunkZ * normalizedChunkSize - halfChunk;
      entry = {
        chunkX: chunkCoords.chunkX,
        chunkZ: chunkCoords.chunkZ,
        minX,
        minZ,
        occupancy: new Set(),
        columns: new Map(),
      };
      chunkEntries.set(key, entry);
    }
    return entry;
  };

  const getEntry = (chunkCoords) => {
    if (!chunkCoords) {
      return null;
    }
    return chunkEntries.get(getEntryKey(chunkCoords)) ?? null;
  };

  const encodeEntry = (entry, coords) => {
    const xInt = Math.round(coords.x);
    const yInt = Math.round(coords.y);
    const zInt = Math.round(coords.z);
    if (
      !Number.isFinite(xInt) ||
      !Number.isFinite(yInt) ||
      !Number.isFinite(zInt)
    ) {
      return null;
    }
    const localX = xInt - entry.minX;
    const localZ = zInt - entry.minZ;
    if (
      localX < 0 ||
      localZ < 0 ||
      localX >= normalizedChunkSize ||
      localZ >= normalizedChunkSize ||
      localX >= AXIS_CAPACITY ||
      localZ >= AXIS_CAPACITY
    ) {
      return null;
    }
    const yValue = BigInt(yInt) + Y_OFFSET;
    if (yValue < 0n || yValue > Y_MASK) {
      return null;
    }
    const columnKey =
      (BigInt(localX) & AXIS_MASK) | ((BigInt(localZ) & AXIS_MASK) << SHIFT_Z);
    const packed = columnKey | ((yValue & Y_MASK) << SHIFT_Y);
    return {
      packed,
      columnKey,
      localX,
      localZ,
      y: yInt,
    };
  };

  const decodePacked = (entry, packed) => {
    const localX = Number(packed & AXIS_MASK);
    const localZ = Number((packed >> SHIFT_Z) & AXIS_MASK);
    const yValue = Number((packed >> SHIFT_Y) & Y_MASK) - Number(Y_OFFSET);
    const worldX = entry.minX + localX;
    const worldZ = entry.minZ + localZ;
    return {
      x: worldX,
      y: yValue,
      z: worldZ,
      chunkX: entry.chunkX,
      chunkZ: entry.chunkZ,
    };
  };

  const add = (input, overrides = {}) => {
    const coords = normalizeCoordinateInput(input);
    if (!coords) {
      return false;
    }
    const chunkCoords = resolveChunkCoordinates(coords, overrides);
    if (!chunkCoords) {
      return false;
    }
    const entry = ensureEntry(chunkCoords);
    const encoded = encodeEntry(entry, coords);
    if (!encoded) {
      return false;
    }
    if (entry.occupancy.has(encoded.packed)) {
      return false;
    }
    entry.occupancy.add(encoded.packed);
    const previous = entry.columns.get(encoded.columnKey) ?? 0;
    entry.columns.set(encoded.columnKey, previous + 1);
    return true;
  };

  const deleteEntry = (input, overrides = {}) => {
    const coords = normalizeCoordinateInput(input);
    if (!coords) {
      return false;
    }
    const chunkCoords = resolveChunkCoordinates(coords, overrides);
    if (!chunkCoords) {
      return false;
    }
    const entry = getEntry(chunkCoords);
    if (!entry) {
      return false;
    }
    const encoded = encodeEntry(entry, coords);
    if (!encoded) {
      return false;
    }
    if (!entry.occupancy.delete(encoded.packed)) {
      return false;
    }
    const previous = entry.columns.get(encoded.columnKey) ?? 0;
    if (previous <= 1) {
      entry.columns.delete(encoded.columnKey);
    } else {
      entry.columns.set(encoded.columnKey, previous - 1);
    }
    if (entry.occupancy.size === 0) {
      chunkEntries.delete(getEntryKey(chunkCoords));
    }
    return true;
  };

  const has = (input, overrides = {}) => {
    const coords = normalizeCoordinateInput(input);
    if (!coords) {
      return false;
    }
    const chunkCoords = resolveChunkCoordinates(coords, overrides);
    if (!chunkCoords) {
      return false;
    }
    const entry = getEntry(chunkCoords);
    if (!entry) {
      return false;
    }
    const encoded = encodeEntry(entry, coords);
    if (!encoded) {
      return false;
    }
    return entry.occupancy.has(encoded.packed);
  };

  const hasColumn = (input, overrides = {}) => {
    const column = normalizeColumnInput(input);
    if (!column) {
      return false;
    }
    const chunkCoords = resolveChunkCoordinates(column, overrides);
    if (!chunkCoords) {
      return false;
    }
    const entry = getEntry(chunkCoords);
    if (!entry) {
      return false;
    }
    const localX = Math.round(column.x) - entry.minX;
    const localZ = Math.round(column.z) - entry.minZ;
    if (
      localX < 0 ||
      localZ < 0 ||
      localX >= normalizedChunkSize ||
      localZ >= normalizedChunkSize ||
      localX >= AXIS_CAPACITY ||
      localZ >= AXIS_CAPACITY
    ) {
      return false;
    }
    const columnKey =
      (BigInt(localX) & AXIS_MASK) | ((BigInt(localZ) & AXIS_MASK) << SHIFT_Z);
    return (entry.columns.get(columnKey) ?? 0) > 0;
  };

  const clear = (overrides = {}) => {
    if (
      Number.isInteger(overrides.chunkX) &&
      Number.isInteger(overrides.chunkZ)
    ) {
      const key = toChunkKey(overrides.chunkX, overrides.chunkZ);
      const entry = chunkEntries.get(key);
      if (entry) {
        entry.occupancy.clear();
        entry.columns.clear();
        chunkEntries.delete(key);
      }
      return;
    }
    chunkEntries.clear();
  };

  const values = function* (overrides = {}) {
    if (
      Number.isInteger(overrides.chunkX) &&
      Number.isInteger(overrides.chunkZ)
    ) {
      const entry = getEntry({
        chunkX: Math.round(overrides.chunkX),
        chunkZ: Math.round(overrides.chunkZ),
      });
      if (!entry) {
        return;
      }
      for (const packed of entry.occupancy) {
        yield decodePacked(entry, packed);
      }
      return;
    }
    for (const entry of chunkEntries.values()) {
      for (const packed of entry.occupancy) {
        yield decodePacked(entry, packed);
      }
    }
  };

  const keys = function* (overrides = {}) {
    for (const coords of values(overrides)) {
      yield `${coords.x}|${coords.y}|${coords.z}`;
    }
  };

  const forEach = (callback, overrides = {}) => {
    if (typeof callback !== 'function') {
      return;
    }
    for (const key of keys(overrides)) {
      callback(key, key, api);
    }
  };

  const toJSON = (overrides = {}) => Array.from(keys(overrides));

  const api = {
    add,
    delete: deleteEntry,
    has,
    hasColumn,
    clear,
    forEach,
    values,
    keys,
    toJSON,
    get size() {
      let total = 0;
      chunkEntries.forEach((entry) => {
        total += entry.occupancy.size;
      });
      return total;
    },
  };

  api[Symbol.iterator] = function* iterator() {
    yield* keys();
  };

  return api;
}
