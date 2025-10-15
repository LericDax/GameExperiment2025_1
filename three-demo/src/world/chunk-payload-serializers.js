const DEFAULT_MATRIX4 = Object.freeze(Array(16).fill(0));
const DEFAULT_VECTOR3 = Object.freeze([0, 0, 0]);

const isTypedArray = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);

const toFloat32Array = (source, length) => {
  if (isTypedArray(source)) {
    return new Float32Array(source.slice(0, length));
  }
  if (Array.isArray(source)) {
    const result = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      result[i] = Number.isFinite(source[i]) ? source[i] : 0;
    }
    return result;
  }
  if (source && typeof source.toArray === 'function') {
    const result = new Float32Array(length);
    source.toArray(result, 0);
    return result;
  }
  if (source && Array.isArray(source.elements)) {
    return toFloat32Array(source.elements, length);
  }
  return new Float32Array(DEFAULT_MATRIX4.slice(0, length));
};

export const serializeMatrix4 = (matrix) => {
  if (!matrix) {
    return new Float32Array(DEFAULT_MATRIX4);
  }
  if (isTypedArray(matrix) || Array.isArray(matrix)) {
    return toFloat32Array(matrix, 16);
  }
  if (typeof matrix.toArray === 'function') {
    const target = new Float32Array(16);
    matrix.toArray(target, 0);
    return target;
  }
  if (Array.isArray(matrix.elements) || isTypedArray(matrix.elements)) {
    return toFloat32Array(matrix.elements, 16);
  }
  return new Float32Array(DEFAULT_MATRIX4);
};

export const deserializeMatrix4 = (elements, THREE) => {
  if (!THREE || typeof THREE.Matrix4 !== 'function') {
    throw new Error('deserializeMatrix4 requires a valid THREE implementation.');
  }
  const matrix = new THREE.Matrix4();
  if (Array.isArray(elements) || isTypedArray(elements)) {
    matrix.fromArray(elements);
    return matrix;
  }
  return matrix;
};

const toVectorArray = (vector) => {
  if (isTypedArray(vector)) {
    return new Float32Array(vector.slice(0, 3));
  }
  if (Array.isArray(vector)) {
    return toFloat32Array(vector, 3);
  }
  const x = Number.isFinite(vector?.x) ? vector.x : 0;
  const y = Number.isFinite(vector?.y) ? vector.y : 0;
  const z = Number.isFinite(vector?.z) ? vector.z : 0;
  return new Float32Array([x, y, z]);
};

export const serializeVector3 = (vector) => {
  if (!vector) {
    return new Float32Array(DEFAULT_VECTOR3);
  }
  return toVectorArray(vector);
};

export const deserializeVector3 = (elements, THREE) => {
  if (!THREE || typeof THREE.Vector3 !== 'function') {
    throw new Error('deserializeVector3 requires a valid THREE implementation.');
  }
  const vector = new THREE.Vector3();
  if (Array.isArray(elements) || isTypedArray(elements)) {
    vector.fromArray(elements);
    return vector;
  }
  if (elements && typeof elements === 'object') {
    vector.set(
      Number.isFinite(elements.x) ? elements.x : 0,
      Number.isFinite(elements.y) ? elements.y : 0,
      Number.isFinite(elements.z) ? elements.z : 0,
    );
  }
  return vector;
};

const toColorArray = (color) => {
  if (!color) {
    return null;
  }
  if (isTypedArray(color)) {
    return new Float32Array(color.slice(0, 3));
  }
  if (Array.isArray(color)) {
    return toFloat32Array(color, 3);
  }
  if (color && typeof color.toArray === 'function') {
    const target = new Float32Array(3);
    color.toArray(target, 0);
    return target;
  }
  if (color && typeof color.r === 'number') {
    return new Float32Array([
      Number.isFinite(color.r) ? color.r : 0,
      Number.isFinite(color.g) ? color.g : 0,
      Number.isFinite(color.b) ? color.b : 0,
    ]);
  }
  return null;
};

export const serializeColor = (color) => {
  const array = toColorArray(color);
  return array ? array : null;
};

