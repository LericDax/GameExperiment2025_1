const DEFAULT_OWNER = null;

function resolveOwner(entry, decorationMeta, metadata) {
  if (entry && entry.ownerPlacementKey !== undefined) {
    return entry.ownerPlacementKey;
  }
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
