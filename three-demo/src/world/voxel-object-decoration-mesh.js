export function createDecorationMeshBatches(entries = [], { type: fallbackType } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { instancedEntries: [], batches: [] };
  }

  const instancedEntries = [];
  const grouped = new Map();

  entries.forEach((entry) => {
    if (!entry) {
      return;
    }

    const mode =
      typeof entry.destructibilityMode === 'string'
        ? entry.destructibilityMode
        : typeof entry.metadata?.decorationDestructibility === 'string'
        ? entry.metadata.decorationDestructibility
        : 'group';

    if (mode === 'individual') {
      instancedEntries.push(entry);
      return;
    }

    const ownerKey = entry.ownerKey ?? entry.metadata?.ownerKey ?? null;
    const groupType = entry.type ?? fallbackType ?? null;
    const groupKey = ownerKey
      ? `decor:${ownerKey}`
      : `decor:${groupType ?? 'unknown'}:${entry.key}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        type: groupType,
        ownerKey,
        entries: [],
        placementKeys: [],
        destructible: false,
      });
    }

    const group = grouped.get(groupKey);
    group.entries.push(entry);
    group.placementKeys.push(entry.key);
    if (entry.destructible !== false) {
      group.destructible = true;
    }
  });

  const batches = Array.from(grouped.entries()).map(([groupKey, group]) => ({
    type: group.type ?? fallbackType ?? null,
    entries: group.entries,
    groupKey,
    ownerKey: group.ownerKey,
    destructible: group.destructible,
    placementKeys: group.placementKeys,
  }));

  return { instancedEntries, batches };
}

export default createDecorationMeshBatches;
