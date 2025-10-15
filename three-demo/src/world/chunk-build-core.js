import { serializeInstancedEntry } from './chunk-payload-serializers.js';

const DEFAULT_CHUNK_SIZE = 16;

const isTypedArray = (value) =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

const toPlainNumericArray = (value, length = null) => {
  if (value == null) {
    if (typeof length === 'number' && length > 0) {
      return new Array(length).fill(0);
    }
    return [];
  }
  if (Array.isArray(value)) {
    const normalized = value.map((entry) =>
      Number.isFinite(entry) ? entry : 0,
    );
    if (typeof length === 'number' && length > 0) {
      if (normalized.length > length) {
        return normalized.slice(0, length);
      }
      while (normalized.length < length) {
        normalized.push(0);
      }
    }
    return normalized;
  }
  if (isTypedArray(value)) {
    const normalized = Array.from(value);
    if (typeof length === 'number' && length > 0) {
      if (normalized.length > length) {
        return normalized.slice(0, length);
      }
      while (normalized.length < length) {
        normalized.push(0);
      }
    }
    return normalized;
  }
  if (typeof value === 'object') {
    if (typeof value.toArray === 'function') {
      const target = [];
      value.toArray(target, 0);
      if (typeof length === 'number' && length > 0) {
        if (target.length > length) {
          return target.slice(0, length);
        }
        while (target.length < length) {
          target.push(0);
        }
      }
      return target;
    }
    const vectorKeys = ['x', 'y', 'z'];
    const colorKeys = ['r', 'g', 'b'];
    if (vectorKeys.every((key) => typeof value[key] === 'number')) {
      return vectorKeys.map((key) => (Number.isFinite(value[key]) ? value[key] : 0));
    }
    if (colorKeys.every((key) => typeof value[key] === 'number')) {
      return colorKeys.map((key) => (Number.isFinite(value[key]) ? value[key] : 0));
    }
  }
  if (typeof length === 'number' && length > 0) {
    return new Array(length).fill(0);
  }
  return [];
};

const toPlainColorArray = (value) => {
  if (!value) {
    return null;
  }
  const array = toPlainNumericArray(value, 3);
  return array.length === 0 ? null : array;
};

const normalizeSerializable = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (isTypedArray(value)) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSerializable(entry));
  }
  if (typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, entry]) => {
      const normalized = normalizeSerializable(entry);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    });
    return result;
  }
  return undefined;
};

const extractBiomePayload = (engine) => {
  if (!engine) {
    return [];
  }
  const presenceSource = engine.biomePresence;
  const entries =
    presenceSource instanceof Map
      ? Array.from(presenceSource.values())
      : Array.isArray(presenceSource)
      ? presenceSource
      : presenceSource && typeof presenceSource === 'object'
      ? Object.values(presenceSource)
      : [];

  const collected = [];
  let totalSamples = 0;

  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const samples = Number.isFinite(entry.samples) ? entry.samples : 0;
    const biome = entry.biome ?? entry.biomeData ?? null;
    collected.push({ biome, samples });
    totalSamples += samples;
  });

  if (collected.length === 0 && Array.isArray(engine.biomes)) {
    engine.biomes.forEach((biome) => {
      if (!biome) {
        return;
      }
      const samples = Number.isFinite(biome.samples) ? biome.samples : 0;
      totalSamples += samples;
      collected.push({
        biome: {
          id: biome.id,
          label: biome.label,
          shader: biome.shader,
        },
        samples,
      });
    });
  }

  if (collected.length === 0) {
    return [];
  }

  return collected.map(({ biome, samples }) => {
    const shader = biome?.shader ?? {};
    return {
      id: biome?.id ?? null,
      label: biome?.label ?? null,
      samples,
      weight: totalSamples > 0 ? samples / totalSamples : 0,
      shader: {
        fogColor: toPlainColorArray(shader.fogColor),
        tintColor: toPlainColorArray(shader.tintColor),
        tintStrength: Number.isFinite(shader.tintStrength)
          ? shader.tintStrength
          : 1,
      },
    };
  });
};

