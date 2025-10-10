import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

import { createTfmsNetwork } from '../tfms/operators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const biomesDir = join(__dirname, '..', 'biomes');
const biomeModuleMap = Object.fromEntries(
  readdirSync(biomesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const contents = readFileSync(join(biomesDir, file), 'utf8');
      return [`./biomes/${file}`, JSON.parse(contents)];
    }),
);

globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap;

const { createTerrainEngine } = await import('../terrain-engine.js');

test('single-operator TFMS network returns its bias and ignores missing modulation slots', () => {
  const bias = 2.5;
  const network = createTfmsNetwork({
    operators: [
      {
        id: 'single-carrier',
        type: 'fbm',
        amplitude: 0,
        frequency: 1,
        phase: { x: 0, z: 0 },
        domainWarp: { x: 0, z: 0 },
        weight: 1,
        bias,
        transfer: 'identity',
      },
    ],
    modulationMatrix: [
      {
        id: 'skipped-route',
        source: 3,
        target: 0,
        routing: 'amplitude',
        gain: 1,
      },
    ],
    transferFunctions: {},
    tectonic: {},
  });

  const result = network.evaluate({ x: 0, z: 0 });
  assert.equal(result.operators.length, 1);
  assert.equal(result.envelope, bias);
});

test('six-operator TFMS network sums bias contributions when amplitudes are zeroed', () => {
  const operators = Array.from({ length: 6 }, (_, index) => ({
    id: `op-${index + 1}`,
    type: 'fbm',
    amplitude: 0,
    frequency: 1,
    phase: { x: 0, z: 0 },
    domainWarp: { x: 0, z: 0 },
    weight: 1,
    bias: index + 1,
    transfer: 'identity',
  }));

  const network = createTfmsNetwork({
    operators,
    modulationMatrix: [
      {
        id: 'ignored-entry',
        source: 8,
        target: 1,
        routing: 'frequency',
        gain: 0.25,
      },
    ],
    transferFunctions: {},
    tectonic: {},
  });

  const result = network.evaluate({ x: 0, z: 0 });
  assert.equal(result.operators.length, 6);
  assert.equal(result.envelope, 21);
});

test('terrain engine honours operatorCount when sampling terrain columns', () => {
  const seed = 4242;
  const baseEngine = createTerrainEngine({ THREE, seed });
  const reducedEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      terrain: {
        tfms: {
          operatorCount: 1,
        },
      },
    },
  });

  const defaultColumn = baseEngine.sampleColumn(96, -128);
  const reducedColumn = reducedEngine.sampleColumn(96, -128);

  assert.ok(Number.isFinite(defaultColumn.height));
  assert.ok(Number.isFinite(reducedColumn.height));
  assert.notEqual(defaultColumn.height, reducedColumn.height);

  baseEngine.dispose();
  reducedEngine.dispose();
});
