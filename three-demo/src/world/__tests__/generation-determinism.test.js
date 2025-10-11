import test from 'node:test';
import assert from 'node:assert/strict';
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

const previousModuleMap = globalThis.__BIOME_MODULE_MAP__;
globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap;

const { createTerrainEngine } = await import('../terrain-engine.js');

const coordinates = [
  { x: -384, z: -256 },
  { x: -96, z: 192 },
  { x: 164, z: -220 },
  { x: 320, z: 288 },
  { x: -448, z: 384 },
  { x: 512, z: -96 },
];

function sampleColumns(engine) {
  return coordinates.map(({ x, z }) => {
    const column = engine.sampleColumn(x, z);
    return {
      x,
      z,
      biome: column.biome?.id ?? null,
      schema: column.tfmsSchema?.id ?? null,
      oceanProvince: Number(column.oceanProvince?.toFixed(6) ?? 0),
      shorelineAffinity: Number(column.shorelineAffinity?.toFixed(6) ?? 0),
      oceanDepth: Number(column.oceanDepth?.toFixed(6) ?? 0),
    };
  });
}

test(
  'world generation yields deterministic biomes and ocean routing for matching seeds',
  (t) => {
    t.after(() => {
      if (previousModuleMap === undefined) {
        delete globalThis.__BIOME_MODULE_MAP__;
      } else {
        globalThis.__BIOME_MODULE_MAP__ = previousModuleMap;
      }
    });

    const engineA = createTerrainEngine({ THREE, seed: 8321 });
    const samplesA = sampleColumns(engineA);
    engineA.dispose();

    const engineB = createTerrainEngine({ THREE, seed: 8321 });
    const samplesB = sampleColumns(engineB);
    engineB.dispose();

    assert.deepEqual(samplesB, samplesA);
  },
);
