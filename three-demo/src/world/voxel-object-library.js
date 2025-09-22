const voxelObjectModules = import.meta.glob('./voxel-objects/**/*.json', {
  eager: true,
});

function asArray(value, dimension, label, path) {
  if (!Array.isArray(value) || value.length !== dimension) {
    throw new Error(
      `Invalid ${label} in voxel object definition at ${path}. Expected array of length ${dimension}.`,
    );
  }
  return value.map((component) => {
    if (typeof component !== 'number' || Number.isNaN(component)) {
      throw new Error(
        `Invalid ${label} component in voxel object definition at ${path}.`,
      );
    }
    return component;
  });
}

function parseSize(value, path) {
  if (value === undefined || value === null) {
    return { x: 1, y: 1, z: 1 };
  }
  if (typeof value === 'number') {
    return { x: value, y: value, z: value };
  }
  if (Array.isArray(value)) {
    const [x, y, z] = asArray(value, 3, 'size', path);
    return { x, y, z };
  }
  if (typeof value === 'object') {
    const x = typeof value.x === 'number' ? value.x : 1;
    const y = typeof value.y === 'number' ? value.y : 1;
    const z = typeof value.z === 'number' ? value.z : 1;
    return { x, y, z };
  }
  throw new Error(`Unsupported size value in voxel object definition at ${path}.`);
}

