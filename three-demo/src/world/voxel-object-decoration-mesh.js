const DEFAULT_OWNER = null;

// Decoration mesh templates are cached per voxel object definition so the
// expensive nanovoxel placement math only runs once. The key combines the
// object id with any known seed modifiers (future procedural variants can
// extend this without changing the cache layout).
const decorationMeshCache = new WeakMap();

function extractSeedModifier(object) {
  if (!object || typeof object !== 'object') {
    return null;
  }
  if (typeof object.seedModifier === 'string' || typeof object.seedModifier === 'number') {
    return object.seedModifier;
  }
  if (typeof object.seed === 'string' || typeof object.seed === 'number') {
    return object.seed;
  }
  const raw = object.raw ?? null;
  if (raw && (typeof raw.seedModifier === 'string' || typeof raw.seedModifier === 'number')) {
    return raw.seedModifier;
  }
  if (raw && (typeof raw.seed === 'string' || typeof raw.seed === 'number')) {
    return raw.seed;
  }
  return null;
}

function buildCacheKey(object) {
  const id = typeof object?.id === 'string' && object.id.length > 0 ? object.id : 'object';
  const seed = extractSeedModifier(object);
  return seed !== null && seed !== undefined ? `${id}|${seed}` : id;
}

function cloneVectorLike(value, fallback = 0) {
  if (!value || typeof value !== 'object') {
    return { x: fallback, y: fallback, z: fallback };
  }
  const x = typeof value.x === 'number' ? value.x : fallback;
  const y = typeof value.y === 'number' ? value.y : fallback;
  const z = typeof value.z === 'number' ? value.z : fallback;
  return { x, y, z };
}

export function cloneDecorationOptions(options = {}) {
  const cloned = { ...options };
  if (options.scale && typeof options.scale === 'object') {
    cloned.scale = { ...options.scale };
  }
  if (options.visualScale && typeof options.visualScale === 'object') {
    cloned.visualScale = { ...options.visualScale };
  }
  if (options.visualOffset && typeof options.visualOffset === 'object') {
    cloned.visualOffset = { ...options.visualOffset };
  }
  if (options.metadata && typeof options.metadata === 'object') {
    cloned.metadata = { ...options.metadata };
  }
  return cloned;
}

function cloneBlockPlacement(block) {
  if (!block) {
    return null;
  }
  return {
    type: block.type,
    position: cloneVectorLike(block.position, 0),
    scale: cloneVectorLike(block.scale, 1),
    visualScale: cloneVectorLike(block.visualScale ?? block.scale, 1),
    visualOffset: cloneVectorLike(block.visualOffset, 0),
    tint: block.tint ?? null,
    destructible: block.destructible,
    metadata: block.metadata ? { ...block.metadata } : null,
    collisionMode: block.collisionMode,
    voxelIndex: block.voxelIndex,
    sourceObjectId: block.sourceObjectId ?? null,
    key: block.key ?? null,
  };
}

function cloneDecorationPlacement(decoration, index, cacheKey) {
  if (!decoration) {
    return null;
  }
  const options = cloneDecorationOptions(decoration.options ?? {});
  const fallbackKey = `${cacheKey}|decor|${index}`;
  const baseKey =
    typeof options.key === 'string' && options.key.length > 0 ? options.key : fallbackKey;

  return {
    type: decoration.type,
    position: cloneVectorLike(decoration.position, 0),
    options,
    baseKey,
  };
}

function buildDecorationMeshTemplate(object, placements) {
  if (!placements) {
    return null;
  }

  const cacheKey = buildCacheKey(object);
  const blocks = Array.isArray(placements.blocks)
    ? placements.blocks
        .map((block) => cloneBlockPlacement(block))
        .filter((block) => block !== null)
    : [];
  const decorations = Array.isArray(placements.decorations)
    ? placements.decorations
        .map((decoration, index) => cloneDecorationPlacement(decoration, index, cacheKey))
        .filter((entry) => entry !== null)
    : [];

  return {
    cacheKey,
    placements: {
      id: placements.id ?? object?.id ?? null,
      groundOffset: placements.groundOffset,
      blocks,
      decorations,
    },
    decorations,
  };
}

