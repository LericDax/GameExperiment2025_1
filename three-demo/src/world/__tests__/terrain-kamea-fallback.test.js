import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

import { defaultWorldOptions } from '../world-settings.js';

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

test('terrain engine falls back to default Kamea temperament when overrides are invalid', () => {
  const invalidTemperament = 'NotARealTemperament';
  const engine = createTerrainEngine({
    THREE,
    seed: 9001,
    worldConfig: {
      terrain: {
        tfms: {
          temperament: invalidTemperament,
        },
      },
    },
  });

  const baseEntry = engine.getBaseTfmsNetwork();
  assert.ok(baseEntry?.network, 'expected TFMS network to be instantiated');
  assert.ok(baseEntry?.config, 'expected TFMS configuration to be returned');

  const resolvedTemperament = baseEntry.config?.kamea?.temperament;
  const defaultTemperament = defaultWorldOptions?.terrain?.tfms?.temperament;

  assert.equal(
    resolvedTemperament,
    defaultTemperament,
    'engine should fall back to default temperament',
  );
  assert.equal(
    baseEntry.config?.temperament,
    defaultTemperament,
    'base config should expose fallback temperament',
  );

  const sample = engine.sampleColumn(0, 0);
  assert.ok(Number.isFinite(sample.height), 'sampleColumn should return finite height');

  engine.dispose();
});
