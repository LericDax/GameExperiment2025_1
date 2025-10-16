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

const toMapEntries = (source) => {
  if (!source) {
    return [];
  }
  if (source instanceof Map) {
    return Array.from(source.entries());
  }
  if (Array.isArray(source)) {
    return source;
  }
  if (typeof source === 'object') {
    return Object.entries(source);
  }
  return [];
};

const serializeFluidBlockKeys = (source) => {
  const result = [];
  normalizeArraySource(source).forEach((entry) => {
    if (Array.isArray(entry) && entry[0]) {
      result.push(String(entry[0]));
    } else if (typeof entry === 'string') {
      result.push(entry);
    } else if (entry && typeof entry === 'object') {
      if (typeof entry.key === 'string') {
        result.push(entry.key);
      } else if (typeof entry.coordinateKey === 'string') {
        result.push(entry.coordinateKey);
      }
    }
  });
  return result;
};

const serializeWaterColumns = (source) => {
  const entries = toMapEntries(source);
  if (entries.length === 0) {
    return {
      keys: [],
      bottomY: new Float32Array(0),
      surfaceY: new Float32Array(0),
    };
  }
  const keys = new Array(entries.length);
  const bottomY = new Float32Array(entries.length);
  const surfaceY = new Float32Array(entries.length);
  entries.forEach(([key, bounds], index) => {
    keys[index] = key ?? null;
    const bottomValue = Number.isFinite(bounds?.bottomY) ? bounds.bottomY : 0;
    const surfaceValue = Number.isFinite(bounds?.surfaceY) ? bounds.surfaceY : 0;
    bottomY[index] = bottomValue;
    surfaceY[index] = surfaceValue;
  });
  return { keys, bottomY, surfaceY };
};

const toUint32Array = (values) => {
  if (!values) {
    return new Uint32Array(0);
  }
  if (ArrayBuffer.isView(values) && !(values instanceof DataView)) {
    return new Uint32Array(values);
  }
  if (Array.isArray(values)) {
    return new Uint32Array(values.map((value) => (Number.isFinite(value) ? value : 0)));
  }
  if (values instanceof Set) {
    return new Uint32Array(Array.from(values).map((value) => (Number.isFinite(value) ? value : 0)));
  }
  return new Uint32Array(0);
};

