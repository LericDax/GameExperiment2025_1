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

  if (!Array.isArray(columns) || columns.length === 0) {
    return new THREE.BufferGeometry();
  }

  const tempColor = new THREE.Color('#4ef0ff');
  const tempVector2 = new THREE.Vector2();

  const pushVertex = (
    position,
    normal,
    uv,
    color,
    surfaceType,
    surfaceRole,
    flowDir,
    flowStrength,
    ribbonDir,
    auroraGlow,
  ) => {
    positions.push(position.x, position.y, position.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(uv.x, uv.y);
    colors.push(color.r, color.g, color.b);
    surfaceTypes.push(surfaceType);
    surfaceRoles.push(surfaceRole);
    flowDirections.push(flowDir.x, flowDir.y);
    flowStrengths.push(flowStrength);
    ribbonVectors.push(ribbonDir.x, ribbonDir.y);
    auroraGlows.push(auroraGlow);
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
  }) => {
    pushVertex(
      bottomLeft,
      normal,
      new THREE.Vector2(0, 0),
      color,
      surfaceType,
      SURFACE_ROLES.EDGE_BOTTOM,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
    );
    pushVertex(
      bottomRight,
      normal,
      new THREE.Vector2(1, 0),
      color,
      surfaceType,
      SURFACE_ROLES.EDGE_BOTTOM,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
    );
    pushVertex(
      topRight,
      normal,
      new THREE.Vector2(1, 1),
      color,
      surfaceType,
      SURFACE_ROLES.EDGE_TOP,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
    );

    pushVertex(
      bottomLeft,
      normal,
      new THREE.Vector2(0, 0),
      color,
      surfaceType,
      SURFACE_ROLES.EDGE_BOTTOM,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
    );
    pushVertex(
      topRight,
      normal,
      new THREE.Vector2(1, 1),
      color,
      surfaceType,
      SURFACE_ROLES.EDGE_TOP,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
    );
    pushVertex(
      topLeft,
      normal,
      new THREE.Vector2(0, 1),
      color,
      surfaceType,
      SURFACE_ROLES.EDGE_TOP,
      flowDir,
      flowStrength,
      ribbonDir,
      auroraGlow,
    );
  };

  columns.forEach((column) => {
    const bottomY = Number.isFinite(column?.bottomY)
      ? column.bottomY
      : (Number.isFinite(column?.surfaceY) ? column.surfaceY : 0) - (column?.depth ?? 0.5);
    const topY = Number.isFinite(column?.surfaceY)
      ? column.surfaceY
      : bottomY + Math.max(column?.depth ?? 0.75, MIN_HEIGHT);
    if (!(topY > bottomY + MIN_HEIGHT)) {
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

    const bottomCenter = new THREE.Vector3(column.x, bottomY, column.z);
    const topCenter = new THREE.Vector3(column.x, topY, column.z);

    const bottomLeft = bottomCenter.clone().sub(offset);
    const bottomRight = bottomCenter.clone().add(offset);
    const topLeft = topCenter.clone().sub(offset);
    const topRight = topCenter.clone().add(offset);

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
    });

    const backNormal = normal.clone().negate();
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
    });
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

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

export default buildLumenRibbonGeometry;
