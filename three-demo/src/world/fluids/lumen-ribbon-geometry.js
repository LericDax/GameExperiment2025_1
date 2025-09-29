import { SURFACE_ROLES } from './fluid-geometry.js';

const DEFAULT_HALF_SPAN = 0.45;
const MIN_HEIGHT = 0.05;

export function buildLumenRibbonGeometry({ THREE, columns }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const surfaceTypes = [];
  const surfaceRoles = [];
  const flowDirections = [];
  const flowStrengths = [];
  const ribbonVectors = [];
  const auroraGlows = [];
  const ribbonHeightFractions = [];

  if (!Array.isArray(columns) || columns.length === 0) {
    return new THREE.BufferGeometry();
  }

  const tempColor = new THREE.Color('#4ef0ff');
  const tempVector2 = new THREE.Vector2();

  const pushVertex = (
    position,
    normal,
    uvX,
    uvY,
    color,
    surfaceType,
    surfaceRole,
    flowDir,
    flowStrength,
    ribbonDir,
    auroraGlow,
    heightFraction,
  ) => {
    positions.push(position.x, position.y, position.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(uvX, uvY);
    colors.push(color.r, color.g, color.b);
    surfaceTypes.push(surfaceType);
    surfaceRoles.push(surfaceRole);
    flowDirections.push(flowDir.x, flowDir.y);
    flowStrengths.push(flowStrength);
    ribbonVectors.push(ribbonDir.x, ribbonDir.y);
    auroraGlows.push(auroraGlow);
    ribbonHeightFractions.push(heightFraction);
  };

  const pushQuad = ({
    bottomLeft,
    bottomRight,
    topRight,
    topLeft,
    normal,
    color,
    surfaceType,
    flowDir,
    flowStrength,
    ribbonDir,
    auroraGlow,
    bottomFraction,
    topFraction,
    bottomRole,
    topRole,
  }) => {
    pushVertex(
      bottomLeft,
      normal,
      0,
      bottomFraction,
      color,
      surfaceType,
      bottomRole,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
      bottomFraction,
    );
    pushVertex(
      bottomRight,
      normal,
      1,
      bottomFraction,
      color,
      surfaceType,
      bottomRole,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
      bottomFraction,
    );
    pushVertex(
      topRight,
      normal,
      1,
      topFraction,
      color,
      surfaceType,
      topRole,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
      topFraction,
    );

    pushVertex(
      bottomLeft,
      normal,
      0,
      bottomFraction,
      color,
      surfaceType,
      bottomRole,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
      bottomFraction,
    );
    pushVertex(
      topRight,
      normal,
      1,
      topFraction,
      color,
      surfaceType,
      topRole,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
      topFraction,
    );
    pushVertex(
      topLeft,
      normal,
      0,
      topFraction,
      color,
      surfaceType,
      topRole,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
      topFraction,
    );
  };

  columns.forEach((column) => {
    const bottomY = Number.isFinite(column?.bottomY)
      ? column.bottomY
      : (Number.isFinite(column?.surfaceY) ? column.surfaceY : 0) - (column?.depth ?? 0.5);
    const ribbonHeight = Math.max(
      Number.isFinite(column?.ribbonHeight) ? column.ribbonHeight : 6,
      MIN_HEIGHT,
    );
    if (!(ribbonHeight > MIN_HEIGHT)) {
      return;
    }

    const ribbonVector = column?.ribbonVector
      ? new THREE.Vector2(column.ribbonVector.x ?? 0, column.ribbonVector.y ?? 0)
      : new THREE.Vector2(0, 1);
    if (ribbonVector.lengthSq() < 0.0001) {
      const orientation = Number.isFinite(column?.ribbonOrientation)
        ? column.ribbonOrientation
        : 0;
      ribbonVector.set(Math.cos(orientation), Math.sin(orientation));
    }
    if (ribbonVector.lengthSq() < 0.0001) {
      ribbonVector.set(0, 1);
    }
    ribbonVector.normalize();

    const normal = new THREE.Vector3(-ribbonVector.y, 0, ribbonVector.x);
    if (normal.lengthSq() < 0.0001) {
      normal.set(0, 0, 1);
    }
    normal.normalize();

    const span = Number.isFinite(column?.ribbonSpan)
      ? Math.max(0.1, column.ribbonSpan * 0.5)
      : DEFAULT_HALF_SPAN;
    const dir = new THREE.Vector3(ribbonVector.x, 0, ribbonVector.y);
    const offset = dir.clone().multiplyScalar(span);
    const color = column?.color
      ? tempColor.copy(column.color)
      : tempColor.set('#4ef0ff');

    const auroraGlow = Number.isFinite(column?.localAuroraGlow)
      ? column.localAuroraGlow
      : Number.isFinite(column?.localAuroraIntensity)
      ? column.localAuroraIntensity
      : 0;

    const flowStrength = Number.isFinite(column?.flowStrength)
      ? column.flowStrength
      : 0;

    const flowDir = column?.flowDirection
      ? column.flowDirection.clone?.() ?? tempVector2.set(column.flowDirection.x, column.flowDirection.y)
      : tempVector2.set(ribbonVector.x, ribbonVector.y);
    if (flowDir.lengthSq() > 0) {
      flowDir.normalize();
    }

    const surfaceType = 1;

    const baseSegmentCount = Number.isFinite(column?.ribbonSegments)
      ? Math.max(1, Math.floor(column.ribbonSegments))
      : 8;
    const segmentCount = Math.max(8, baseSegmentCount);
    const backNormal = normal.clone().negate();

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const bottomFraction = segmentIndex / segmentCount;
      const topFraction = (segmentIndex + 1) / segmentCount;
      const segmentBottomY = bottomY + ribbonHeight * bottomFraction;
      const segmentTopY = bottomY + ribbonHeight * topFraction;

      const bottomCenter = new THREE.Vector3(column.x, segmentBottomY, column.z);
      const topCenter = new THREE.Vector3(column.x, segmentTopY, column.z);

      const bottomLeft = bottomCenter.clone().sub(offset);
      const bottomRight = bottomCenter.clone().add(offset);
      const topLeft = topCenter.clone().sub(offset);
      const topRight = topCenter.clone().add(offset);

      const bottomRole = segmentIndex === 0 ? SURFACE_ROLES.EDGE_BOTTOM : SURFACE_ROLES.SURFACE;
      const topRole =
        segmentIndex === segmentCount - 1 ? SURFACE_ROLES.EDGE_TOP : SURFACE_ROLES.SURFACE;

      pushQuad({
        bottomLeft,
        bottomRight,
        topRight,
        topLeft,
        normal,
        color,
        surfaceType,
        flowDir,
        flowStrength,
        ribbonDir: ribbonVector,
        auroraGlow,
        bottomFraction,
        topFraction,
        bottomRole,
        topRole,
      });

      pushQuad({
        bottomLeft: bottomRight,
        bottomRight: bottomLeft,
        topRight: topLeft,
        topLeft: topRight,
        normal: backNormal,
        color,
        surfaceType,
        flowDir,
        flowStrength,
        ribbonDir: ribbonVector,
        auroraGlow,
        bottomFraction,
        topFraction,
        bottomRole,
        topRole,
      });
    }
  });

  const geometry = new THREE.BufferGeometry();
  if (positions.length === 0) {
    return geometry;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('surfaceType', new THREE.Float32BufferAttribute(surfaceTypes, 1));
  geometry.setAttribute('surfaceRole', new THREE.Float32BufferAttribute(surfaceRoles, 1));
  geometry.setAttribute('flowDirection', new THREE.Float32BufferAttribute(flowDirections, 2));
  geometry.setAttribute('flowStrength', new THREE.Float32BufferAttribute(flowStrengths, 1));
  geometry.setAttribute('ribbonVector', new THREE.Float32BufferAttribute(ribbonVectors, 2));
  geometry.setAttribute('auroraGlow', new THREE.Float32BufferAttribute(auroraGlows, 1));
  geometry.setAttribute(
    'ribbonHeightFraction',
    new THREE.Float32BufferAttribute(ribbonHeightFractions, 1),
  );

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

export default buildLumenRibbonGeometry;
