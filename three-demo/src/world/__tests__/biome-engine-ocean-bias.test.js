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
  globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap;
  globalThis.__SKYBOX_URL_MAP__ =
    previousSkyboxMap && typeof previousSkyboxMap === 'object'
      ? previousSkyboxMap
      : {};
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

test('default biome scale maintains multi-chunk median patches', (t) => {
  globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap;
  globalThis.__SKYBOX_URL_MAP__ =
    previousSkyboxMap && typeof previousSkyboxMap === 'object'
      ? previousSkyboxMap
      : {};
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

  const sampleStep = 32;
  const halfSpan = 12;
  const gridSize = halfSpan * 2 + 1;
  const grid = Array.from({ length: gridSize }, () => new Array(gridSize));

  for (let gz = 0; gz < gridSize; gz += 1) {
    const z = (gz - halfSpan) * sampleStep;
    for (let gx = 0; gx < gridSize; gx += 1) {
      const x = (gx - halfSpan) * sampleStep;
      const { biome } = engine.getBiomeAt(x, z);
      grid[gz][gx] = biome?.id ?? null;
    }
  }

  const visited = Array.from({ length: gridSize }, () => new Array(gridSize).fill(false));
  const patchSpans = [];

  const neighborOffsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let gz = 0; gz < gridSize; gz += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      if (visited[gz][gx]) {
        continue;
      }
      const biomeId = grid[gz][gx];
      if (!biomeId) {
        visited[gz][gx] = true;
        continue;
      }

      const queue = [[gx, gz]];
      visited[gz][gx] = true;
      let minX = gx;
      let maxX = gx;
      let minZ = gz;
      let maxZ = gz;
      let cellCount = 0;

      while (queue.length > 0) {
        const [cx, cz] = queue.shift();
        cellCount += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
        neighborOffsets.forEach(([dx, dz]) => {
          const nx = cx + dx;
          const nz = cz + dz;
          if (
            nx < 0 ||
            nz < 0 ||
            nx >= gridSize ||
            nz >= gridSize ||
            visited[nz][nx] ||
            grid[nz][nx] !== biomeId
          ) {
            return;
          }
          visited[nz][nx] = true;
          queue.push([nx, nz]);
        });
      }

      if (cellCount === 0) {
        continue;
      }

      const spanX = (maxX - minX + 1) * sampleStep;
      const spanZ = (maxZ - minZ + 1) * sampleStep;
      const dominantSpan = Math.max(spanX, spanZ);
      patchSpans.push(dominantSpan);
    }
  }

  assert.ok(patchSpans.length > 0, 'expected to measure at least one biome patch');

  const sortedSpans = patchSpans.sort((a, b) => a - b);
  const medianSpan = sortedSpans[Math.floor(sortedSpans.length / 2)];
  const multiChunkThreshold = 48 * 2.5;

  assert.ok(
    medianSpan >= multiChunkThreshold,
    `expected median biome patch span to exceed ${multiChunkThreshold} units (observed ${medianSpan.toFixed(2)})`,
  );
});
