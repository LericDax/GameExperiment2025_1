import { TextureLoader } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { TextureEngine } from '../texture-engine.js';

const SKYBOX_URLS = import.meta.glob(
  '../assets/skyboxes/**/*.{exr,EXR,hdr,HDR,jpg,jpeg,JPG,JPEG,png,PNG}',
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
);

const loaderCache = new WeakMap();
const skyboxTextureCache = new WeakMap();
const proceduralTextureCache = new WeakMap();

export const FALLBACK_SKYBOX_ID = 'procedural-default';

const DEFAULT_SCENE_SETTINGS = Object.freeze({
  fogColor: 0xa9d6ff,
  fogNear: 20,
  fogFar: 140,
});

const SKYBOX_SCENE_SETTINGS = new Map([
  [FALLBACK_SKYBOX_ID, DEFAULT_SCENE_SETTINGS],
  [
    'skybox-1',
    Object.freeze({
      fogColor: 0xa9d6ff,
      fogNear: 20,
      fogFar: 140,
    }),
  ],
]);

function normalizeSkyboxId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveSkyboxFromQuery(search) {
  if (typeof search !== 'string' || search.length === 0) {
    return null;
  }
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    if (!params.has('skybox')) {
      return null;
    }
    return normalizeSkyboxId(params.get('skybox'));
  } catch (error) {
    console.warn('[skybox-manager] failed to parse URL parameters for skybox override', error);
    return null;
  }
}

function resolveSkyboxFromWorldOptions(options) {
  if (!options || typeof options !== 'object') {
    return null;
  }
  return (
    normalizeSkyboxId(options?.environment?.skyboxId) ||
    normalizeSkyboxId(options?.environment?.skybox?.id) ||
    normalizeSkyboxId(options?.skyboxId) ||
    null
  );
}

function resolveSkyboxSeed(options, fallbackSeed = 1337) {
  if (typeof options?.skyboxSeed === 'number' && Number.isFinite(options.skyboxSeed)) {
    return Math.trunc(options.skyboxSeed);
  }
  if (typeof options?.seedHash === 'number' && Number.isFinite(options.seedHash)) {
    return Math.trunc(options.seedHash);
  }
  if (typeof options?.seed === 'number' && Number.isFinite(options.seed)) {
    return Math.trunc(options.seed);
  }
  return fallbackSeed;
}

export function getSkyboxSceneSettings(id) {
  return SKYBOX_SCENE_SETTINGS.get(id) ?? DEFAULT_SCENE_SETTINGS;
}

export function resolveSkyboxRequest({
  worldOptions,
  search,
  fallbackId = FALLBACK_SKYBOX_ID,
} = {}) {
  const fromQuery = resolveSkyboxFromQuery(search ?? (typeof window !== 'undefined' ? window.location.search : ''));
  const fromWorld = fromQuery ? null : resolveSkyboxFromWorldOptions(worldOptions);
  const id = normalizeSkyboxId(fromQuery ?? fromWorld) ?? fallbackId;
  return {
    id,
    seed: resolveSkyboxSeed(worldOptions),
    source: fromQuery ? 'query' : fromWorld ? 'world' : 'default',
  };
}

function parseSkyboxKey(filePath) {
  const filename = filePath.split('/').pop();
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  const match = nameWithoutExt.match(/^(.*?)(?:@(\d+))?$/);
  const baseName = match ? match[1] : nameWithoutExt;
  const variantSize = match && match[2] ? Number.parseInt(match[2], 10) : Number.MAX_SAFE_INTEGER;
  return { baseName, variantSize };
}

function buildSkyboxRegistry() {
  const staged = new Map();
  for (const [path, url] of Object.entries(SKYBOX_URLS)) {
    if (!url) continue;
    const { baseName, variantSize } = parseSkyboxKey(path);
    const extension = path.split('.').pop()?.toLowerCase() ?? 'unknown';
    const existing = staged.get(baseName);
    if (existing && existing.variantSize >= variantSize) {
      continue;
    }
    staged.set(baseName, { url, variantSize, format: extension });
  }

  const registry = {};
  for (const [id, { url, format }] of staged.entries()) {
    registry[id] = Object.freeze({ url, format });
  }
  return registry;
}

const SKYBOX_REGISTRY = buildSkyboxRegistry();

function getLoader({ THREE, format }) {
  let cache = loaderCache.get(THREE);
  if (!cache) {
    cache = new Map();
    loaderCache.set(THREE, cache);
  }

  const normalizedFormat = typeof format === 'string' ? format.toLowerCase() : '';
  const loaderKey = normalizedFormat === 'exr' ? 'exr' : 'ldr';

  if (cache.has(loaderKey)) {
    return cache.get(loaderKey);
  }

  let loader;
  if (loaderKey === 'exr') {
    loader = new EXRLoader();
  } else {
    loader = new TextureLoader();
    if (typeof loader.setDataType === 'function') {
      loader.setDataType(THREE.UnsignedByteType);
    }
  }

  cache.set(loaderKey, loader);
  return loader;
}

