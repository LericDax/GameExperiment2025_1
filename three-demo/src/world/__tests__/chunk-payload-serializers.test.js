import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3, Color, Euler } from 'three';
import {
  serializeMatrix4,
  deserializeMatrix4,
  serializeVector3,
  deserializeVector3,
  serializeColor,
  deserializeColor,
  serializeInstancedEntry,
  deserializeInstancedEntry,
} from '../chunk-payload-serializers.js';

const toArray = (value) => (Array.isArray(value) ? value : Array.from(value));

const assertFloatArrayAlmostEqual = (actual, expected, epsilon = 1e-6) => {
  const actualArray = toArray(actual);
  const expectedArray = toArray(expected);
  assert.strictEqual(actualArray.length, expectedArray.length);
  actualArray.forEach((entry, index) => {
    const difference = Math.abs(entry - expectedArray[index]);
    assert.ok(
      difference <= epsilon,
      `entry ${index} expected ${expectedArray[index]} but received ${entry} (Δ=${difference})`,
    );
  });
};

test('serializeMatrix4 produces deterministic Float32Array from THREE.Matrix4', () => {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(0.1, 0.2, 0.3, 'XYZ'));
  const serialized = serializeMatrix4(matrix);

  assert.ok(serialized instanceof Float32Array);
  assert.strictEqual(serialized.length, 16);

  const expected = [];
  matrix.toArray(expected, 0);
  assertFloatArrayAlmostEqual(serialized, expected);

  const deserialized = deserializeMatrix4(serialized, { Matrix4 });
  assert.ok(deserialized instanceof Matrix4);

  const roundTrip = [];
  deserialized.toArray(roundTrip, 0);
  assertFloatArrayAlmostEqual(roundTrip, expected);
});