const toCapacityMap = (source) => {
  if (!source) {
    return null;
  }
  if (source instanceof Map) {
    return source;
  }
  if (typeof source === 'object') {
    return new Map(Object.entries(source));
  }
  return null;
};

const extractTypeMetadata = (engine) => {
  if (!engine) {
    return [];
  }
  const source = engine.typeData;
  if (!source) {
    return [];
  }
  const capacityMap = toCapacityMap(engine.typeCapacities);
  const iterate =
    source instanceof Map
      ? Array.from(source.entries())
      : typeof source === 'object'
      ? Object.entries(source)
      : [];
  if (iterate.length === 0) {
    return [];
  }
  return iterate.map(([type, record]) => {
    const entries = Array.isArray(record?.entries) ? record.entries : [];
    const entryKeys = entries
      .map((entry) => (entry?.key ? String(entry.key) : null))
      .filter(Boolean);
    const entryPayloads = entries.map((entry) =>
      normalizeSerializable(entry?.payload ?? serializeInstancedEntry(entry)),
    );
    const capacityCandidate = Number.isFinite(record?.capacity)
      ? record.capacity
      : capacityMap?.get(type);
    return {
      type,
      capacity:
        Number.isFinite(capacityCandidate) && capacityCandidate >= 0
          ? capacityCandidate
          : entries.length,
      entryCount: entries.length,
      entryKeys,
      entryPayloads,
    };
  });
};

const extractPrototypeInstances = (engine) => {
  if (!engine) {
    return [];
  }
  const source = engine.prototypeInstances;
  if (!source) {
    return [];
  }
  const iterate =
    source instanceof Map
      ? Array.from(source.entries())
      : typeof source === 'object'
      ? Object.entries(source)
      : [];
  if (iterate.length === 0) {
    return [];
  }
  return iterate.map(([key, record]) => {
    const blockEntries = Array.isArray(record?.blockEntries)
      ? record.blockEntries
      : [];
    const decorationKeys = Array.isArray(record?.decorationKeys)
      ? record.decorationKeys.filter((value) => value !== null && value !== undefined)
      : [];
    return {
      key,
      prototypeId: record?.prototypeId ?? null,
      blockEntries: blockEntries
        .map((entryRecord) => {
          if (!entryRecord) {
            return null;
          }
          const entry = entryRecord.entry ?? null;
          const payload = entryRecord.entryPayload ??
            (entry ? serializeInstancedEntry(entry) : null);
          return {
            type: entryRecord.type ?? entry?.type ?? null,
            entryKey: entry?.key ?? entryRecord.entryKey ?? null,
            entryPayload: normalizeSerializable(payload),
          };
        })
        .filter(Boolean),
      decorationKeys,
    };
  });
};

const makeCoordinateKey = (x, y, z) =>
  `${Math.round(x)}|${Math.round(y)}|${Math.round(z)}`;

const parseCoordinateKey = (key) => {
  if (typeof key !== 'string') {
    return null;
  }
  const parts = key.split('|');
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
};

const resolveChunkSize = (options) => {
  if (!options || typeof options !== 'object') {
    return DEFAULT_CHUNK_SIZE;
  }
  const numeric = Number(options.chunkSize);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_CHUNK_SIZE;
};

const resolveWaterLevel = (options) => {
  if (!options || typeof options !== 'object') {
    return 0;
  }
  const numeric = Number(options.waterLevel);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric);
  }
  const terrainLevel = Number(options.terrain?.waterLevel);
  if (Number.isFinite(terrainLevel)) {
    return Math.floor(terrainLevel);
  }
  return 0;
};

export const chunkWorldBounds = (chunkX, chunkZ, options = {}) => {
  const chunkSize = resolveChunkSize(options);
  const halfSize = chunkSize / 2;
  return {
    minX: chunkX * chunkSize - halfSize,
    minZ: chunkZ * chunkSize - halfSize,
  };
};