export const deserializeColor = (elements, THREE) => {
  if (!elements) {
    return null;
  }
  if (!THREE || typeof THREE.Color !== 'function') {
    throw new Error('deserializeColor requires a valid THREE implementation.');
  }
  if (Array.isArray(elements) || isTypedArray(elements)) {
    const [r = 0, g = 0, b = 0] = elements;
    return new THREE.Color(r, g, b);
  }
  if (elements && typeof elements === 'object') {
    const r = Number.isFinite(elements.r) ? elements.r : 0;
    const g = Number.isFinite(elements.g) ? elements.g : 0;
    const b = Number.isFinite(elements.b) ? elements.b : 0;
    return new THREE.Color(r, g, b);
  }
  return new THREE.Color(0, 0, 0);
};

const isSerializablePrimitive = (value) =>
  value === null ||
  value === undefined ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const sanitizeSerializable = (value) => {
  if (isSerializablePrimitive(value)) {
    return value ?? null;
  }
  if (isTypedArray(value)) {
    return value.constructor === Float32Array
      ? new Float32Array(value)
      : new Float32Array(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSerializable(entry));
  }
  if (value?.isVector3) {
    return {
      x: Number.isFinite(value.x) ? value.x : 0,
      y: Number.isFinite(value.y) ? value.y : 0,
      z: Number.isFinite(value.z) ? value.z : 0,
    };
  }
  if (value?.isColor) {
    return {
      r: Number.isFinite(value.r) ? value.r : 0,
      g: Number.isFinite(value.g) ? value.g : 0,
      b: Number.isFinite(value.b) ? value.b : 0,
    };
  }
  if (value && typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, entry]) => {
      const sanitized = sanitizeSerializable(entry);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    });
    return result;
  }
  return null;
};

export const serializeInstancedEntry = (entry) => {
  if (!entry) {
    return null;
  }
  return {
    key: entry.key ?? null,
    coordinateKey: entry.coordinateKey ?? null,
    type: entry.type ?? null,
    biomeId: entry.biomeId ?? null,
    matrix: serializeMatrix4(entry.matrix),
    position: serializeVector3(entry.position),
    scale: serializeVector3(entry.scale),
    visualScale: serializeVector3(entry.visualScale),
    visualOffset: serializeVector3(entry.visualOffset),
    paletteColor: serializeColor(entry.paletteColor),
    tintColor: serializeColor(entry.tintColor),
    tintOverride: serializeColor(entry.tintOverride),
    destructible:
      typeof entry.destructible === 'boolean' ? entry.destructible : entry.destructible ?? null,
    collisionMode: entry.collisionMode ?? null,
    isSolid:
      typeof entry.isSolid === 'boolean' ? entry.isSolid : entry.isSolid ?? null,
    isSoft: typeof entry.isSoft === 'boolean' ? entry.isSoft : entry.isSoft ?? null,
    isDecoration: entry.isDecoration === true,
    sourceObjectId: entry.sourceObjectId ?? null,
    voxelIndex: entry.voxelIndex ?? null,
    prototypeKey: entry.prototypeKey ?? null,
    prototypeLocalKey: entry.prototypeLocalKey ?? null,
    metadata: entry.metadata ? sanitizeSerializable(entry.metadata) : null,
  };
};

export const deserializeInstancedEntry = (payload, THREE) => {
  if (!payload) {
    return null;
  }
  return {
    key: payload.key ?? null,
    coordinateKey: payload.coordinateKey ?? null,
    type: payload.type ?? null,
    biomeId: payload.biomeId ?? null,
    matrix: deserializeMatrix4(payload.matrix, THREE),
    position: deserializeVector3(payload.position, THREE),
    scale: deserializeVector3(payload.scale, THREE),
    visualScale: deserializeVector3(payload.visualScale, THREE),
    visualOffset: deserializeVector3(payload.visualOffset, THREE),
    paletteColor: deserializeColor(payload.paletteColor, THREE),
    tintColor: deserializeColor(payload.tintColor, THREE),
    tintOverride: deserializeColor(payload.tintOverride, THREE),
    destructible:
      typeof payload.destructible === 'boolean'
        ? payload.destructible
        : payload.destructible ?? null,
    collisionMode: payload.collisionMode ?? null,
    isSolid: typeof payload.isSolid === 'boolean' ? payload.isSolid : null,
    isSoft: typeof payload.isSoft === 'boolean' ? payload.isSoft : null,
    isDecoration: payload.isDecoration === true,
    sourceObjectId: payload.sourceObjectId ?? null,
    voxelIndex: payload.voxelIndex ?? null,
    prototypeKey: payload.prototypeKey ?? null,
    prototypeLocalKey: payload.prototypeLocalKey ?? null,
    metadata: payload.metadata ?? null,
    payload,
  };
};