function computeBoundingBox(voxels, voxelScale) {
  if (!voxels.length) {
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
    const sizeX = size.x ?? 1;
    const sizeY = size.y ?? 1;
    const sizeZ = size.z ?? 1;
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

function normalizeVoxel(voxel, index, { path }) {
  if (!voxel || typeof voxel !== 'object') {
    throw new Error(
      `Invalid voxel entry at index ${index} in voxel object definition at ${path}.`,
    );
  }
  if (typeof voxel.type !== 'string' || voxel.type.trim().length === 0) {
    throw new Error(
      `Voxel entry at index ${index} in ${path} is missing a valid block type.`,
    );
  }
  const position = asArray(voxel.position, 3, 'position', path);
  const size = parseSize(voxel.size, path);
  const tint = typeof voxel.tint === 'string' ? voxel.tint : null;
  const isSolid =
    typeof voxel.isSolid === 'boolean' ? voxel.isSolid : undefined;
  const destructible =
    typeof voxel.destructible === 'boolean' ? voxel.destructible : undefined;

  let collisionMode = null;
  if (typeof voxel.collision === 'string') {
    const normalized = voxel.collision.toLowerCase();
    if (['solid', 'none', 'soft'].includes(normalized)) {
      collisionMode = normalized;
    } else if (normalized !== 'auto') {
      throw new Error(
        `Unsupported collision mode "${voxel.collision}" in voxel entry ${index} for ${path}.`,
      );
    }
  }


  return {
    index,
    type: voxel.type,
    position: { x: position[0], y: position[1], z: position[2] },
    size,
    tint,
    isSolid,
    destructible,

    collisionMode,

    metadata: typeof voxel.metadata === 'object' ? { ...voxel.metadata } : null,
  };
}

function normalizeDefinition(path, raw) {
  const definition = raw?.default ?? raw;
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Voxel object definition at ${path} is invalid.`);
  }
  const id = definition.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`Voxel object definition at ${path} is missing an id.`);
  }
  if (typeof definition.voxelScale !== 'number' || definition.voxelScale <= 0) {
    throw new Error(
      `Voxel object definition ${id} (${path}) is missing a positive voxelScale value.`,
    );
  }
  const category =
    typeof definition.category === 'string' && definition.category.trim().length > 0
      ? definition.category
      : 'uncategorized';
  const voxels = Array.isArray(definition.voxels)
    ? definition.voxels.map((voxel, index) => normalizeVoxel(voxel, index, { path }))
    : [];

  const attachment = {
    groundOffset:
      typeof definition?.attachment?.groundOffset === 'number'
        ? definition.attachment.groundOffset
        : definition.voxelScale,
  };

  const placement = {
    weight:
      typeof definition?.placement?.weight === 'number'
        ? Math.max(0, definition.placement.weight)
        : 1,
    biomes: Array.isArray(definition?.placement?.biomes)
      ? definition.placement.biomes.filter((biome) => typeof biome === 'string')
      : null,
    tags: Array.isArray(definition?.placement?.tags)
      ? definition.placement.tags.filter((tag) => typeof tag === 'string')
      : null,
    minSlope:
      typeof definition?.placement?.minSlope === 'number'
        ? Math.max(0, Math.min(1, definition.placement.minSlope))
        : 0,
    maxSlope:
      typeof definition?.placement?.maxSlope === 'number'
        ? Math.max(0, Math.min(1, definition.placement.maxSlope))
        : 1,
    maxInstancesPerColumn:
      typeof definition?.placement?.maxInstancesPerColumn === 'number'
        ? Math.max(1, Math.floor(definition.placement.maxInstancesPerColumn))
        : 1,
    jitterRadius:
      typeof definition?.placement?.jitterRadius === 'number'
        ? Math.max(0, definition.placement.jitterRadius)
        : null,
    minHeight:
      typeof definition?.placement?.minHeight === 'number'
        ? definition.placement.minHeight
        : null,
    maxHeight:
      typeof definition?.placement?.maxHeight === 'number'
        ? definition.placement.maxHeight
        : null,
    minMoisture:
      typeof definition?.placement?.minMoisture === 'number'
        ? definition.placement.minMoisture
        : null,
    maxMoisture:
      typeof definition?.placement?.maxMoisture === 'number'
        ? definition.placement.maxMoisture
        : null,
    minTemperature:
      typeof definition?.placement?.minTemperature === 'number'
        ? definition.placement.minTemperature
        : null,
    maxTemperature:
      typeof definition?.placement?.maxTemperature === 'number'
        ? definition.placement.maxTemperature
        : null,
    requiresUnderwater: Boolean(definition?.placement?.requiresUnderwater),
    forbidUnderwater: Boolean(definition?.placement?.forbidUnderwater),
    requiresWaterProximity: Boolean(
      definition?.placement?.requiresWaterProximity,
    ),
    waterProximityRadius:
      typeof definition?.placement?.waterProximityRadius === 'number'
        ? Math.max(0, definition.placement.waterProximityRadius)
        : null,
    onlyOnShore: Boolean(definition?.placement?.onlyOnShore),
    forbidShore: Boolean(definition?.placement?.forbidShore),
  };


  let collisionMode = null;
  if (typeof definition?.collision === 'string') {
    collisionMode = definition.collision.toLowerCase();
  } else if (typeof definition?.collision?.mode === 'string') {
    collisionMode = definition.collision.mode.toLowerCase();
  }
  if (collisionMode && !['auto', 'solid', 'none', 'soft'].includes(collisionMode)) {
    throw new Error(
      `Unsupported collision mode "${collisionMode}" in voxel object definition at ${path}.`,
    );
  }

  const normalizedCollision = collisionMode || 'auto';


  const boundingBox = computeBoundingBox(voxels, definition.voxelScale);

  return {
    id,
    label: typeof definition.label === 'string' ? definition.label : id,
    description:
      typeof definition.description === 'string' ? definition.description : '',
    author: typeof definition.author === 'string' ? definition.author : 'unknown',
    category,
    voxelScale: definition.voxelScale,
    attachment,
    placement,
    voxels,
    boundingBox,

    collision: { mode: normalizedCollision },

    path,
    raw: definition,
  };
}

const voxelObjectLibrary = new Map();
const voxelObjectsByCategory = new Map();

Object.entries(voxelObjectModules).forEach(([path, module]) => {
  const definition = normalizeDefinition(path, module);
  voxelObjectLibrary.set(definition.id, definition);
  if (!voxelObjectsByCategory.has(definition.category)) {
    voxelObjectsByCategory.set(definition.category, []);
  }
  voxelObjectsByCategory.get(definition.category).push(definition);
});

voxelObjectsByCategory.forEach((list) => list.sort((a, b) => a.id.localeCompare(b.id)));

export function getVoxelObjectById(id) {
  return voxelObjectLibrary.get(id) ?? null;
}

export function getVoxelObjectsByCategory(category) {
  return voxelObjectsByCategory.get(category) ?? [];
}

export function getAllVoxelObjects() {
  return Array.from(voxelObjectLibrary.values());
}

export function getVoxelObjectCategories() {
  return Array.from(voxelObjectsByCategory.keys());
}

export function isVoxelObjectAllowedInBiome(object, biome) {
  if (!object) {
    return false;
  }
  if (!biome) {
    return true;
  }
  if (object.placement.biomes && object.placement.biomes.length > 0) {
    if (object.placement.biomes.includes(biome.id)) {
      return true;
    }
    return false;
  }
  if (object.placement.tags && object.placement.tags.length > 0) {
    const biomeTags = Array.isArray(biome.tags) ? biome.tags : [];
    return object.placement.tags.some((tag) => biomeTags.includes(tag));
  }
  return true;
}

export function getWeightedVoxelObject(category, biome, randomValue) {
  const candidates = getVoxelObjectsByCategory(category).filter((object) =>
    isVoxelObjectAllowedInBiome(object, biome),
  );
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const totalWeight = candidates.reduce(
    (sum, object) => sum + (object.placement.weight || 1),
    0,
  );
  if (totalWeight <= 0) {
    return candidates[0];
  }
  const clampedRandom = Math.max(0, Math.min(1, randomValue));
  let threshold = clampedRandom * totalWeight;
  for (const object of candidates) {
    threshold -= object.placement.weight || 1;
    if (threshold <= 0) {
      return object;
    }
  }
  return candidates[candidates.length - 1];
}