function getSkyboxCache({ THREE }) {
  if (!skyboxTextureCache.has(THREE)) {
    skyboxTextureCache.set(THREE, new Map());
  }
  return skyboxTextureCache.get(THREE);
}

function getProceduralCache({ THREE }) {
  if (!proceduralTextureCache.has(THREE)) {
    proceduralTextureCache.set(THREE, new Map());
  }
  return proceduralTextureCache.get(THREE);
}

function configureEnvironmentTexture(texture, { THREE, id }) {
  texture.name = `skybox:${id}`;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  if ('colorSpace' in texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if ('encoding' in texture) {
    texture.encoding = THREE.sRGBEncoding;
  }
  if ('minFilter' in texture) {
    texture.minFilter = THREE.LinearFilter;
  }
  if ('magFilter' in texture) {
    texture.magFilter = THREE.LinearFilter;
  }
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  return texture;
}

export function listSkyboxes() {
  const ids = Object.keys(SKYBOX_REGISTRY).sort();
  return [FALLBACK_SKYBOX_ID, ...ids];
}

export function createProceduralSkyBackdrop({ THREE, seed = 1337 } = {}) {
  if (!THREE) {
    throw new Error('createProceduralSkyBackdrop requires a THREE instance');
  }

  const cache = getProceduralCache({ THREE });
  if (cache.has(seed)) {
    return cache.get(seed);
  }

  const engine = new TextureEngine({ THREE, seed });
  const width = 512;
  const height = 256;
  const data = new Uint8Array(width * height * 4);

  const zenith = engine.darken(engine.color('#0b1d3f'), 0.1);
  const horizon = engine.lighten(engine.color('#1e3a8a'), 0.15);
  const sunrise = engine.color('#f5d0a0');

  const baseSeed = engine.seed;
  const cloudSeed = baseSeed ^ 0x9e3779b1;

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const horizonBlend = Math.pow(v, 0.65);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      let color = engine.mix(horizon, zenith, horizonBlend);

      const sunBand = Math.exp(-Math.pow((v - 0.45) * 6, 2));
      const sunInfluence = sunBand * (0.4 + 0.6 * Math.pow(1 - Math.abs(u - 0.5) * 2, 4));
      color = engine.mix(color, sunrise, sunInfluence);

      const ridge = engine.sampleRidgeNoise(baseSeed, u * 2, v * 0.8, {
        octaves: 3,
        scale: 1.2,
        persistence: 0.5,
        lacunarity: 2.2,
        variant: 'sky-ridge',
      });
      const clouds = engine.sampleFractalNoise(cloudSeed, u * 2.5, v * 0.9, {
        octaves: 4,
        scale: 1.1,
        persistence: 0.55,
        lacunarity: 2.4,
        variant: 'sky-fractal',
      });
      const cloudAmount = Math.pow(clouds * ridge, 1.6) * 0.5;
      const cloudColor = engine.lighten(color, 0.6);
      color = engine.mix(color, cloudColor, cloudAmount);

      const rgba = engine.ensureRgba({ ...color, a: 1 });
      const index = (y * width + x) * 4;
      data[index] = rgba.r;
      data[index + 1] = rgba.g;
      data[index + 2] = rgba.b;
      data[index + 3] = rgba.a;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.anisotropy = 1;
  configureEnvironmentTexture(texture, { THREE, id: FALLBACK_SKYBOX_ID });

  cache.set(seed, texture);
  return texture;
}

export async function applySkybox({ THREE, renderer: _renderer, scene, id, seed } = {}) {
  if (!THREE) {
    throw new Error('applySkybox requires a THREE instance');
  }
  if (!scene) {
    throw new Error('applySkybox requires a THREE.Scene instance');
  }

  const requestedId = id ?? FALLBACK_SKYBOX_ID;
  const entry = SKYBOX_REGISTRY[requestedId];
  const url = entry?.url;
  let texture;
  let resolvedId = requestedId;

  if (url) {
    const cache = getSkyboxCache({ THREE });
    if (cache.has(url)) {
      texture = cache.get(url);
      configureEnvironmentTexture(texture, { THREE, id: requestedId });
    } else {
      const loader = getLoader({ THREE, format: entry?.format });
      texture = await loader.loadAsync(url);
      configureEnvironmentTexture(texture, { THREE, id: requestedId });
      cache.set(url, texture);
    }
  } else {
    resolvedId = FALLBACK_SKYBOX_ID;
    texture = createProceduralSkyBackdrop({ THREE, seed });
  }

  scene.environment = texture;
  scene.background = texture;
  return {
    id: resolvedId,
    requestedId,
    texture,
    sceneSettings: getSkyboxSceneSettings(resolvedId),
  };
}