const normalizeArraySource = (source) => {
  if (!source) {
    return [];
  }
  if (Array.isArray(source)) {
    return source.slice();
  }
  if (source instanceof Set) {
    return Array.from(source);
  }
  if (source instanceof Map) {
    return Array.from(source.entries());
  }
  if (typeof source === 'object') {
    return Object.entries(source);
  }
  return [];
};

const resolvePlacementPosition = (placement) => {
  if (!placement) {
    return null;
  }
  const position = placement.position ?? null;
  if (position && typeof position.x === 'number') {
    return {
      x: position.x,
      y: position.y,
      z: position.z,
    };
  }
  const payloadPosition = placement.payload?.position;
  if (Array.isArray(payloadPosition) || ArrayBuffer.isView(payloadPosition)) {
    const [px = 0, py = 0, pz = 0] = payloadPosition;
    return { x: px, y: py, z: pz };
  }
  if (payloadPosition && typeof payloadPosition === 'object') {
    return {
      x: Number.isFinite(payloadPosition.x) ? payloadPosition.x : 0,
      y: Number.isFinite(payloadPosition.y) ? payloadPosition.y : 0,
      z: Number.isFinite(payloadPosition.z) ? payloadPosition.z : 0,
    };
  }
  return null;
};

const serializeGridPosition = (position) => {
  if (!position || typeof position !== 'object') {
    return null;
  }
  const { x, y, z } = position;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  return { x, y, z };
};

const normalizeCoordinateKey = (placement, position) => {
  if (!placement) {
    return null;
  }
  if (typeof placement.coordinateKey === 'string') {
    return placement.coordinateKey;
  }
  if (typeof placement.key === 'string') {
    return placement.key;
  }
  if (position) {
    return makeCoordinateKey(position.x, position.y, position.z);
  }
  return null;
};

