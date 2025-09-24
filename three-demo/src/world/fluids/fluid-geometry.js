const FACE_DIRECTIONS = [
  { key: 'px', dx: 1, dz: 0, normal: [1, 0, 0] },
  { key: 'nx', dx: -1, dz: 0, normal: [-1, 0, 0] },
  { key: 'pz', dx: 0, dz: 1, normal: [0, 0, 1] },
  { key: 'nz', dx: 0, dz: -1, normal: [0, 0, -1] },
];

export function buildFluidGeometry({ THREE, columns }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const surfaceTypes = [];
  const flowDirections = [];
  const flowStrengths = [];
  const edgeFoam = [];
  const depths = [];
  const shorelines = [];

  const pushVertex = (
    vertex,
    normal,
    uv,
    color,
    surfaceType,
    flowDir,
    flowStrength,
    foam,
    depthValue,
    shorelineValue,
  ) => {
    positions.push(vertex.x, vertex.y, vertex.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(uv.x, uv.y);
    colors.push(color.r, color.g, color.b);
    surfaceTypes.push(surfaceType);
    flowDirections.push(flowDir.x, flowDir.y);
    flowStrengths.push(flowStrength);
    edgeFoam.push(foam);
    depths.push(depthValue);
    shorelines.push(shorelineValue);
  };

  const tempColor = new THREE.Color();

  const topFace = (column) => {
    const { x, z, surfaceY, color, flowStrength, foamAmount, depth, shoreline } = column;
    const left = x - 0.5;
    const right = x + 0.5;
    const front = z + 0.5;
    const back = z - 0.5;
    const normal = new THREE.Vector3(0, 1, 0);
    const flowDir = column.flowDirection ?? new THREE.Vector2(0, 0);
    const strength = column.flowStrength ?? 0;
    const foam = foamAmount ?? 0;
    const depthValue = depth ?? Math.max(0.05, surfaceY - column.bottomY);
    const shorelineValue = shoreline ?? 0;

    const tint = tempColor.copy(color);

    pushVertex(
      new THREE.Vector3(left, surfaceY, back),
      normal,
      new THREE.Vector2(0, 0),
      tint,
      0,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      new THREE.Vector3(right, surfaceY, back),
      normal,
      new THREE.Vector2(1, 0),
      tint,
      0,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      new THREE.Vector3(right, surfaceY, front),
      normal,
      new THREE.Vector2(1, 1),
      tint,
      0,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );

    pushVertex(
      new THREE.Vector3(left, surfaceY, back),
      normal,
      new THREE.Vector2(0, 0),
      tint,
      0,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      new THREE.Vector3(right, surfaceY, front),
      normal,
      new THREE.Vector2(1, 1),
      tint,
      0,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      new THREE.Vector3(left, surfaceY, front),
      normal,
      new THREE.Vector2(0, 1),
      tint,
      0,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
  };

  const sideFace = (column, neighborInfo, direction) => {
    const { x, z, surfaceY, bottomY, color, depth, shoreline } = column;
    const flowDir = column.flowDirection ?? new THREE.Vector2(0, 0);
    const strength = column.flowStrength ?? 0.15;
    const foam = Math.max(column.foamAmount ?? 0, neighborInfo.foamHint ?? 0);
    const depthValue = depth ?? Math.max(0.05, surfaceY - bottomY);
    const shorelineValue = Math.max(
      shoreline ?? 0,
      neighborInfo.foamHint ? Math.min(1, neighborInfo.foamHint * 0.75) : 0,
    );

    const dropSurface = surfaceY;
    const dropBottom = Math.min(bottomY, neighborInfo.bottomY);
    if (!(dropSurface > dropBottom + 0.01)) {
      return;
    }

    const sideColor = tempColor.copy(color).lerp(new THREE.Color('#5bd5ff'), 0.2);
    const normal = new THREE.Vector3(...direction.normal);
    const half = 0.5;
    let verts = [];
    if (direction.dx !== 0) {
      const baseX = x + direction.dx * half;
      const zMin = z - half;
      const zMax = z + half;
      if (direction.dx > 0) {
        verts = [
          new THREE.Vector3(baseX, dropSurface, zMin),
          new THREE.Vector3(baseX, dropBottom, zMin),
          new THREE.Vector3(baseX, dropBottom, zMax),
          new THREE.Vector3(baseX, dropSurface, zMax),
        ];
      } else {
        verts = [
          new THREE.Vector3(baseX, dropSurface, zMax),
          new THREE.Vector3(baseX, dropBottom, zMax),
          new THREE.Vector3(baseX, dropBottom, zMin),
          new THREE.Vector3(baseX, dropSurface, zMin),
        ];
      }
    } else {
      const baseZ = z + direction.dz * half;
      const xMin = x - half;
      const xMax = x + half;
      if (direction.dz > 0) {
        verts = [
          new THREE.Vector3(xMin, dropSurface, baseZ),
          new THREE.Vector3(xMin, dropBottom, baseZ),
          new THREE.Vector3(xMax, dropBottom, baseZ),
          new THREE.Vector3(xMax, dropSurface, baseZ),
        ];
      } else {
        verts = [
          new THREE.Vector3(xMax, dropSurface, baseZ),
          new THREE.Vector3(xMax, dropBottom, baseZ),
          new THREE.Vector3(xMin, dropBottom, baseZ),
          new THREE.Vector3(xMin, dropSurface, baseZ),
        ];
      }
    }

    const surfaceType = 1;

    pushVertex(
      verts[0],
      normal,
      new THREE.Vector2(0, 0),
      sideColor,
      surfaceType,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      verts[1],
      normal,
      new THREE.Vector2(0, 1),
      sideColor,
      surfaceType,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      verts[2],
      normal,
      new THREE.Vector2(1, 1),
      sideColor,
      surfaceType,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );

    pushVertex(
      verts[0],
      normal,
      new THREE.Vector2(0, 0),
      sideColor,
      surfaceType,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      verts[2],
      normal,
      new THREE.Vector2(1, 1),
      sideColor,
      surfaceType,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
    pushVertex(
      verts[3],
      normal,
      new THREE.Vector2(1, 0),
      sideColor,
      surfaceType,
      flowDir,
      strength,
      foam,
      depthValue,
      shorelineValue,
    );
  };

  columns.forEach((column) => {
    topFace(column);
    FACE_DIRECTIONS.forEach((direction) => {
      const neighborInfo = column.neighbors?.[direction.key];
      if (!neighborInfo) {
        return;
      }
      const neighborSurface = neighborInfo.surfaceY ?? column.surfaceY;
      const hasDrop = neighborSurface < column.surfaceY - 0.05;
      if (!hasDrop) {
        return;
      }
      sideFace(column, neighborInfo, direction);
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute(
    'surfaceType',
    new THREE.Float32BufferAttribute(surfaceTypes, 1),
  );
  geometry.setAttribute(
    'flowDirection',
    new THREE.Float32BufferAttribute(flowDirections, 2),
  );
  geometry.setAttribute(
    'flowStrength',
    new THREE.Float32BufferAttribute(flowStrengths, 1),
  );
  geometry.setAttribute('edgeFoam', new THREE.Float32BufferAttribute(edgeFoam, 1));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute('shoreline', new THREE.Float32BufferAttribute(shorelines, 1));

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
