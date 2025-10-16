export function pruneOccludedInstancedEntries({
  typeData,
  occludedEntries,
} = {}) {
  if (!(typeData instanceof Map)) {
    return;
  }
  if (!(occludedEntries instanceof Set) || occludedEntries.size === 0) {
    return;
  }

  typeData.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    const { entries, mesh, tintAttribute } = record;
    if (!Array.isArray(entries) || !mesh?.isInstancedMesh) {
      return;
    }

    const defaultTint = mesh.userData?.defaultTint ?? null;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < entries.length; readIndex += 1) {
      const entry = entries[readIndex];
      if (!entry || occludedEntries.has(entry)) {
        if (entry) {
          entry.index = -1;
          if (entry.mesh === mesh) {
            entry.mesh = null;
          }
          if (entry.tintAttribute === tintAttribute) {
            entry.tintAttribute = null;
          }
        }
        continue;
      }

      if (writeIndex !== readIndex) {
        entries[writeIndex] = entry;
      }
      entry.index = writeIndex;
      entry.mesh = mesh;
      if (tintAttribute) {
        entry.tintAttribute = tintAttribute;
      }

      if (entry.matrix) {
        mesh.setMatrixAt(writeIndex, entry.matrix);
      }

      if (tintAttribute) {
        const tint = entry.tintColor ?? defaultTint;
        const offset = writeIndex * 3;
        if (tint) {
          tintAttribute.array[offset] = tint.r;
          tintAttribute.array[offset + 1] = tint.g;
          tintAttribute.array[offset + 2] = tint.b;
        } else {
          tintAttribute.array[offset] = 1;
          tintAttribute.array[offset + 1] = 1;
          tintAttribute.array[offset + 2] = 1;
        }
      }

      writeIndex += 1;
    }

    if (writeIndex < entries.length) {
      entries.length = writeIndex;
    }

    mesh.count = writeIndex;
    mesh.instanceMatrix.needsUpdate = true;
    if (tintAttribute) {
      tintAttribute.needsUpdate = true;
    }
  });
}
