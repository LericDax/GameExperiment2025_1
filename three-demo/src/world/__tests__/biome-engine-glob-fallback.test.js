import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const biomesDir = join(__dirname, '..', 'biomes');
const fallbackTarget = Object.fromEntries(
  readdirSync(biomesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const contents = readFileSync(join(biomesDir, file), 'utf8');
      return [`./biomes/${file}`, JSON.parse(contents)];
    }),
);

let fallbackAccessed = false;
const fallbackMap = new Proxy(fallbackTarget, {
  ownKeys(target) {
    fallbackAccessed = true;
    return Reflect.ownKeys(target);
  },
  get(target, property, receiver) {
    fallbackAccessed = true;
    return Reflect.get(target, property, receiver);
  },
});

const previousModuleMap = globalThis.__BIOME_MODULE_MAP__;
globalThis.__BIOME_MODULE_MAP__ = fallbackMap;

const originalGlobDescriptor = Object.getOwnPropertyDescriptor(import.meta, 'glob');
Reflect.deleteProperty(import.meta, 'glob');

const terrainEngineUrl = new URL('../terrain-engine.js', import.meta.url);
terrainEngineUrl.searchParams.set('fallbackTest', Math.random().toString(36).slice(2));

const { createTerrainEngine } = await import(terrainEngineUrl.href);

test('biome engine falls back to global map when import.meta.glob is unavailable', (t) => {
  t.after(() => {
    if (originalGlobDescriptor) {
      Object.defineProperty(import.meta, 'glob', originalGlobDescriptor);
    } else {
      Reflect.deleteProperty(import.meta, 'glob');
    }
    if (previousModuleMap === undefined) {
      delete globalThis.__BIOME_MODULE_MAP__;
    } else {
      globalThis.__BIOME_MODULE_MAP__ = previousModuleMap;
    }
  });

  assert.equal(
    fallbackAccessed,
    true,
    'expected fallback module map to be accessed when import.meta.glob throws',
  );

  assert.doesNotThrow(() => {
    const engine = createTerrainEngine({ THREE, seed: 4242 });
    engine.dispose();
  }, 'createTerrainEngine should initialise without errors when using the fallback map');
});
