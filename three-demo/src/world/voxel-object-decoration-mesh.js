export function createDecorationMeshBatches({ THREE, placements = [], origin = null } = {}) {
  if (!THREE) {
    throw new Error('createDecorationMeshBatches requires a THREE instance');
  }
  if (!placements || placements.length === 0) {
    return [];
  }

  const baseGeometry = new THREE.BoxGeometry(1, 1, 1);
  const basePosition = baseGeometry.getAttribute('position');
  const baseNormal = baseGeometry.getAttribute('normal');
  const baseUv = baseGeometry.getAttribute('uv');
  const baseIndex = baseGeometry.getIndex();

  const originVector = new THREE.Vector3(
    origin?.x ?? placements[0].worldX ?? 0,
    origin?.y ?? placements[0].worldY ?? 0,
    origin?.z ?? placements[0].worldZ ?? 0,
  );

  const defaultQuaternion = new THREE.Quaternion();
  const transformMatrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const visualPosition = new THREE.Vector3();

  const resolveScaleVector = (option) => {
    if (!option && option !== 0) {
      return new THREE.Vector3(1, 1, 1);
    }
    if (option.isVector3) {
      return option.clone();
    }
    if (typeof option === 'number') {
      return new THREE.Vector3(option, option, option);
    }
    if (Array.isArray(option)) {
      const [sx = 1, sy = 1, sz = 1] = option;
      return new THREE.Vector3(sx, sy, sz);
    }
    if (typeof option === 'object') {
      const sx =
        typeof option.x === 'number'
          ? option.x
          : typeof option.scaleX === 'number'
          ? option.scaleX
          : 1;
      const sy =
        typeof option.y === 'number'
          ? option.y
          : typeof option.scaleY === 'number'
          ? option.scaleY
          : 1;
      const sz =
        typeof option.z === 'number'
          ? option.z
          : typeof option.scaleZ === 'number'
          ? option.scaleZ
          : 1;
      return new THREE.Vector3(sx, sy, sz);
    }
    return new THREE.Vector3(1, 1, 1);
  };

  const resolveOffsetVector = (option) => {
    if (!option && option !== 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    if (option.isVector3) {
      return option.clone();
    }
    if (typeof option === 'number') {
      return new THREE.Vector3(option, option, option);
    }
    if (Array.isArray(option)) {
      const [ox = 0, oy = 0, oz = 0] = option;
      return new THREE.Vector3(ox, oy, oz);
    }
    if (typeof option === 'object') {
      const ox =
        typeof option.x === 'number'
          ? option.x
          : typeof option.offsetX === 'number'
          ? option.offsetX
          : 0;
      const oy =
        typeof option.y === 'number'
          ? option.y
          : typeof option.offsetY === 'number'
          ? option.offsetY
          : 0;
      const oz =
        typeof option.z === 'number'
          ? option.z
          : typeof option.offsetZ === 'number'
          ? option.offsetZ
          : 0;
      return new THREE.Vector3(ox, oy, oz);
    }
    return new THREE.Vector3(0, 0, 0);
  };

  const grouped = new Map();

  placements.forEach((placement) => {
    const type = placement.type;
    if (!type) {
      return;
    }
    if (!grouped.has(type)) {
      grouped.set(type, {
        positions: [],
        normals: [],
        uvs: [],
        indices: [],
        segments: [],
        vertexCount: 0,
      });
    }
    const group = grouped.get(type);
    const options = placement.options ?? {};
    const visualScale = resolveScaleVector(options.visualScale ?? options.scale);
    const offsetVector = resolveOffsetVector(options.visualOffset);
    visualPosition.set(placement.worldX ?? 0, placement.worldY ?? 0, placement.worldZ ?? 0);
    visualPosition.add(offsetVector);

    transformMatrix.compose(visualPosition, defaultQuaternion, visualScale);
    normalMatrix.getNormalMatrix(transformMatrix);

    const vertexStart = group.vertexCount;

    for (let i = 0; i < basePosition.count; i += 1) {
      vertex.set(basePosition.getX(i), basePosition.getY(i), basePosition.getZ(i));
      vertex.applyMatrix4(transformMatrix);
      vertex.sub(originVector);
      group.positions.push(vertex.x, vertex.y, vertex.z);

      normal.set(baseNormal.getX(i), baseNormal.getY(i), baseNormal.getZ(i));
      normal.applyMatrix3(normalMatrix).normalize();
      group.normals.push(normal.x, normal.y, normal.z);

      group.uvs.push(baseUv.getX(i), baseUv.getY(i));
    }

    for (let i = 0; i < baseIndex.count; i += 1) {
      group.indices.push(baseIndex.getX(i) + vertexStart);
    }

    group.segments.push({
      vertexStart,
      vertexCount: basePosition.count,
      tint: options.tint ?? null,
      worldPosition: {
        x: placement.worldX ?? originVector.x,
        y: placement.worldY ?? originVector.y,
        z: placement.worldZ ?? originVector.z,
      },
    });

    group.vertexCount += basePosition.count;
  });

  baseGeometry.dispose();

  return Array.from(grouped.entries()).map(([type, group]) => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(group.positions);
    const normals = new Float32Array(group.normals);
    const uvs = new Float32Array(group.uvs);
    const indices = new Uint32Array(group.indices);
    const biomeTints = new Float32Array(group.vertexCount * 3);
    biomeTints.fill(1);

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const tintAttribute = new THREE.Float32BufferAttribute(biomeTints, 3);
    tintAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('biomeTint', tintAttribute);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return {
      type,
      geometry,
      origin: {
        x: originVector.x,
        y: originVector.y,
        z: originVector.z,
      },
      segments: group.segments,
    };
  });
}
