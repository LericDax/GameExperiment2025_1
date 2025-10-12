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
    .map((file) => [
      `./biomes/${file}`,
      JSON.parse(readFileSync(join(biomesDir, file), 'utf8')),
    ]),
);

const previousBiomeModuleMap = globalThis.__BIOME_MODULE_MAP__;
const previousSkyboxMap = globalThis.__SKYBOX_URL_MAP__;

globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap;
globalThis.__SKYBOX_URL_MAP__ = previousSkyboxMap && typeof previousSkyboxMap === 'object' ? previousSkyboxMap : {};

const biomeEngineModule = await import('../biome-engine.js');
const worldSettingsModule = await import('../world-settings.js');

const { createBiomeEngine } = biomeEngineModule;
const { resetWorldOptions } = worldSettingsModule;

test('default ocean weight bias favours marine biomes when the province mask indicates ocean', (t) => {
  t.after(() => {
    if (previousBiomeModuleMap === undefined) {
      delete globalThis.__BIOME_MODULE_MAP__;
    } else {
      globalThis.__BIOME_MODULE_MAP__ = previousBiomeModuleMap;
    }
    if (previousSkyboxMap === undefined) {
      delete globalThis.__SKYBOX_URL_MAP__;
    } else {
      globalThis.__SKYBOX_URL_MAP__ = previousSkyboxMap;
    }
  });

  resetWorldOptions();
  const engine = createBiomeEngine({ THREE });
  t.after(() => {
    engine.dispose();
  });

  const oceanThreshold = 0.2;
  const step = 16;
  let sampledCells = 0;
  let oceanicBiomes = 0;
  let shorelineBiomes = 0;

  for (let x = -256; x <= 256; x += step) {
    for (let z = -256; z <= 256; z += step) {
      const province = engine.sampleOceanProvince(x, z);
      if (province < oceanThreshold) {
        sampledCells += 1;
        const { biome } = engine.getBiomeAt(x, z);
        if (biome?.isOceanic) {
          oceanicBiomes += 1;
        } else if (biome?.isShoreline) {
          shorelineBiomes += 1;
        }
      }
    }
  }

  assert(sampledCells > 0, 'expected to sample at least one low-province ocean cell');

  const marineBiomes = oceanicBiomes + shorelineBiomes;
  const marineDominance = marineBiomes / sampledCells;

  assert.ok(
    marineDominance >= 0.65,
    `expected marine biomes to cover the majority of low-province cells (observed ${(marineDominance * 100).toFixed(2)}%)`,
  );

  assert.ok(
    oceanicBiomes > 0,
    'expected at least one ocean-tagged biome to appear in low-province cells with the default bias',
  );
});