test('serializeMatrix4 normalizes plain arrays, typed arrays, and nullish values', () => {
  const fromArray = serializeMatrix4([1, 2, 3]);
  assert.deepStrictEqual(Array.from(fromArray), [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const source = new Float32Array([9, 8, 7, 6]);
  const fromTyped = serializeMatrix4(source);
  assert.notStrictEqual(fromTyped, source);
  assert.deepStrictEqual(Array.from(fromTyped.slice(0, 4)), [9, 8, 7, 6]);

  const fromNull = serializeMatrix4(undefined);
  assert.deepStrictEqual(Array.from(fromNull), new Array(16).fill(0));
});

test('serializeVector3 handles THREE.Vector3, arrays, and objects with missing values', () => {
  const vector = new Vector3(1, 2, 3);
  const serialized = serializeVector3(vector);
  assert.ok(serialized instanceof Float32Array);
  assert.deepStrictEqual(Array.from(serialized), [1, 2, 3]);

  const fromArray = serializeVector3([4, 5]);
  assert.deepStrictEqual(Array.from(fromArray), [4, 5, 0]);

  const fromObject = serializeVector3({ x: 6, y: undefined, z: 'not-a-number' });
  assert.deepStrictEqual(Array.from(fromObject), [6, 0, 0]);

  const fromNull = serializeVector3(null);
  assert.deepStrictEqual(Array.from(fromNull), [0, 0, 0]);

  const deserialized = deserializeVector3(serialized, { Vector3 });
  assert.ok(deserialized instanceof Vector3);
  assert.deepStrictEqual(deserialized.toArray(), [1, 2, 3]);

  const fromPojo = deserializeVector3({ x: 7, z: 9 }, { Vector3 });
  assert.deepStrictEqual(fromPojo.toArray(), [7, 0, 9]);
});

test('serializeColor supports THREE.Color, arrays, and plain objects', () => {
  const color = new Color(0.2, 0.4, 0.6);
  const serialized = serializeColor(color);
  assert.ok(serialized instanceof Float32Array);
  assertFloatArrayAlmostEqual(serialized, [0.2, 0.4, 0.6]);

  const fromArray = serializeColor([0.1, 0.2]);
  assertFloatArrayAlmostEqual(fromArray, [0.1, 0.2, 0]);

  const fromObject = serializeColor({ r: 0.5, g: Number.NaN, b: Infinity });
  assertFloatArrayAlmostEqual(fromObject, [0.5, 0, 0]);

  assert.strictEqual(serializeColor(null), null);

  const deserialized = deserializeColor(serialized, { Color });
  assert.ok(deserialized instanceof Color);
  assertFloatArrayAlmostEqual(deserialized.toArray(), [0.2, 0.4, 0.6]);

  const fromPojo = deserializeColor({ r: 1 }, { Color });
  assertFloatArrayAlmostEqual(fromPojo.toArray(), [1, 0, 0]);

  assert.strictEqual(deserializeColor(null, { Color }), null);
});

test('serializeInstancedEntry sanitizes metadata and round-trips through deserialization', () => {
  const entry = {
    key: 'sample',
    coordinateKey: 'coord',
    type: 'tree',
    biomeId: 3,
    matrix: new Matrix4().makeTranslation(5, 6, 7),
    position: new Vector3(8, 9, 10),
    scale: [1, 2, 3],
    visualScale: new Vector3(0.5, 0.5, 0.5),
    visualOffset: undefined,
    paletteColor: new Color(0.1, 0.2, 0.3),
    tintColor: [0.4, 0.5, 0.6],
    tintOverride: null,
    destructible: 'yes',
    collisionMode: undefined,
    isSolid: 1,
    isSoft: true,
    isDecoration: false,
    sourceObjectId: 12,
    voxelIndex: 42,
    prototypeKey: 'oak',
    prototypeLocalKey: undefined,
    metadata: {
      vector: new Vector3(1, 2, 3),
      color: new Color(0.7, 0.8, 0.9),
      typed: new Uint16Array([4, 5, 6]),
      nested: {
        list: [new Vector3(7, 8, 9), { color: new Color(0.05, 0.15, 0.25) }],
        skip: undefined,
      },
      values: [1, undefined, null, true, 'text'],
    },
  };

  const payload = serializeInstancedEntry(entry);

  assert.ok(payload.matrix instanceof Float32Array);
  assert.ok(payload.position instanceof Float32Array);
  assert.ok(payload.scale instanceof Float32Array);
  assert.ok(payload.visualScale instanceof Float32Array);
  assert.ok(payload.visualOffset instanceof Float32Array);
  assert.ok(payload.paletteColor instanceof Float32Array);
  assert.ok(payload.tintColor instanceof Float32Array);
  assert.strictEqual(payload.tintOverride, null);

  assert.strictEqual(typeof payload.destructible, 'string');
  assert.strictEqual(payload.collisionMode, null);
  assert.strictEqual(payload.isSolid, 1);
  assert.strictEqual(payload.isSoft, true);
  assert.strictEqual(payload.isDecoration, false);

  assert.notStrictEqual(payload.metadata, entry.metadata);
  assert.deepStrictEqual(payload.metadata.vector, { x: 1, y: 2, z: 3 });
  assert.deepStrictEqual(payload.metadata.color, { r: 0.7, g: 0.8, b: 0.9 });
  assert.ok(payload.metadata.typed instanceof Float32Array);
  assert.deepStrictEqual(Array.from(payload.metadata.typed), [4, 5, 6]);
  assert.ok(Array.isArray(payload.metadata.nested.list));
  assert.deepStrictEqual(payload.metadata.nested.list[0], { x: 7, y: 8, z: 9 });
  assert.deepStrictEqual(payload.metadata.nested.list[1].color, { r: 0.05, g: 0.15, b: 0.25 });
  assert.strictEqual(payload.metadata.nested.skip, null);
  assert.deepStrictEqual(payload.metadata.values, [1, null, null, true, 'text']);

  assert.doesNotThrow(() => JSON.stringify(payload.metadata));

  const restored = deserializeInstancedEntry(payload, { Matrix4, Vector3, Color });
  assert.ok(restored.matrix instanceof Matrix4);
  assert.ok(restored.position instanceof Vector3);
  assert.ok(restored.scale instanceof Vector3);
  assert.ok(restored.visualScale instanceof Vector3);
  assert.ok(restored.visualOffset instanceof Vector3);
  assert.ok(restored.paletteColor instanceof Color);
  assert.ok(restored.tintColor instanceof Color);
  assert.strictEqual(restored.tintOverride, null);
  assert.deepStrictEqual(restored.metadata, payload.metadata);

  const matrixRoundTrip = [];
  restored.matrix.toArray(matrixRoundTrip, 0);
  assertFloatArrayAlmostEqual(matrixRoundTrip, payload.matrix);
  assertFloatArrayAlmostEqual(restored.position.toArray(), payload.position);
  assertFloatArrayAlmostEqual(restored.scale.toArray(), payload.scale);
});