const serializeFluidColumnsByType = (source) => {
  const entries = toMapEntries(source);
  return entries
    .map(([type, columnsSource]) => {
      if (!type) {
        return null;
      }
      const columnEntries =
        columnsSource instanceof Map
          ? Array.from(columnsSource.values())
          : Array.isArray(columnsSource)
          ? columnsSource
          : columnsSource && typeof columnsSource === 'object'
          ? Object.values(columnsSource)
          : [];
      const count = columnEntries.length;
      const keys = new Array(count);
      const positionsX = new Float32Array(count);
      const positionsZ = new Float32Array(count);
      const minY = new Float32Array(count);
      const maxY = new Float32Array(count);
      const depth = new Float32Array(count);
      const colors = new Float32Array(count * 3);
      const flowDirection = new Float32Array(count * 2);
      const flowStrength = new Float32Array(count);
      const foamAmount = new Float32Array(count);
      const shoreline = new Float32Array(count);
      const exposed = new Uint8Array(count);
      const metadata = new Array(count);
      columnEntries.forEach((column, index) => {
        if (!column) {
          keys[index] = null;
          metadata[index] = null;
          return;
        }
        const key = column.key ?? `${Math.round(column.x ?? 0)}|${Math.round(column.z ?? 0)}`;
        keys[index] = key;
        positionsX[index] = Number.isFinite(column.x) ? column.x : 0;
        positionsZ[index] = Number.isFinite(column.z) ? column.z : 0;
        const minValue = Number.isFinite(column.minY)
          ? column.minY
          : Number.isFinite(column.bottomY)
          ? column.bottomY
          : 0;
        const maxValue = Number.isFinite(column.maxY)
          ? column.maxY
          : Number.isFinite(column.surfaceY)
          ? column.surfaceY
          : minValue;
        minY[index] = minValue;
        maxY[index] = maxValue;
        depth[index] = Number.isFinite(column.depth)
          ? column.depth
          : Math.max(0, maxValue - minValue);
        const colorArray = toPlainColorArray(column.color) ?? [0, 0, 0];
        colors[index * 3 + 0] = Number.isFinite(colorArray[0]) ? colorArray[0] : 0;
        colors[index * 3 + 1] = Number.isFinite(colorArray[1]) ? colorArray[1] : 0;
        colors[index * 3 + 2] = Number.isFinite(colorArray[2]) ? colorArray[2] : 0;
        const flowDir = column.flowDirection ?? { x: 0, y: 0 };
        flowDirection[index * 2 + 0] = Number.isFinite(flowDir.x) ? flowDir.x : 0;
        flowDirection[index * 2 + 1] = Number.isFinite(flowDir.y) ? flowDir.y : 0;
        flowStrength[index] = Number.isFinite(column.flowStrength)
          ? column.flowStrength
          : 0;
        foamAmount[index] = Number.isFinite(column.foamAmount)
          ? column.foamAmount
          : 0;
        shoreline[index] = Number.isFinite(column.shoreline)
          ? column.shoreline
          : 0;
        exposed[index] = column.isExposed ? 1 : 0;
        metadata[index] = normalizeSerializable({
          biome: column.biome ?? null,
          lifecycleCues:
            column.lifecycleCues instanceof Set
              ? Array.from(column.lifecycleCues)
              : column.lifecycleCues ?? null,
          auroraIntensitySum: column.auroraIntensitySum ?? null,
          auroraIntensitySamples: column.auroraIntensitySamples ?? null,
          glowBiasSum: column.glowBiasSum ?? null,
          glowBiasSamples: column.glowBiasSamples ?? null,
          pulseRateSum: column.pulseRateSum ?? null,
          pulseRateSamples: column.pulseRateSamples ?? null,
          ridgeStrengthSum: column.ridgeStrengthSum ?? null,
          ridgeStrengthSamples: column.ridgeStrengthSamples ?? null,
          orientationVector: column.orientationVector ?? null,
          orientationSamples: column.orientationSamples ?? null,
          flowDirectionHint: column.flowDirectionHint ?? null,
          flowDirectionHintSamples: column.flowDirectionHintSamples ?? null,
          flowStrengthHintSum: column.flowStrengthHintSum ?? null,
          flowStrengthHintSamples: column.flowStrengthHintSamples ?? null,
          foamHint: column.foamHint ?? null,
          localAuroraIntensity: column.localAuroraIntensity ?? null,
          localAuroraGlow: column.localAuroraGlow ?? null,
          localPulseRate: column.localPulseRate ?? null,
          ridgeStrength: column.ridgeStrength ?? null,
          ribbonOrientation: column.ribbonOrientation ?? null,
          ribbonVector: column.ribbonVector ?? null,
          ribbonSegments: column.ribbonSegments ?? null,
          ribbonSpan: column.ribbonSpan ?? null,
          ribbonHeight: column.ribbonHeight ?? null,
        });
      });
      return {
        type,
        keys,
        positions: {
          x: positionsX,
          z: positionsZ,
        },
        minY,
        maxY,
        depth,
        colors,
        flowDirection,
        flowStrength,
        foamAmount,
        shoreline,
        exposed,
        metadata,
      };
    })
    .filter(Boolean);
};

const serializeFluidSurfaces = (surfaces, columnRecords) => {
  const exposedColumnsByType = new Map();
  columnRecords.forEach((record) => {
    if (!record || !record.type) {
      return;
    }
    const columnKeys = [];
    const exposed = record.exposed ?? [];
    const { keys } = record;
    for (let i = 0; i < keys.length; i += 1) {
      if (exposed[i] === 1) {
        columnKeys.push(keys[i]);
      }
    }
    exposedColumnsByType.set(record.type, columnKeys);
  });
  const iterate = Array.isArray(surfaces) ? surfaces : [];
  return iterate
    .map((surface) => {
      if (!surface) {
        return null;
      }
      const surfaceType = surface.userData?.type ?? surface.type ?? null;
      if (typeof surfaceType !== 'string') {
        return null;
      }
      const normalizedType = surfaceType.startsWith('fluid:')
        ? surfaceType.slice('fluid:'.length)
        : surfaceType;
      const cues = surface.userData?.lifecycleCues;
      return {
        type: normalizedType,
        columnKeys: (exposedColumnsByType.get(normalizedType) ?? []).slice(),
        lifecycleCues: Array.isArray(cues)
          ? cues.map((cue) => String(cue))
          : [],
        auroraIntensity: Number.isFinite(surface.userData?.auroraIntensity)
          ? surface.userData.auroraIntensity
          : null,
        ribbonOrientation: Number.isFinite(surface.userData?.ribbonOrientation)
          ? surface.userData.ribbonOrientation
          : null,
      };
    })
    .filter(Boolean);
};

