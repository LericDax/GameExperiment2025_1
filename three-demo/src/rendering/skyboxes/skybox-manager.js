import { TextureLoader } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { TextureEngine } from '../texture-engine.js';

const SKYBOX_URLS = import.meta.glob(
  // The skyboxes live under `public/assets`, so we climb out of `src/` to reach them.
  '../../../public/assets/skyboxes/**/*.{exr,EXR,hdr,HDR,jpg,jpeg,JPG,JPEG,png,PNG}',
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
  [
    'skybox-1#invertY',
    Object.freeze({
      fogColor: 0xa9d6ff,
      fogNear: 20,
      fogFar: 140,
    }),
  ],
]);

const SKYBOX_ID_ALIASES = new Map([
  ['default', FALLBACK_SKYBOX_ID],
  ['fallback', FALLBACK_SKYBOX_ID],
  ['procedural', FALLBACK_SKYBOX_ID],
  ['none', FALLBACK_SKYBOX_ID],
]);

const SKYBOX_EXTENSION_PATTERN = /\.(?:exr|hdr|png|jpe?g)$/i;

const SKYBOX_ORIENTATION_ALIASES = new Map([
  ['normal', 'normal'],
  ['n', 'normal'],
  ['default', 'normal'],
  ['standard', 'normal'],
  ['upright', 'normal'],
  ['invert', 'invertY'],
  ['inverted', 'invertY'],
  ['reverse', 'invertY'],
  ['reversed', 'invertY'],
  ['flipped', 'invertY'],
  ['flip', 'invertY'],
  ['invertY', 'invertY'],
  ['i', 'invertY'],
  ['r', 'invertY'],
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

function normalizeSkyboxUrl(url) {
  if (typeof url !== 'string') {
    return url;
  }
  let normalized = url;

  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    normalized = normalized.replace(/^(?:\.\.\/|\.\/)+/, '');
  }

  normalized = normalized.replace(/^\/?public\//, '/');
  if (
    normalized &&
    !normalized.startsWith('/') &&
    !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)
  ) {
    normalized = `/${normalized}`;
  }
  return normalized;
}

function buildSkyboxRegistry() {
  const staged = new Map();
  for (const [path, url] of Object.entries(SKYBOX_URLS)) {
    if (!url) continue;
    const normalizedUrl = normalizeSkyboxUrl(url);
    const { baseName, variantSize } = parseSkyboxKey(path);
    const extension = path.split('.').pop()?.toLowerCase() ?? 'unknown';
    const existing = staged.get(baseName);
    if (existing && existing.variantSize >= variantSize) {
      continue;
    }
    staged.set(baseName, { url: normalizedUrl, variantSize, format: extension });
  }

  const registry = {};
  for (const [id, { url, format }] of staged.entries()) {
    registry[id] = Object.freeze({ url, format, invertY: false });
    registry[`${id}#invertY`] = Object.freeze({ url, format, invertY: true });
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

function configureEnvironmentTexture(texture, { THREE, id, invertY = false }) {
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
  texture.flipY = invertY;
  return texture;
}

export function listSkyboxes() {
  const ids = Object.keys(SKYBOX_REGISTRY).sort();
  return [FALLBACK_SKYBOX_ID, ...ids];
}

function normalizeSkyboxOrientation(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return SKYBOX_ORIENTATION_ALIASES.get(normalized) ?? null;
}

export function normalizeSkyboxSelection(input, orientationHint) {
  const raw = typeof input === 'string' ? input.trim() : '';
  const segments = raw.split(/[\\/]/);
  let baseCandidate = segments.length > 0 ? segments[segments.length - 1] : raw;
  let embeddedOrientation = null;

  if (baseCandidate.includes('#')) {
    const [beforeHash, afterHash] = baseCandidate.split('#', 2);
    const parsed = normalizeSkyboxOrientation(afterHash);
    if (parsed) {
      embeddedOrientation = parsed;
      baseCandidate = beforeHash;
    }
  }

  baseCandidate = baseCandidate.replace(SKYBOX_EXTENSION_PATTERN, '');

  const aliasKey = baseCandidate.toLowerCase();
  if (SKYBOX_ID_ALIASES.has(aliasKey)) {
    baseCandidate = SKYBOX_ID_ALIASES.get(aliasKey);
  }

  if (baseCandidate.includes('#')) {
    const [beforeHash, afterHash] = baseCandidate.split('#', 2);
    const parsed = normalizeSkyboxOrientation(afterHash);
    if (parsed) {
      embeddedOrientation = embeddedOrientation ?? parsed;
      baseCandidate = beforeHash;
    }
  }

  const normalizedBase = normalizeSkyboxId(baseCandidate) ?? FALLBACK_SKYBOX_ID;
  const orientation =
    normalizeSkyboxOrientation(orientationHint) ?? embeddedOrientation ?? 'normal';
  const finalOrientation = orientation === 'invertY' ? 'invertY' : 'normal';
  const id =
    finalOrientation === 'invertY' && !normalizedBase.endsWith('#invertY')
      ? `${normalizedBase}#invertY`
      : normalizedBase.endsWith('#invertY') && finalOrientation !== 'invertY'
        ? normalizedBase.replace(/#invertY$/i, '')
        : normalizedBase;

  const baseId = id.endsWith('#invertY') ? id.replace(/#invertY$/i, '') : id;

  return {
    id,
    baseId,
    orientation: finalOrientation,
  };
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

export function setSkyboxRotation({ scene, THREE, degrees = 0 } = {}) {
  if (!scene) {
    throw new Error('setSkyboxRotation requires a THREE.Scene instance');
  }
  if (!THREE) {
    throw new Error('setSkyboxRotation requires a THREE module reference');
  }

  const clampedDegrees = Number.isFinite(degrees) ? degrees : 0;
  const radians = THREE.MathUtils.degToRad(clampedDegrees);

  const applyRotationToEuler = (euler) => {
    if (!euler || typeof euler !== 'object') {
      return false;
    }
    if (typeof euler.set === 'function') {
      euler.set(0, radians, 0);
      return true;
    }
    let updated = false;
    if ('x' in euler) {
      euler.x = 0;
      updated = true;
    }
    if ('y' in euler) {
      euler.y = radians;
      updated = true;
    }
    if ('z' in euler) {
      euler.z = 0;
      updated = true;
    }
    return updated;
  };

  const applyRotationToTexture = (texture) => {
    if (!texture || typeof texture !== 'object') {
      return false;
    }
    if ('matrixAutoUpdate' in texture) {
      texture.matrixAutoUpdate = false;
    }
    if (texture.center && typeof texture.center.set === 'function') {
      texture.center.set(0.5, 0.5);
    }
    if ('wrapS' in texture) {
      texture.wrapS = THREE.RepeatWrapping;
    }
    if ('rotation' in texture) {
      texture.rotation = radians;
    }
    if (typeof texture.updateMatrix === 'function') {
      texture.updateMatrix();
    }
    if ('needsUpdate' in texture) {
      texture.needsUpdate = true;
    }
    return true;
  };

  const { background, environment } = scene;
  let updated = false;
  updated = applyRotationToEuler(scene.backgroundRotation) || updated;
  updated = applyRotationToEuler(scene.environmentRotation) || updated;
  updated = applyRotationToTexture(background) || updated;
  if (environment && environment !== background) {
    updated = applyRotationToTexture(environment) || updated;
  }
  return { radians, degrees: clampedDegrees, updated };
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
  const url = entry?.url ? normalizeSkyboxUrl(entry.url) : null;
  const invertY = entry?.invertY === true;
  let texture;
  let resolvedId = requestedId;

  if (url) {
    const cache = getSkyboxCache({ THREE });
    const cacheKey = url;
    let cacheEntry = cache.get(cacheKey);
    if (cacheEntry && !cacheEntry.baseTexture) {
      cacheEntry = {
        baseTexture: cacheEntry,
        variants: new Map([
          ['normal', cacheEntry],
        ]),
      };
      cache.set(cacheKey, cacheEntry);
    }
    if (cacheEntry?.baseTexture) {
      texture = invertY
        ? cacheEntry.variants.get('invertY')
        : cacheEntry.variants.get('normal') ?? cacheEntry.baseTexture;
    }

    if (!texture) {
      let resource = cacheEntry;
      if (!resource) {
        const loader = getLoader({ THREE, format: entry?.format });
        const baseTexture = await loader.loadAsync(url);
        resource = {
          baseTexture,
          variants: new Map([
            ['normal', baseTexture],
          ]),
        };
        cache.set(cacheKey, resource);
      }

      if (invertY) {
        texture = resource.variants.get('invertY');
        if (!texture) {
          texture = resource.baseTexture.clone();
          texture.needsUpdate = true;
          resource.variants.set('invertY', texture);
        }
      } else {
        texture = resource.variants.get('normal');
        if (!texture) {
          texture = resource.baseTexture;
          resource.variants.set('normal', texture);
        }
      }
    }

    texture.flipY = invertY;
    configureEnvironmentTexture(texture, { THREE, id: requestedId, invertY });
  } else {
    resolvedId = FALLBACK_SKYBOX_ID;
    texture = createProceduralSkyBackdrop({ THREE, seed });
  }

  scene.environment = texture;
  scene.background = texture;

  const rotation = scene?.userData?.skybox?.rotationDegrees;
  if (Number.isFinite(rotation)) {
    try {
      setSkyboxRotation({ scene, THREE, degrees: rotation });
    } catch (error) {
      console.warn('[skybox-manager] Failed to apply cached skybox rotation.', error);
    }
  }

  return {
    id: resolvedId,
    requestedId,
    texture,
    sceneSettings: getSkyboxSceneSettings(resolvedId),
    orientation: invertY ? 'invertY' : 'normal',
  };
}

