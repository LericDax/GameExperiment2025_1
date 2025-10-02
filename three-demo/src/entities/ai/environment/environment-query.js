const clamp01 = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(1, Math.max(0, numeric));
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const resolveVector = (input) => {
  if (!input) {
    return { x: 0, y: 0, z: 0 };
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
      return resolveVector(input.position);
    }
    if (input.entity && input.entity.position) {
      return resolveVector(input.entity.position);
    }
    if (input.entity && input.entity.root && input.entity.root.position) {
      return resolveVector(input.entity.root.position);
    }
    if (input.root && input.root.position) {
      return resolveVector(input.root.position);
    }
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return { x: input, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: 0 };
};

const distance2D = (a, b) => {
  const ax = toNumber(a?.x);
  const az = toNumber(a?.z);
  const bx = toNumber(b?.x);
  const bz = toNumber(b?.z);
  return Math.hypot(ax - bx, az - bz);
};

const resolvePositionFromSource = (source) => {
  if (!source) {
    return null;
  }
  if (source.position) {
    return resolveVector(source.position);
  }
  if (source.entity?.root?.position) {
    return resolveVector(source.entity.root.position);
  }
  if (source.entity?.position) {
    return resolveVector(source.entity.position);
  }
  if (source.root?.position) {
    return resolveVector(source.root.position);
  }
  if (Array.isArray(source)) {
    return resolveVector(source);
  }
  if (typeof source === 'object' && ('x' in source || 'z' in source)) {
    return resolveVector(source);
  }
  return null;
};