export const buildChunkPayload = ({
  chunkX,
  chunkZ,
  engine,
  worldOptions,
}) => {
  if (!engine || typeof engine !== 'object') {
    throw new Error('buildChunkPayload requires an engine payload.');
  }

  const chunkSize = resolveChunkSize(worldOptions);
  const waterLevel = resolveWaterLevel(worldOptions);
  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ, worldOptions);

  const placements = Array.isArray(engine.blockPlacements)
    ? engine.blockPlacements
    : [];

  let occupancyMinY = Number.POSITIVE_INFINITY;
  let occupancyMaxY = Number.NEGATIVE_INFINITY;

  placements.forEach((placement) => {
    if (!placement || placement.removed) {
      return;
    }
    const position = resolvePlacementPosition(placement);
    if (!position) {
      return;
    }
    const roundedY = Math.round(position.y);
    occupancyMinY = Math.min(occupancyMinY, roundedY);
    occupancyMaxY = Math.max(occupancyMaxY, roundedY);
  });

  if (occupancyMinY === Number.POSITIVE_INFINITY) {
    occupancyMinY = Math.floor(waterLevel);
    occupancyMaxY = occupancyMinY;
  }
  if (occupancyMaxY === Number.NEGATIVE_INFINITY) {
    occupancyMaxY = occupancyMinY;
  }

  const occupancyWidth = chunkSize;
  const occupancyDepth = chunkSize;
  const occupancyHeight = Math.max(1, occupancyMaxY - occupancyMinY + 1);
  const occupancyArea = occupancyWidth * occupancyDepth;
  const volume = occupancyArea * occupancyHeight;

  const occupancyTypes = new Uint16Array(volume);
  const occupancyPlacements = new Int32Array(volume);
  occupancyPlacements.fill(-1);
  const fluidOccupancy = new Uint8Array(volume);

  const typeIdMap = new Map();
  let nextTypeId = 1;
  const getTypeId = (type) => {
    if (!type) {
      return 0;
    }
    if (!typeIdMap.has(type)) {
      typeIdMap.set(type, nextTypeId++);
    }
    return typeIdMap.get(type);
  };

  const solidCoordinates = [];
  const softCoordinates = [];
  const placementIndexByCoordinate = {};
  const blockPlacements = [];

  const normalizedFluidKeys = normalizeArraySource(engine.fluidBlockKeys);

  normalizedFluidKeys.forEach((entry) => {
    let key = null;
    if (Array.isArray(entry)) {
      [key] = entry;
    } else if (typeof entry === 'string') {
      key = entry;
    } else if (entry && typeof entry === 'object' && entry.key) {
      key = entry.key;
    }
    if (!key) {
      return;
    }
    const coords = parseCoordinateKey(key);
    if (!coords) {
      return;
    }
    const lx = Math.round(coords.x - minX);
    const lz = Math.round(coords.z - minZ);
    const ly = Math.round(coords.y) - occupancyMinY;
    if (
      lx < 0 ||
      lx >= occupancyWidth ||
      lz < 0 ||
      lz >= occupancyDepth ||
      ly < 0 ||
      ly >= occupancyHeight
    ) {
      return;
    }
    const index = ly * occupancyArea + lz * occupancyWidth + lx;
    fluidOccupancy[index] = 1;
  });

  placements.forEach((placement, index) => {
    if (!placement || placement.removed) {
      return;
    }

    const position = resolvePlacementPosition(placement);
    const coordinateKey = normalizeCoordinateKey(placement, position);
    if (coordinateKey) {
      placementIndexByCoordinate[coordinateKey] = index;
    }

    const isSolid =
      placement.isSolid === true || placement.collisionMode === 'solid';
    const isSoft =
      placement.isSoft === true || placement.collisionMode === 'soft';

    if (isSolid && coordinateKey) {
      solidCoordinates.push(coordinateKey);
    }
    if (isSoft && coordinateKey) {
      softCoordinates.push(coordinateKey);
    }

    const payload = placement.payload ?? serializeInstancedEntry(placement);

    const gridPosition = serializeGridPosition(placement.gridPosition);
    const gridIndex = Number.isInteger(placement.gridIndex)
      ? placement.gridIndex
      : -1;

    blockPlacements.push({
      index,
      key: placement.key ?? null,
      coordinateKey: coordinateKey ?? null,
      type: placement.type ?? null,
      collisionMode: placement.collisionMode ?? null,
      isSolid,
      isSoft,
      isVisible: placement.isVisible === true,
      gridIndex,
      gridPosition,
      payload,
    });

    if (!position) {
      return;
    }

    const localX = Math.round(position.x - minX);
    const localZ = Math.round(position.z - minZ);
    const localY = Math.round(position.y) - occupancyMinY;

    if (
      localX < 0 ||
      localX >= occupancyWidth ||
      localZ < 0 ||
      localZ >= occupancyDepth ||
      localY < 0 ||
      localY >= occupancyHeight
    ) {
      return;
    }

    const occupancyIndex =
      localY * occupancyArea + localZ * occupancyWidth + localX;
    occupancyTypes[occupancyIndex] = getTypeId(placement.type);
    occupancyPlacements[occupancyIndex] = index;
  });

  const typeEntries = Array.from(typeIdMap.entries());
  const typeIndex = {
    entries: typeEntries.map(([type, id]) => ({ type, id })),
    byType: Object.fromEntries(typeEntries),
  };

  return {
    chunkX,
    chunkZ,
    blockPlacements,
    occupancy: {
      minY: occupancyMinY,
      maxY: occupancyMaxY,
      width: occupancyWidth,
      depth: occupancyDepth,
      height: occupancyHeight,
      types: occupancyTypes,
      placements: occupancyPlacements,
      fluid: fluidOccupancy,
      solidCoordinates,
      softCoordinates,
      coordinateIndex: placementIndexByCoordinate,
    },
    typeIndex,
    biomes: extractBiomePayload(engine),
    typeMetadata: extractTypeMetadata(engine),
    prototypeInstances: extractPrototypeInstances(engine),
  };
};

