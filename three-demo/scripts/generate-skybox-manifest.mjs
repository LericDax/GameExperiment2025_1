import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanSkyboxesWithNode } from '../src/rendering/skyboxes/scan-skyboxes.js';

async function main() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const outputPath = path.resolve(
    moduleDir,
    '../src/rendering/skyboxes/skybox-manifest.generated.json',
  );

  const skyboxes = await scanSkyboxesWithNode();
  const sortedEntries = Object.keys(skyboxes)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = skyboxes[key];
      return acc;
    }, {});

  await mkdir(path.dirname(outputPath), { recursive: true });
  const serialized = `${JSON.stringify(sortedEntries, null, 2)}\n`;
  await writeFile(outputPath, serialized, 'utf8');

  const relativePath = path.relative(process.cwd(), outputPath);
  const entryCount = Object.keys(sortedEntries).length;
  console.log(`Generated skybox manifest with ${entryCount} entries at ${relativePath}`);
}

await main();