export function getTerrainHeight(context, position, options = {}) {
  const { x, z } = resolveVector(position ?? context?.entity?.root?.position ?? null);
  const explicit = options.terrainHeight ?? context?.terrainHeight;
  if (typeof explicit === 'function') {
    const value = explicit(x, z);
    return Number.isFinite(value) ? value : null;
  }
  const dependencies = context?.dependencies ?? {};
  if (typeof dependencies.terrainHeight === 'function') {
    const value = dependencies.terrainHeight(x, z);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  const chunkManager = options.chunkManager ?? dependencies.chunkManager;
  if (chunkManager) {
    if (typeof chunkManager.sampleColumnHeight === 'function') {
      const value = chunkManager.sampleColumnHeight(x, z);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    if (typeof chunkManager.getColumnHeight === 'function') {
      const value = chunkManager.getColumnHeight(x, z);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  if (typeof options.fallback === 'number') {
    return options.fallback;
  }
  return null;
}

export function getLightLevel(context, position, options = {}) {
  const environment = context?.environment ?? {};
  const sampleFunctions = [
    environment.sampleLightAt,
    environment.lightProbe?.sample,
    context?.percepts?.sampleLightAt,
    options.sampleLightAt,
  ].filter((fn) => typeof fn === 'function');

  const targetPosition = position ?? context?.entity?.root?.position ?? null;
  for (const sampler of sampleFunctions) {
    try {
      const sample = sampler(targetPosition, context, options);
      if (Number.isFinite(sample)) {
        return clamp01(sample);
      }
    } catch (error) {
      console.warn('environment-query: light sampler failed', error);
    }
  }

  const lightSources = [
    environment.lightLevel,
    context?.percepts?.lightLevel,
    context?.timeOfDay?.lightLevel,
    context?.timeOfDay?.normalized,
  ];
  for (const value of lightSources) {
    if (Number.isFinite(value)) {
      return clamp01(value);
    }
  }

  if (context?.timeOfDay?.normalized !== undefined) {
    const normalized = clamp01(context.timeOfDay.normalized);
    const daylight = normalized <= 0.5 ? normalized * 2 : (1 - normalized) * 2;
    return clamp01(daylight);
  }

  if (Number.isFinite(options.fallback)) {
    return clamp01(options.fallback);
  }

  return 0.5;
}

const collectEntitiesFromContext = (context, options = {}) => {
  const sources = [];
  if (Array.isArray(options.entities)) {
    sources.push(...options.entities);
  }
  if (Array.isArray(context?.percepts?.nearbyEntities)) {
    sources.push(...context.percepts.nearbyEntities);
  }
  if (Array.isArray(context?.environment?.nearbyEntities)) {
    sources.push(...context.environment.nearbyEntities);
  }
  const manager = context?.dependencies?.entityManager ?? options.entityManager;
  if (manager?.getEntities) {
    try {
      sources.push(...(manager.getEntities() ?? []));
    } catch (error) {
      console.warn('environment-query: entityManager.getEntities failed', error);
    }
  }
  return sources;
};

const normalizeEntityRecord = (source) => {
  if (!source) {
    return null;
  }
  if (source.entity) {
    const position = resolvePositionFromSource(source);
    return position
      ? {
          id: source.id ?? source.entity?.id ?? source.entity?.name ?? null,
          position,
          data: source.entity,
        }
      : null;
  }
  const position = resolvePositionFromSource(source);
  if (!position) {
    return null;
  }
  return {
    id: source.id ?? source.name ?? null,
    position,
    data: source,
  };
};

export function findNearbyEntities(context, position, options = {}) {
  const origin = resolveVector(position ?? context?.entity?.root?.position ?? context?.entity?.position ?? null);
  const radius = Number.isFinite(options.radius) ? Math.max(0, options.radius) : 10;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : null;
  const filter = typeof options.filter === 'function' ? options.filter : null;

  const rawEntities = collectEntitiesFromContext(context, options);
  const results = [];
  const seen = new Set();

  rawEntities.forEach((candidate) => {
    const normalized = normalizeEntityRecord(candidate);
    if (!normalized) {
      return;
    }
    const { id, position: candidatePosition } = normalized;
    if (id && seen.has(id)) {
      return;
    }
    const distance = distance2D(origin, candidatePosition);
    if (Number.isFinite(radius) && distance > radius) {
      return;
    }
    if (filter && filter(normalized.data ?? candidate, { distance, origin }) === false) {
      return;
    }
    if (id) {
      seen.add(id);
    }
    results.push({
      id: normalized.id,
      position: candidatePosition,
      entity: normalized.data ?? candidate,
      distance,
    });
  });

  results.sort((a, b) => a.distance - b.distance);

  if (limit && results.length > limit) {
    return results.slice(0, limit);
  }

  return results;
}

const collectResourceNodes = (context, options = {}) => {
  const nodes = [];
  if (Array.isArray(options.nodes)) {
    nodes.push(...options.nodes);
  }
  if (Array.isArray(context?.environment?.resourceNodes)) {
    nodes.push(...context.environment.resourceNodes);
  }
  if (Array.isArray(context?.percepts?.resourceNodes)) {
    nodes.push(...context.percepts.resourceNodes);
  }
  const locator = context?.dependencies?.resourceLocator ?? options.resourceLocator;
  if (locator?.findNodes) {
    try {
      nodes.push(...(locator.findNodes(options) ?? []));
    } catch (error) {
      console.warn('environment-query: resourceLocator.findNodes failed', error);
    }
  }
  return nodes;
};

const normalizeResourceNode = (node) => {
  if (!node) {
    return null;
  }
  const position = resolvePositionFromSource(node);
  if (!position) {
    return null;
  }
  return {
    id: node.id ?? node.key ?? null,
    type: node.type ?? node.resource ?? null,
    amount: node.amount ?? node.quantity ?? null,
    position,
    data: node,
  };
};

export function findResourceNodes(context, position, options = {}) {
  const origin = resolveVector(position ?? context?.entity?.root?.position ?? context?.entity?.position ?? null);
  const radius = Number.isFinite(options.radius) ? Math.max(0, options.radius) : 32;
  const allowedTypes = Array.isArray(options.types)
    ? new Set(options.types.map((type) => `${type}`))
    : options.types instanceof Set
    ? options.types
    : null;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : null;

  const nodes = collectResourceNodes(context, options);
  const results = [];

  nodes.forEach((node) => {
    const normalized = normalizeResourceNode(node);
    if (!normalized) {
      return;
    }
    if (allowedTypes && normalized.type && !allowedTypes.has(normalized.type)) {
      return;
    }
    const distance = distance2D(origin, normalized.position);
    if (Number.isFinite(radius) && distance > radius) {
      return;
    }
    results.push({
      id: normalized.id,
      type: normalized.type,
      amount: normalized.amount,
      position: normalized.position,
      node: normalized.data,
      distance,
    });
  });

  results.sort((a, b) => a.distance - b.distance);

  if (limit && results.length > limit) {
    return results.slice(0, limit);
  }

  return results;
}

export default {
  getTerrainHeight,
  getLightLevel,
  findNearbyEntities,
  findResourceNodes,
};
