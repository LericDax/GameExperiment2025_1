const NON_OCCLUDING_FALLBACK_TYPES = new Set(['cryoshard_glass']);

export const isBlockOccluding = (entry, blockMaterials) => {
  if (!entry || entry.collisionMode !== 'solid') {
    return false;
  }

  const { type } = entry;
  if (!type) {
    return false;
  }

  const material = blockMaterials?.[type];
  if (!material) {
    return !NON_OCCLUDING_FALLBACK_TYPES.has(type);
  }

  if (material.transparent === true) {
    return false;
  }

  if (typeof material.opacity === 'number' && material.opacity < 1) {
    return false;
  }

  if (material.depthWrite === false) {
    return false;
  }

  return true;
};

export const __blockOcclusionInternals = {
  NON_OCCLUDING_FALLBACK_TYPES,
};