export function getDecorationMeshTemplate(object, placementsFactory) {
  if (!object) {
    return null;
  }
  if (decorationMeshCache.has(object)) {
    return decorationMeshCache.get(object);
  }
  if (typeof placementsFactory !== 'function') {
    return null;
  }
  const placements = placementsFactory();
  if (!placements) {
    return null;
  }
  const template = buildDecorationMeshTemplate(object, placements);
  if (template) {
    decorationMeshCache.set(object, template);
  }
  return template;
}

export function invalidateDecorationMeshCache(object) {
  if (!object) {
    return;
  }
  decorationMeshCache.delete(object);
}

function resolveOwner(entry, decorationMeta, metadata) {
  if (decorationMeta && decorationMeta.owner !== undefined) {
    return decorationMeta.owner;
  }
  if (metadata && metadata.owner !== undefined) {
    return metadata.owner;
  }
  if (entry && entry.sourceObjectId !== undefined) {
    return entry.sourceObjectId;
  }
  return DEFAULT_OWNER;
}

function resolveDestructible(entry, decorationMeta, metadata) {
  if (decorationMeta && typeof decorationMeta.destructible === 'boolean') {
    return decorationMeta.destructible;
  }
  if (metadata && typeof metadata.destructible === 'boolean') {
    return metadata.destructible;
  }
  if (typeof entry?.destructible === 'boolean') {
    return entry.destructible;
  }
  return true;
}

function resolveGroupKey(entry, decorationMeta, metadata, index) {
  const candidates = [];
  if (decorationMeta) {
    if (typeof decorationMeta.key === 'string') {
      candidates.push(decorationMeta.key);
    }
    if (typeof decorationMeta.groupKey === 'string') {
      candidates.push(decorationMeta.groupKey);
    }
    if (typeof decorationMeta.id === 'string') {
      candidates.push(decorationMeta.id);
    }
  }
  if (metadata) {
    if (typeof metadata.decorationGroupKey === 'string') {
      candidates.push(metadata.decorationGroupKey);
    }
    if (typeof metadata.groupKey === 'string') {
      candidates.push(metadata.groupKey);
    }
  }
  if (typeof entry?.key === 'string' && entry.key.length > 0) {
    candidates.push(entry.key);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const owner = resolveOwner(entry, decorationMeta, metadata) ?? 'decoration';
  const position = entry?.position ?? {};
  const positionKey = `${position.x ?? 0}:${position.y ?? 0}:${position.z ?? 0}`;
  const typeKey = entry?.type ?? 'unknown';
  return `${owner}:${typeKey}:${positionKey}:${index}`;
}

function ensureGroup(groups, key, owner, destructible) {
  let group = groups.get(key);
  if (!group) {
    group = {
      key,
      owner,
      destructible,
      entryIndices: [],
    };
    groups.set(key, group);
    return group;
  }
  if (group.owner === null && owner !== null && owner !== undefined) {
    group.owner = owner;
  }
  if (group.owner === undefined && owner !== undefined) {
    group.owner = owner;
  }
  if (typeof group.destructible !== 'boolean') {
    group.destructible = !!destructible;
  }
  return group;
}

export function createDecorationMeshBatches(entries = []) {
  const groups = new Map();

  entries.forEach((entry, index) => {
    const metadata = entry?.metadata ?? null;
    const decorationMeta = metadata?.decorationGroup ?? metadata?.decoration ?? metadata?.group ?? null;
    const owner = resolveOwner(entry, decorationMeta, metadata);
    const destructible = resolveDestructible(entry, decorationMeta, metadata);
    const key = resolveGroupKey(entry, decorationMeta, metadata, index);
    const group = ensureGroup(groups, key, owner, destructible);
    group.entryIndices.push(index);
    if (typeof destructible === 'boolean') {
      group.destructible = destructible;
    }
  });

  return {
    groups: Array.from(groups.values()),
  };
}
