const DEFAULT_MAX_DISTANCE = 16;

function computeMaterialVisibility(material) {
  if (!material) {
    return true;
  }
  if (Array.isArray(material)) {
    return material.some((entry) => entry && entry.visible !== false);
  }
  return material.visible !== false;
}

function toPlainVector(vector) {
  if (!vector) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function createHeadlessScanner({ THREE, scene, chunkManager }) {
  if (!THREE) {
    throw new Error('createHeadlessScanner requires a THREE instance.');
  }
  if (!scene) {
    throw new Error('createHeadlessScanner requires a scene reference.');
  }
  if (!chunkManager || typeof chunkManager.getBlockFromIntersection !== 'function') {
    throw new Error('createHeadlessScanner requires a chunk manager with getBlockFromIntersection.');
  }

  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();

  const buildDiagnostics = (intersection, blockInfo) => {
    const mesh = intersection?.object ?? null;
    const chunk = blockInfo?.chunk ?? null;
    const meshCount = typeof mesh?.count === 'number' ? mesh.count : null;
    const instanceId = typeof intersection.instanceId === 'number' ? intersection.instanceId : null;

    return {
      meshVisible: mesh?.visible !== false,
      materialVisible: computeMaterialVisibility(mesh?.material),
      instanceInRange:
        instanceId === null || meshCount === null ? true : instanceId >= 0 && instanceId < meshCount,
      meshCount,
      instanceId,
      chunkVisible: chunk?.group?.visible !== false,
      chunkKey: chunk?.key ?? null,
    };
  };

  const sanitizeBlockInfo = (blockInfo) => {
    if (!blockInfo?.entry) {
      return null;
    }
    const { entry, type } = blockInfo;
    const position = entry.position ?? null;
    return {
      key: entry.key ?? null,
      coordinateKey: entry.coordinateKey ?? null,
      type: type ?? entry.type ?? null,
      position: position
        ? { x: position.x ?? position[0] ?? 0, y: position.y ?? position[1] ?? 0, z: position.z ?? position[2] ?? 0 }
        : { x: 0, y: 0, z: 0 },
    };
  };

  const normalizeDistance = (distance) => {
    if (!Number.isFinite(distance) || distance <= 0) {
      return DEFAULT_MAX_DISTANCE;
    }
    return distance;
  };

  const castRay = ({ origin, direction, maxDistance, collectAll = false } = {}) => {
    if (!origin || typeof origin.x !== 'number' || typeof origin.y !== 'number' || typeof origin.z !== 'number') {
      throw new Error('Scanner requires an origin with numeric x, y, z.');
    }
    if (!direction || typeof direction.x !== 'number' || typeof direction.y !== 'number' || typeof direction.z !== 'number') {
      throw new Error('Scanner requires a direction with numeric x, y, z.');
    }

    rayOrigin.set(origin.x, origin.y, origin.z);
    rayDirection.set(direction.x, direction.y, direction.z);

    if (rayDirection.lengthSq() === 0) {
      throw new Error('Scan direction vector must be non-zero.');
    }

    rayDirection.normalize();
    const distance = normalizeDistance(maxDistance ?? DEFAULT_MAX_DISTANCE);
    raycaster.set(rayOrigin, rayDirection);
    raycaster.far = distance;

    const intersections = raycaster.intersectObjects(scene.children, true);
    const hits = [];

    for (const intersection of intersections) {
      if (!intersection) {
        continue;
      }
      const blockInfo = chunkManager.getBlockFromIntersection(intersection);
      if (!blockInfo) {
        continue;
      }
      const sanitizedBlock = sanitizeBlockInfo(blockInfo);
      if (!sanitizedBlock) {
        continue;
      }
      hits.push({
        block: sanitizedBlock,
        point: toPlainVector(intersection.point),
        distance: intersection.distance,
        diagnostics: buildDiagnostics(intersection, blockInfo),
      });
      if (!collectAll) {
        break;
      }
    }

    return {
      origin: toPlainVector(rayOrigin),
      direction: toPlainVector(rayDirection),
      maxDistance: distance,
      hits,
      hit: hits.length > 0 ? hits[0] : null,
    };
  };

  return {
    cast: castRay,
  };
}