const serializeDecorationBatches = (instancedSource, decorationData) => {
  const entries = toMapEntries(instancedSource);
  const dataMap = decorationData instanceof Map ? decorationData : null;
  return entries.map(([type, value]) => {
    const entryArray = Array.isArray(value)
      ? value
      : value instanceof Map
      ? Array.from(value.values())
      : [];
    const serializedEntries = entryArray.map((entry) =>
      normalizeSerializable(entry?.payload ?? serializeInstancedEntry(entry)),
    );
    const capacityCandidate = dataMap?.get(type)?.capacity ?? entryArray.length;
    const entryKeys = entryArray
      .map((entry) => (entry?.key ? String(entry.key) : null))
      .filter(Boolean);
    return {
      type,
      capacity: Number.isFinite(capacityCandidate) ? capacityCandidate : entryArray.length,
      entryKeys,
      entries: serializedEntries,
    };
  });
};

const serializeDecorationGroups = (source) =>
  toMapEntries(source)
    .map(([key, metadata]) => {
      if (!metadata) {
        return null;
      }
      const groupKey = metadata.key ?? key ?? null;
      if (!groupKey) {
        return null;
      }
      return {
        key: groupKey,
        type: metadata.type ?? null,
        owner: metadata.owner ?? null,
        destructible:
          typeof metadata.destructible === 'boolean'
            ? metadata.destructible
            : metadata.destructible ?? true,
        entryIndices: toUint32Array(metadata.instanceIndices),
      };
    })
    .filter((record) => record && record.key && record.type);

const serializeDecorationOwnerIndex = (source) => {
  const result = {};
  if (!source) {
    return result;
  }
  if (source instanceof Map) {
    source.forEach((groups, owner) => {
      if (groups instanceof Map) {
        result[owner] = Array.from(groups.keys()).map((key) => String(key));
      } else if (groups instanceof Set) {
        result[owner] = Array.from(groups).map((key) => String(key));
      } else if (Array.isArray(groups)) {
        result[owner] = groups.map((key) => String(key));
      }
    });
    return result;
  }
  if (typeof source === 'object') {
    Object.entries(source).forEach(([owner, groups]) => {
      if (groups instanceof Map) {
        result[owner] = Array.from(groups.keys()).map((key) => String(key));
      } else if (groups instanceof Set) {
        result[owner] = Array.from(groups).map((key) => String(key));
      } else if (Array.isArray(groups)) {
        result[owner] = groups.map((key) => String(key));
      }
    });
  }
  return result;
};

const serializeDecorationTypeIndex = (source) => {
  const result = {};
  if (!source) {
    return result;
  }
  if (source instanceof Map) {
    source.forEach((groups, type) => {
      if (groups instanceof Set) {
        result[type] = Array.from(groups)
          .map((metadata) => metadata?.key ?? null)
          .filter(Boolean)
          .map((key) => String(key));
      } else if (groups instanceof Map) {
        result[type] = Array.from(groups.keys()).map((key) => String(key));
      } else if (Array.isArray(groups)) {
        result[type] = groups.map((key) => String(key));
      }
    });
    return result;
  }
  if (typeof source === 'object') {
    Object.entries(source).forEach(([type, groups]) => {
      if (groups instanceof Set) {
        result[type] = Array.from(groups)
          .map((metadata) => metadata?.key ?? null)
          .filter(Boolean)
          .map((key) => String(key));
      } else if (groups instanceof Map) {
        result[type] = Array.from(groups.keys()).map((key) => String(key));
      } else if (Array.isArray(groups)) {
        result[type] = groups.map((key) => String(key));
      }
    });
  }
  return result;
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
  includeBlockPlacements = false,
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
  const blockPlacements = includeBlockPlacements ? [] : null;

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

    if (includeBlockPlacements && blockPlacements) {
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
    }

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

  const fluidColumnRecords = serializeFluidColumnsByType(
    engine.fluidColumnsByType,
  );
  const fluids = {
    blockKeys: serializeFluidBlockKeys(engine.fluidBlockKeys),
    waterColumns: serializeWaterColumns(engine.waterColumnMetadata),
    columnsByType: fluidColumnRecords,
    surfaces: serializeFluidSurfaces(engine.fluidSurfaces, fluidColumnRecords),
  };

  const decorations = {
    batches: serializeDecorationBatches(
      engine.decorationInstancedData,
      engine.decorationData,
    ),
    groups: serializeDecorationGroups(engine.decorationGroups),
    ownerIndex: serializeDecorationOwnerIndex(engine.decorationOwnerIndex),
    typeIndex: serializeDecorationTypeIndex(engine.decorationTypeIndex),
  };

  return {
    chunkX,
    chunkZ,
    blockPlacements: includeBlockPlacements ? blockPlacements : null,
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
    fluids,
    decorations,
  };
};

