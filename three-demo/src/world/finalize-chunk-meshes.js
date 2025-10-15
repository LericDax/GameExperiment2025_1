import {
  deserializeInstancedEntry,
} from './chunk-payload-serializers.js';
import { buildInstancedBlockMesh } from './generation.js';
import { createFluidSurface } from './fluids/fluid-registry.js';
import { buildFluidGeometry } from './fluids/fluid-geometry.js';
import { buildLumenRibbonGeometry } from './fluids/lumen-ribbon-geometry.js';

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const finalizeChunkMeshes = (payload, blockMaterials, THREE) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('finalizeChunkMeshes requires a chunk payload.');
  }
  if (!THREE) {
    throw new Error('finalizeChunkMeshes requires a THREE instance.');
  }
  if (!blockMaterials || typeof blockMaterials !== 'object') {
    throw new Error('finalizeChunkMeshes requires block materials.');
  }

  const chunkGroup = new THREE.Group();
  const chunkName = `chunk_${payload.chunkX ?? 0}_${payload.chunkZ ?? 0}`;
  chunkGroup.name = chunkName;

  const instancedMeshes = [];
  const decorationMeshes = [];
  const fluidMeshes = [];

  const typeData = new Map();
  const typeCapacities = new Map();
  const blockLookup = new Map();
  const entryPayloadLookup = new Map();

  const typeMetadataArray = normalizeArray(payload.typeMetadata);
  typeMetadataArray.forEach((metadata) => {
    const type = metadata?.type ?? null;
    if (!type) {
      return;
    }

    const entryPayloads = normalizeArray(metadata.entryPayloads);
    const entryKeys = normalizeArray(metadata.entryKeys);
    const entries = entryPayloads
      .map((entryPayload) => deserializeInstancedEntry(entryPayload, THREE))
      .filter(Boolean);

    const capacityCandidate = Number.isFinite(metadata.capacity)
      ? metadata.capacity
      : entries.length;
    const effectiveCapacity = Math.max(1, capacityCandidate, entries.length);

    entries.forEach((entry) => {
      if (!entry) {
        return;
      }
      if (!entry.type) {
        entry.type = type;
      }
      if (entry.key) {
        blockLookup.set(String(entry.key), entry);
      }
      if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
        blockLookup.set(String(entry.coordinateKey), entry);
      }
    });

    entryKeys.forEach((key, index) => {
      if (!key) {
        return;
      }
      entryPayloadLookup.set(String(key), {
        type,
        payload: entryPayloads[index] ?? null,
      });
    });

    const { mesh, tintAttribute } = buildInstancedBlockMesh({
      THREE,
      blockMaterials,
      type,
      entries,
      capacity: effectiveCapacity,
    });

    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = entries.length > 0;
    if (tintAttribute) {
      tintAttribute.needsUpdate = entries.length > 0;
    }

    typeData.set(type, {
      entries,
      mesh,
      tintAttribute,
      capacity: effectiveCapacity,
    });
    typeCapacities.set(type, effectiveCapacity);
    chunkGroup.add(mesh);
    instancedMeshes.push(mesh);
  });

  const rehydrateFluidState = (fluidsPayload = {}) => {
    const blockKeySet = new Set();
    normalizeArray(fluidsPayload.blockKeys).forEach((key) => {
      if (typeof key === 'string') {
        blockKeySet.add(key);
      }
    });

    const waterColumnsMap = new Map();
    const waterColumnsPayload = fluidsPayload.waterColumns ?? {};
    const waterKeys = normalizeArray(waterColumnsPayload.keys);
    const bottomArray = waterColumnsPayload.bottomY ?? [];
    const surfaceArray = waterColumnsPayload.surfaceY ?? [];
    waterKeys.forEach((key, index) => {
      if (!key) {
        return;
      }
      const bottomValue = Number.isFinite(bottomArray?.[index])
        ? bottomArray[index]
        : null;
      const surfaceValue = Number.isFinite(surfaceArray?.[index])
        ? surfaceArray[index]
        : null;
      if (bottomValue === null && surfaceValue === null) {
        waterColumnsMap.set(String(key), null);
        return;
      }
      const normalizedBottom = bottomValue ?? surfaceValue ?? 0;
      const normalizedSurface = surfaceValue ?? bottomValue ?? normalizedBottom;
      waterColumnsMap.set(String(key), {
        bottomY: normalizedBottom,
        surfaceY: normalizedSurface,
      });
    });

    const typeColumns = new Map();
    normalizeArray(fluidsPayload.columnsByType).forEach((record) => {
      const type = record?.type ?? null;
      if (!type) {
        return;
      }
      const keysArray = normalizeArray(record.keys);
      const positionsX = record.positions?.x ?? [];
      const positionsZ = record.positions?.z ?? [];
      const minY = record.minY ?? [];
      const maxY = record.maxY ?? [];
      const depthArray = record.depth ?? [];
      const colors = record.colors ?? [];
      const flowDirection = record.flowDirection ?? [];
      const flowStrength = record.flowStrength ?? [];
      const foamAmount = record.foamAmount ?? [];
      const shoreline = record.shoreline ?? [];
      const exposed = record.exposed ?? [];
      const metadataEntries = normalizeArray(record.metadata);
      const columns = new Map();
      for (let index = 0; index < keysArray.length; index += 1) {
        const key = keysArray[index] ?? null;
        const colorIndex = index * 3;
        const flowIndex = index * 2;
        if (
          !key &&
          !Number.isFinite(positionsX?.[index]) &&
          !Number.isFinite(positionsZ?.[index])
        ) {
          continue;
        }
        const column = {
          key: String(
            key ?? `${Math.round(positionsX?.[index] ?? 0)}|${Math.round(positionsZ?.[index] ?? 0)}`,
          ),
          x: Number.isFinite(positionsX?.[index]) ? positionsX[index] : 0,
          z: Number.isFinite(positionsZ?.[index]) ? positionsZ[index] : 0,
          minY: Number.isFinite(minY?.[index]) ? minY[index] : 0,
          maxY: Number.isFinite(maxY?.[index])
            ? maxY[index]
            : Number.isFinite(minY?.[index])
            ? minY[index]
            : 0,
          depth: Number.isFinite(depthArray?.[index])
            ? depthArray[index]
            : Math.max(
                0.05,
                (Number.isFinite(maxY?.[index]) ? maxY[index] : 0) -
                  (Number.isFinite(minY?.[index]) ? minY[index] : 0),
              ),
          color: new THREE.Color(
            Number.isFinite(colors?.[colorIndex]) ? colors[colorIndex] : 0,
            Number.isFinite(colors?.[colorIndex + 1]) ? colors[colorIndex + 1] : 0,
            Number.isFinite(colors?.[colorIndex + 2]) ? colors[colorIndex + 2] : 0,
          ),
          flowDirection: new THREE.Vector2(
            Number.isFinite(flowDirection?.[flowIndex]) ? flowDirection[flowIndex] : 0,
            Number.isFinite(flowDirection?.[flowIndex + 1])
              ? flowDirection[flowIndex + 1]
              : 0,
          ),
          flowStrength: Number.isFinite(flowStrength?.[index]) ? flowStrength[index] : 0,
          foamAmount: Number.isFinite(foamAmount?.[index]) ? foamAmount[index] : 0,
          shoreline: Number.isFinite(shoreline?.[index]) ? shoreline[index] : 0,
          isExposed:
            (exposed instanceof Uint8Array ? exposed[index] === 1 : exposed?.[index] === 1) ||
            exposed?.[index] === true,
        };
        column.surfaceY = column.maxY;
        column.bottomY = column.minY;
        const metadata = metadataEntries[index] ?? null;
        if (metadata) {
          if (Array.isArray(metadata.lifecycleCues)) {
            column.lifecycleCues = new Set(
              metadata.lifecycleCues.map((cue) => String(cue)),
            );
          }
          if (metadata.biome) {
            column.biome = metadata.biome;
          }
          if (Number.isFinite(metadata.auroraIntensitySum)) {
            column.auroraIntensitySum = metadata.auroraIntensitySum;
          }
          if (Number.isFinite(metadata.auroraIntensitySamples)) {
            column.auroraIntensitySamples = metadata.auroraIntensitySamples;
          }
          if (Number.isFinite(metadata.glowBiasSum)) {
            column.glowBiasSum = metadata.glowBiasSum;
          }
          if (Number.isFinite(metadata.glowBiasSamples)) {
            column.glowBiasSamples = metadata.glowBiasSamples;
          }
          if (Number.isFinite(metadata.pulseRateSum)) {
            column.pulseRateSum = metadata.pulseRateSum;
          }
          if (Number.isFinite(metadata.pulseRateSamples)) {
            column.pulseRateSamples = metadata.pulseRateSamples;
          }
          if (Number.isFinite(metadata.ridgeStrengthSum)) {
            column.ridgeStrengthSum = metadata.ridgeStrengthSum;
          }
          if (Number.isFinite(metadata.ridgeStrengthSamples)) {
            column.ridgeStrengthSamples = metadata.ridgeStrengthSamples;
          }
          if (metadata.orientationVector) {
            column.orientationVector = metadata.orientationVector;
          }
          if (Number.isFinite(metadata.orientationSamples)) {
            column.orientationSamples = metadata.orientationSamples;
          }
          if (metadata.flowDirectionHint) {
            column.flowDirectionHint = metadata.flowDirectionHint;
          }
          if (Number.isFinite(metadata.flowDirectionHintSamples)) {
            column.flowDirectionHintSamples = metadata.flowDirectionHintSamples;
          }
          if (Number.isFinite(metadata.flowStrengthHintSum)) {
            column.flowStrengthHintSum = metadata.flowStrengthHintSum;
          }
          if (Number.isFinite(metadata.flowStrengthHintSamples)) {
            column.flowStrengthHintSamples = metadata.flowStrengthHintSamples;
          }
          if (Number.isFinite(metadata.foamHint)) {
            column.foamHint = metadata.foamHint;
          }
          if (Number.isFinite(metadata.localAuroraIntensity)) {
            column.localAuroraIntensity = metadata.localAuroraIntensity;
          }
          if (Number.isFinite(metadata.localAuroraGlow)) {
            column.localAuroraGlow = metadata.localAuroraGlow;
          }
          if (Number.isFinite(metadata.localPulseRate)) {
            column.localPulseRate = metadata.localPulseRate;
          }
          if (Number.isFinite(metadata.ridgeStrength)) {
            column.ridgeStrength = metadata.ridgeStrength;
          }
          if (Number.isFinite(metadata.ribbonOrientation)) {
            column.ribbonOrientation = metadata.ribbonOrientation;
          }
          if (metadata.ribbonVector) {
            column.ribbonVector = metadata.ribbonVector;
          }
          if (Number.isFinite(metadata.ribbonSegments)) {
            column.ribbonSegments = metadata.ribbonSegments;
          }
          if (Number.isFinite(metadata.ribbonSpan)) {
            column.ribbonSpan = metadata.ribbonSpan;
          }
          if (Number.isFinite(metadata.ribbonHeight)) {
            column.ribbonHeight = metadata.ribbonHeight;
          }
        }
        columns.set(column.key, column);
      }
      typeColumns.set(type, columns);
    });

    return {
      blockKeys: blockKeySet,
      waterColumns: waterColumnsMap,
      columnsByType: typeColumns,
    };
  };

  const fluidState = rehydrateFluidState(payload.fluids ?? {});
  const fluidBlockKeys = new Set(fluidState.blockKeys);
  const waterColumns = new Map(fluidState.waterColumns);
  const fluidColumnsByType = new Map(fluidState.columnsByType);

  const rehydrateFluidSurfaces = (fluidsPayload = {}) => {
    const surfaces = [];
    normalizeArray(fluidsPayload.surfaces).forEach((surfaceInfo) => {
      const type = surfaceInfo?.type ?? null;
      if (!type) {
        return;
      }
      const columns = fluidColumnsByType.get(type);
      if (!(columns instanceof Map) || columns.size === 0) {
        return;
      }
      const columnValues = [];
      const columnKeys = normalizeArray(surfaceInfo.columnKeys);
      if (columnKeys.length > 0) {
        columnKeys.forEach((key) => {
          const column = columns.get(String(key));
          if (column) {
            columnValues.push(column);
          }
        });
      }
      if (columnValues.length === 0) {
        columns.forEach((column) => {
          columnValues.push(column);
        });
      }
      if (columnValues.length === 0) {
        return;
      }
      const geometry =
        type === 'lumen_ribbon'
          ? buildLumenRibbonGeometry({ THREE, columns: columnValues })
          : buildFluidGeometry({ THREE, columns: columnValues });
      const positionAttribute = geometry.getAttribute('position');
      if (!positionAttribute || positionAttribute.count === 0) {
        geometry.dispose();
        return;
      }
      geometry.userData = geometry.userData || {};
      if (Array.isArray(surfaceInfo.lifecycleCues) && surfaceInfo.lifecycleCues.length > 0) {
        geometry.userData.lifecycleCues = surfaceInfo.lifecycleCues.map((cue) => String(cue));
      }
      if (Number.isFinite(surfaceInfo.auroraIntensity)) {
        geometry.userData.auroraIntensity = surfaceInfo.auroraIntensity;
      }
      if (Number.isFinite(surfaceInfo.ribbonOrientation)) {
        geometry.userData.ribbonOrientation = surfaceInfo.ribbonOrientation;
      }
      const mesh = createFluidSurface({ type, geometry });
      mesh.userData = mesh.userData || {};
      mesh.userData.type = `fluid:${type}`;
      mesh.userData.chunkKey = chunkName;
      fluidMeshes.push(mesh);
      chunkGroup.add(mesh);
      surfaces.push(mesh);
    });
    return surfaces;
  };

  const fluidSurfaces = rehydrateFluidSurfaces(payload.fluids ?? {});

  const decorationData = new Map();
  const decorationGroups = new Map();
  const decorationOwnerIndex = new Map();
  const decorationTypeIndex = new Map();

  normalizeArray(payload.decorations?.batches).forEach((batch) => {
    const type = batch?.type ?? null;
    if (!type) {
      return;
    }
    const entryPayloads = normalizeArray(batch.entries);
    const entries = entryPayloads
      .map((entryPayload) => deserializeInstancedEntry(entryPayload, THREE))
      .filter(Boolean);
    const capacityCandidate = Number.isFinite(batch.capacity)
      ? batch.capacity
      : entries.length;
    const effectiveCapacity = Math.max(1, capacityCandidate, entries.length);
    const { mesh, tintAttribute } = buildInstancedBlockMesh({
      THREE,
      blockMaterials,
      type,
      entries,
      capacity: effectiveCapacity,
    });
    mesh.userData.decoration = true;
    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = entries.length > 0;
    if (tintAttribute) {
      tintAttribute.needsUpdate = entries.length > 0;
    }
    decorationData.set(type, {
      entries,
      mesh,
      tintAttribute,
      capacity: effectiveCapacity,
    });
    decorationMeshes.push(mesh);
    chunkGroup.add(mesh);
  });

  normalizeArray(payload.decorations?.groups).forEach((groupInfo) => {
    const key = groupInfo?.key ?? null;
    const type = groupInfo?.type ?? null;
    if (!key || !type) {
      return;
    }
    const record = decorationData.get(type);
    const entries = record?.entries ?? [];
    const indicesSource = groupInfo.entryIndices;
    const instanceIndices = ArrayBuffer.isView(indicesSource)
      ? Array.from(indicesSource)
      : Array.isArray(indicesSource)
      ? indicesSource.slice()
      : [];
    const metadata = {
      key,
      owner: groupInfo?.owner ?? null,
      destructible:
        typeof groupInfo?.destructible === 'boolean' ? groupInfo.destructible : true,
      type,
      mesh: record?.mesh ?? null,
      tintAttribute: record?.tintAttribute ?? null,
      instanceIndices,
    };
    decorationGroups.set(key, metadata);
    if (metadata.owner !== null && metadata.owner !== undefined) {
      let ownerGroups = decorationOwnerIndex.get(metadata.owner);
      if (!ownerGroups) {
        ownerGroups = new Map();
        decorationOwnerIndex.set(metadata.owner, ownerGroups);
      }
      ownerGroups.set(key, metadata);
    }
    let typeGroups = decorationTypeIndex.get(type);
    if (!typeGroups) {
      typeGroups = new Set();
      decorationTypeIndex.set(type, typeGroups);
    }
    typeGroups.add(metadata);
    metadata.instanceIndices.forEach((instanceIndex) => {
      const entry = entries[instanceIndex];
      if (entry) {
        entry.decorationGroup = metadata;
      }
    });
  });

  const ownerIndexPayload = payload.decorations?.ownerIndex ?? {};
  if (ownerIndexPayload && typeof ownerIndexPayload === 'object') {
    Object.entries(ownerIndexPayload).forEach(([ownerKey, groupKeys]) => {
      const normalizedKeys = Array.isArray(groupKeys) ? groupKeys : [];
      let ownerGroups = decorationOwnerIndex.get(ownerKey);
      if (!ownerGroups) {
        ownerGroups = new Map();
        decorationOwnerIndex.set(ownerKey, ownerGroups);
      }
      normalizedKeys.forEach((groupKey) => {
        const metadata = decorationGroups.get(groupKey);
        if (metadata) {
          ownerGroups.set(groupKey, metadata);
        }
      });
    });
  }

  const typeIndexPayload = payload.decorations?.typeIndex ?? {};
  if (typeIndexPayload && typeof typeIndexPayload === 'object') {
    Object.entries(typeIndexPayload).forEach(([type, groupKeys]) => {
      const normalizedKeys = Array.isArray(groupKeys) ? groupKeys : [];
      let typeGroups = decorationTypeIndex.get(type);
      if (!typeGroups) {
        typeGroups = new Set();
        decorationTypeIndex.set(type, typeGroups);
      }
      normalizedKeys.forEach((groupKey) => {
        const metadata = decorationGroups.get(groupKey);
        if (metadata) {
          typeGroups.add(metadata);
        }
      });
    });
  }

  const biomePayload = normalizeArray(payload.biomes);
  const totalSamples = biomePayload.reduce((sum, entry) => {
    const samples = Number.isFinite(entry?.samples) ? entry.samples : 0;
    return sum + samples;
  }, 0);
  const colorScratch = new THREE.Color(0, 0, 0);
  const colorArrayToHex = (array) => {
    if (!Array.isArray(array)) {
      return '#000000';
    }
    const [r = 0, g = 0, b = 0] = array;
    colorScratch.setRGB(
      Number.isFinite(r) ? r : 0,
      Number.isFinite(g) ? g : 0,
      Number.isFinite(b) ? b : 0,
    );
    return `#${colorScratch.getHexString()}`;
  };
  const biomes = biomePayload.map((entry) => {
    const samples = Number.isFinite(entry?.samples) ? entry.samples : 0;
    const shader = entry?.shader ?? {};
    return {
      id: entry?.id ?? null,
      label: entry?.label ?? null,
      weight:
        totalSamples > 0
          ? samples / totalSamples
          : Number.isFinite(entry?.weight)
          ? entry.weight
          : 0,
      shader: {
        fogColor: colorArrayToHex(shader.fogColor),
        tintColor: colorArrayToHex(shader.tintColor),
        tintStrength: Number.isFinite(shader.tintStrength)
          ? shader.tintStrength
          : 1,
      },
    };
  });
  chunkGroup.userData = chunkGroup.userData || {};
  chunkGroup.userData.biomes = biomes;

  const findEntryByKey = (key, typeHint = null) => {
    if (!key) {
      return null;
    }
    const normalizedKey = String(key);
    let entry = blockLookup.get(normalizedKey);
    if (entry) {
      return entry;
    }
    const searchTypeRecord = (typeKey) => {
      if (!typeKey || !(typeData instanceof Map)) {
        return null;
      }
      const record = typeData.get(typeKey);
      if (!record) {
        return null;
      }
      const entries = Array.isArray(record.entries) ? record.entries : [];
      return entries.find((candidate) => candidate?.key === normalizedKey) ?? null;
    };
    if (typeHint) {
      entry = searchTypeRecord(typeHint);
      if (entry) {
        blockLookup.set(normalizedKey, entry);
        if (entry.coordinateKey && entry.coordinateKey !== normalizedKey) {
          blockLookup.set(entry.coordinateKey, entry);
        }
        return entry;
      }
    }
    if (typeData instanceof Map) {
      for (const [, record] of typeData.entries()) {
        const entries = Array.isArray(record?.entries) ? record.entries : [];
        entry = entries.find((candidate) => candidate?.key === normalizedKey);
        if (entry) {
          blockLookup.set(normalizedKey, entry);
          if (entry.coordinateKey && entry.coordinateKey !== normalizedKey) {
            blockLookup.set(entry.coordinateKey, entry);
          }
          return entry;
        }
      }
    }
    const payloadInfo = entryPayloadLookup.get(normalizedKey);
    if (payloadInfo?.payload) {
      const hydrated = deserializeInstancedEntry(payloadInfo.payload, THREE);
      if (hydrated) {
        hydrated.mesh = null;
        hydrated.tintAttribute = null;
        hydrated.index = -1;
        blockLookup.set(normalizedKey, hydrated);
        if (hydrated.coordinateKey && hydrated.coordinateKey !== normalizedKey) {
          blockLookup.set(hydrated.coordinateKey, hydrated);
        }
        return hydrated;
      }
    }
    return null;
  };

  const prototypeInstances = new Map();
  normalizeArray(payload.prototypeInstances).forEach((instanceRecord) => {
    if (!instanceRecord || !instanceRecord.key) {
      return;
    }
    const blocks = normalizeArray(instanceRecord.blockEntries);
    const blockEntries = [];
    blocks.forEach((blockEntry) => {
      if (!blockEntry) {
        return;
      }
      const entryKey = blockEntry.entryKey ?? null;
      const typeHint = blockEntry.type ?? null;
      const entry = findEntryByKey(entryKey, typeHint);
      if (!entry) {
        return;
      }
      if (!entry.prototypeKey) {
        entry.prototypeKey = instanceRecord.key;
      }
      blockEntries.push({
        type: typeHint ?? entry.type ?? null,
        entry,
      });
    });
    prototypeInstances.set(instanceRecord.key, {
      key: instanceRecord.key,
      prototypeId: instanceRecord.prototypeId ?? null,
      blockEntries,
      decorationKeys: normalizeArray(instanceRecord.decorationKeys).slice(),
    });
  });

  return {
    chunkGroup,
    instancedMeshes,
    fluidMeshes,
    fluidSurfaces,
    decorationMeshes,
    typeData,
    typeCapacities,
    blockLookup,
    fluidBlockKeys,
    fluidColumnsByType,
    waterColumns,
    decorationData,
    decorationGroups,
    decorationOwnerIndex,
    decorationTypeIndex,
    biomes,
    prototypeInstances,
  };
};

