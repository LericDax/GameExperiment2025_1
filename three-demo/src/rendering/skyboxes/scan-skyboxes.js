export const SKYBOX_SEARCH_ROOT = '../../../public/assets/skyboxes';
export const SKYBOX_EXTENSION_PATTERN = /\.(?:exr|hdr|png|jpe?g)$/i;

export async function scanSkyboxesWithNode() {
  if (typeof process === 'undefined' || !process.versions?.node) {
    return {};
  }

  try {
    const fsModule = await import(/* @vite-ignore */ 'node:fs');
    const pathModule = await import(/* @vite-ignore */ 'node:path');
    const urlModule = await import(/* @vite-ignore */ 'node:url');

    const readdirSync = fsModule.readdirSync ?? fsModule.default?.readdirSync;
    const statSync = fsModule.statSync ?? fsModule.default?.statSync;
    if (typeof readdirSync !== 'function' || typeof statSync !== 'function') {
      return {};
    }

    const path = pathModule.default ?? pathModule;
    const { fileURLToPath } = urlModule;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const skyboxRoot = path.resolve(moduleDir, SKYBOX_SEARCH_ROOT);

    let stats;
    try {
      stats = statSync(skyboxRoot);
    } catch {
      return {};
    }
    if (!stats.isDirectory()) {
      return {};
    }

    const result = {};
    const stack = [skyboxRoot];

    while (stack.length > 0) {
      const currentDir = stack.pop();
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!SKYBOX_EXTENSION_PATTERN.test(entry.name)) {
          continue;
        }
        const relativePath = path.relative(skyboxRoot, entryPath).split(path.sep).join('/');
        const key = `${SKYBOX_SEARCH_ROOT}/${relativePath}`.replace(/\\/g, '/');
        const url = `public/assets/skyboxes/${relativePath}`.replace(/\\/g, '/');
        result[key] = url;
      }
    }

    return result;
  } catch (error) {
    console.warn('[skybox-manager] Failed to scan skyboxes via Node fallback.', error);
    return {};
  }
}
