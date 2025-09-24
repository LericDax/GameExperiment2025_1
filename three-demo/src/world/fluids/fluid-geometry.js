const FACE_DIRECTIONS = [
  { key: 'px', dx: 1, dz: 0, normal: [1, 0, 0] },
  { key: 'nx', dx: -1, dz: 0, normal: [-1, 0, 0] },
  { key: 'pz', dx: 0, dz: 1, normal: [0, 0, 1] },
  { key: 'nz', dx: 0, dz: -1, normal: [0, 0, -1] },
];

export function buildFluidGeometry({ THREE, columns }) {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const issues = [];

  columns.forEach((column) => {
    const key = column?.key ?? `${column?.x ?? 0}|${column?.z ?? 0}`;
    if (!(column.color instanceof THREE.Color)) {
      try {
        column.color = new THREE.Color(column.color ?? '#3a79c5');
      } catch (error) {
        column.color = new THREE.Color('#3a79c5');
        issues.push({ key, issue: 'color reset to default' });
      }
    }
    if (!(column.flowDirection instanceof THREE.Vector2)) {
      column.flowDirection = new THREE.Vector2(0, 0);
      issues.push({ key, issue: 'flowDirection reset' });
    } else {
      const x = isFiniteNumber(column.flowDirection.x)
        ? clamp(column.flowDirection.x, -1, 1)
        : 0;
      const y = isFiniteNumber(column.flowDirection.y)
        ? clamp(column.flowDirection.y, -1, 1)
        : 0;
      column.flowDirection.set(x, y);
      const length = column.flowDirection.length();
      if (length > 1) {
        column.flowDirection.multiplyScalar(1 / length);
      }
      if (!isFiniteNumber(column.flowDirection.x) || !isFiniteNumber(column.flowDirection.y)) {
        column.flowDirection.set(0, 0);
        issues.push({ key, issue: 'flowDirection contained NaN' });
      }
    }
    column.flowStrength = clamp(
      isFiniteNumber(column.flowStrength) ? column.flowStrength : column.flowDirection.length(),
      0,
      1,
    );
    column.foamAmount = clamp(isFiniteNumber(column.foamAmount) ? column.foamAmount : 0, 0, 1);
    column.depth = Math.max(
      0.05,
      isFiniteNumber(column.depth)
        ? column.depth
        : isFiniteNumber(column.surfaceY) && isFiniteNumber(column.bottomY)
        ? column.surfaceY - column.bottomY
        : 0.05,
    );
    column.shoreline = clamp(
      isFiniteNumber(column.shoreline) ? column.shoreline : column.foamAmount,
      0,
      1,
    );

    const bottomY = isFiniteNumber(column.bottomY)
      ? column.bottomY
      : isFiniteNumber(column.minY)
      ? column.minY
      : isFiniteNumber(column.surfaceY)
      ? column.surfaceY - column.depth
      : -0.5;
    if (!isFiniteNumber(column.bottomY) || column.bottomY !== bottomY) {
      column.bottomY = bottomY;
      issues.push({ key, issue: 'bottomY sanitized' });
    }
    const surfaceY = isFiniteNumber(column.surfaceY)
      ? column.surfaceY
      : isFiniteNumber(column.maxY)
      ? column.maxY
      : column.bottomY + column.depth;
    if (!isFiniteNumber(column.surfaceY) || column.surfaceY !== surfaceY) {
      column.surfaceY = surfaceY;
      issues.push({ key, issue: 'surfaceY sanitized' });
    }

    const sanitizedNeighbors = {};
    FACE_DIRECTIONS.forEach(({ key: neighborKey }) => {
      const neighborInfo = column.neighbors?.[neighborKey] ?? null;
      const neighborSurface = isFiniteNumber(neighborInfo?.surfaceY)
        ? neighborInfo.surfaceY
        : column.surfaceY;
      const neighborBottom = isFiniteNumber(neighborInfo?.bottomY)
        ? neighborInfo.bottomY
        : column.bottomY;
      const foamHint = clamp(
        isFiniteNumber(neighborInfo?.foamHint) ? neighborInfo.foamHint : 0,
        0,
        16,
      );
      if (!neighborInfo) {
        issues.push({ key, issue: `missing neighbor ${neighborKey}` });
      } else if (
        neighborSurface !== neighborInfo.surfaceY ||
        neighborBottom !== neighborInfo.bottomY ||
        foamHint !== neighborInfo.foamHint
      ) {
        issues.push({ key, issue: `neighbor ${neighborKey} sanitized` });
      }
      sanitizedNeighbors[neighborKey] = {
        hasFluid: Boolean(neighborInfo?.hasFluid),
        surfaceY: neighborSurface,
        bottomY: neighborBottom,
        foamHint,
      };
    });
    column.neighbors = sanitizedNeighbors;
  });

  if (issues.length > 0) {
    const sample = issues.slice(0, 5);
    console.warn(
      `[fluid warning] Sanitized ${issues.length} fluid column attribute issue(s). Sample:`,
      sample,
    );
  }

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
