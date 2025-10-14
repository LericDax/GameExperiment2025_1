import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

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
globalThis.__VOXEL_OBJECT_MODULE_MAP__ = {};

const { initializeWorldGeneration, randomAt } = await import('../generation.js');
const { ValueNoise2D } = await import('../noise.js');
const { defaultWorldOptions } = await import('../world-settings.js');

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[index];
}

test('underwater seabed transitions vary smoothly across neighbouring columns', () => {
  initializeWorldGeneration({ THREE });
  const chunkSize = defaultWorldOptions.chunk?.size ?? defaultWorldOptions.chunkSize ?? 48;
  const noiseAmplitude = Math.max(1, chunkSize * 0.08);
  const frequency = 0.075;
  const seedScalar = Math.floor(randomAt(0, 0, 7919) * 4294967296);
  const seabedNoise = new ValueNoise2D((seedScalar === 0 ? 1 : seedScalar) * 1.193 + 0.5);
  const sampleRange = 64;
  const z = 0;

  const noiseOffsets = [];
  const randomOffsets = [];
  for (let x = -sampleRange; x <= sampleRange; x += 1) {
    const noiseValue = seabedNoise.noise(x * frequency, z * frequency);
    noiseOffsets.push((noiseValue - 0.5) * noiseAmplitude);
    randomOffsets.push((randomAt(x, z, 7919) - 0.5) * noiseAmplitude);
  }

  const noiseDeltas = noiseOffsets.slice(1).map((value, index) =>
    Math.abs(value - noiseOffsets[index]),
  );
  const randomDeltas = randomOffsets.slice(1).map((value, index) =>
    Math.abs(value - randomOffsets[index]),
  );

  assert.ok(noiseOffsets.length > 3, 'expected to sample multiple seabed offsets');
  assert.ok(noiseDeltas.length > 2, 'expected to compute seabed deltas');

  const noiseRange = Math.max(...noiseOffsets) - Math.min(...noiseOffsets);
  assert.ok(noiseRange >= 0.2, 'expected seabed noise to provide variation');

  const noiseMax = Math.max(...noiseDeltas);
  const randomMax = Math.max(...randomDeltas);
  const noise95 = computePercentile(noiseDeltas, 0.95);
  const random95 = computePercentile(randomDeltas, 0.95);

  assert.ok(
    noiseMax < randomMax,
    `expected coherent seabed noise to have smaller max delta than random offsets (${noiseMax.toFixed(3)} vs ${randomMax.toFixed(3)})`,
  );
  assert.ok(
    noise95 < random95 * 0.6,
    `expected coherent seabed noise to suppress 95th percentile delta (${noise95.toFixed(3)} vs ${random95.toFixed(3)})`,
  );
});
