import { createHydraWaterMaterial } from './water-material.js';
import { createLumenBloomMaterial } from './lumen-bloom-material.js';
import { createAbyssalSerumMaterial } from './abyssal-serum-material.js';
import { getWorldOptions } from '../world-settings.js';

let THREERef = null;

// Developer toggle to inspect fluid geometry using a plain material.
const DEV_USE_BASIC_FLUID_MATERIAL = (() => {
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.has('fluidBasic')) {
    return true;
  }
  try {
    return window.localStorage?.getItem('fluidMaterial') === 'basic';
  } catch (error) {
    return false;
  }
})();

let debugBasicMaterial = null;

const fluidDefinitions = new Map();
const fluidRuntime = new Map();
const fluidSurfaceListeners = new Set();

const DEFAULT_FLUID_SEED = 7331;

function pseudoRandom2D(x, z, seed = DEFAULT_FLUID_SEED) {
  const hash = Math.sin(x * 127.1 + z * 311.7 + seed * 0.001) * 43758.5453;
  return hash - Math.floor(hash);
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function hueToRgb(p, q, t) {
  let temp = t;
  if (temp < 0) temp += 1;
  if (temp > 1) temp -= 1;
  if (temp < 1 / 6) return p + (q - p) * 6 * temp;
  if (temp < 1 / 2) return q;
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
  return p;
}

function hslToHex(h, s, l) {
  const hue = ((h % 1) + 1) % 1;
  const saturation = clamp01(s);
  const lightness = clamp01(l);

  let r;
  let g;
  let b;

  if (saturation === 0) {
    r = g = b = lightness;
  } else {
    const q =
      lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }

  const toHex = (value) => {
    const hex = Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, '0');
    return hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function resolveLumenBloomPresence({
  x,
  z,
  sampleColumnHeight,
  worldConfig,
  sampleBiomeAt,
}) {
  const groundHeight = sampleColumnHeight(x, z);
  const baseSurface = groundHeight + 0.5;
  const seed = worldConfig?.seedHash ?? DEFAULT_FLUID_SEED;
  const cluster = pseudoRandom2D(x * 0.12, z * 0.12, seed * 0.73);
  const bloom = pseudoRandom2D(x * 0.27 + 11.3, z * 0.27 - 6.1, seed * 0.41);
  const altitudeBias = Math.max(0, (worldConfig?.waterLevel ?? groundHeight) - groundHeight);

  const biomeSample =
    sampleBiomeAt?.(x, z) ?? worldConfig?.biomeEngine?.getBiomeAt?.(x, z);
  const biomeId = biomeSample?.biome?.id ?? biomeSample?.id ?? null;
  if (biomeId === 'ice_spire_tundra') {
    return {
      hasFluid: false,
      surfaceY: baseSurface,
      bottomY: baseSurface,
    };
  }

  if (biomeId === 'aurora_shard_expanse') {
    const neighborOffsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const neighborHeights = neighborOffsets.map(([dx, dz]) => {
      const height = sampleColumnHeight(x + dx, z + dz);
      return Number.isFinite(height) ? height : groundHeight;
    });
    const ridgeDiffs = neighborHeights.map((height) => groundHeight - height);
    const dropPx = ridgeDiffs[0];
    const dropNx = ridgeDiffs[1];
    const dropPz = ridgeDiffs[2];
    const dropNz = ridgeDiffs[3];
    const ridgeDropThreshold = 0.24;
    const pairMinX = Math.min(dropPx, dropNx);
    const pairMinZ = Math.min(dropPz, dropNz);
    const ridgeStrength = Math.max(0, Math.min(pairMinX, pairMinZ));
    const ridgeGate = ridgeStrength >= ridgeDropThreshold;
    const plateauStrength = Math.max(0, ridgeStrength - ridgeDropThreshold);
    const plateauInfluence = Math.min(1, plateauStrength / 0.9);
    const ribbonNoise = pseudoRandom2D(x * 0.31 + 5.8, z * 0.31 - 8.9, seed * 1.11);
    const ridgeNoise = pseudoRandom2D(x * 0.18 - 9.7, z * 0.18 + 6.4, seed * 0.67);

    const slopeX = neighborHeights[0] - neighborHeights[1];
    const slopeZ = neighborHeights[2] - neighborHeights[3];
    let ribbonOrientation = Math.atan2(slopeZ, slopeX);
    if (!Number.isFinite(ribbonOrientation)) {
      ribbonOrientation = 0;
    }
    ribbonOrientation += Math.PI / 2;

    const combinedNoise =
      cluster * 0.3 + bloom * 0.28 + ribbonNoise * 0.4 + ridgeNoise * 0.22;
    const spawnThreshold = 0.64 - plateauInfluence * 0.22 + altitudeBias * 0.0012;

    if (ridgeGate && combinedNoise >= spawnThreshold) {
      const ribbonLift = 1.01 + ridgeStrength * 0.3 + ribbonNoise * 0.2;
      const surfaceY = baseSurface + ribbonLift;
      const depth = Math.max(0.12, 0.18 + bloom * 0.16 + plateauInfluence * 0.2);
      const intensity = Math.min(
        3,
        0.82 + plateauInfluence * 0.9 + ribbonNoise * 0.35 + ridgeNoise * 0.24,
      );
      const normalizedIntensity = clamp01(intensity / 3);
      const colorHue =
        (0.45 + ridgeStrength * 0.08 + ribbonNoise * 0.05 + bloom * 0.02) % 1;
      const colorSaturation = clamp01(0.62 + plateauInfluence * 0.32);
      const colorLightness = clamp01(0.54 + ridgeStrength * 0.2 + bloom * 0.12);
      const colorHex = hslToHex(colorHue, colorSaturation, colorLightness);
      const pulseRate = 1.3 + plateauInfluence * 0.8 + bloom * 0.6;
      const glowBias = clamp01(
        0.55 + normalizedIntensity * 0.5 + ridgeStrength * 0.35,
      );

      return {
        hasFluid: true,
        surfaceY,
        bottomY: surfaceY - depth,
        metadata: {
          lifecycleCues: ['aurora_ribbon'],
          auroraIntensity: intensity,
          ribbonOrientation,
          ridgeStrength,
          colorHex,
          pulseRate,
          glowBias,
        },
      };
    }

    return {
      hasFluid: false,
      surfaceY: baseSurface,
      bottomY: baseSurface,
      metadata: {
        ribbonOrientation,
        ridgeStrength,
        glowBias: clamp01(ridgeStrength * 0.4),
      },
    };
  }

  if (cluster + bloom * 0.4 + altitudeBias * 0.01 < 0.75) {
    return {
      hasFluid: false,
      surfaceY: baseSurface,
      bottomY: baseSurface,
      metadata: {
        nonRendered: true,
      },
    };
  }

  const surfaceRise = 0.6 + (cluster - 0.5) * 1.2 + bloom * 0.5;
  const depth = 0.6 + bloom * 0.9;

  return {
    hasFluid: false,
    surfaceY: baseSurface,
    bottomY: baseSurface,
    metadata: {
      nonRendered: true,
      surfaceHint: baseSurface + surfaceRise,
      depthHint: depth,
    },
  };
}

function resolveAbyssalSerumPresence({
  x,
  z,
  sampleColumnHeight,
  worldConfig,
  sampleBiomeAt,
}) {
  const groundHeight = sampleColumnHeight(x, z);
  const baseSurface = groundHeight + 0.5;
  const seed = worldConfig?.seedHash ?? DEFAULT_FLUID_SEED;
  const caverns = pseudoRandom2D(x * 0.18 - 4.2, z * 0.18 + 3.6, seed * 0.91);
  const seep = pseudoRandom2D(x * 0.05 + 12.5, z * 0.05 - 2.7, seed * 0.33);
  const depthBias = Math.max(0, (worldConfig?.waterLevel ?? groundHeight) - groundHeight);
  const threshold = 0.68 - depthBias * 0.01;

  const biomeSample =
    sampleBiomeAt?.(x, z) ?? worldConfig?.biomeEngine?.getBiomeAt?.(x, z);
  const biomeId = biomeSample?.biome?.id ?? biomeSample?.id ?? null;
  if (biomeId === 'ice_spire_tundra') {
    return {
      hasFluid: false,
      surfaceY: baseSurface,
      bottomY: baseSurface,
    };
  }

  if (caverns < threshold || seep < 0.45) {
    return {
      hasFluid: false,
      surfaceY: baseSurface,
      bottomY: baseSurface,
    };
  }

  const surfaceDrop = 0.3 + seep * 0.4;
  const depth = 0.9 + caverns * 1.6;
  const surfaceY = baseSurface - surfaceDrop;

  return {
    hasFluid: true,
    surfaceY,
    bottomY: surfaceY - depth,
  };
}

function notifySurfaceCreated(context) {
  fluidSurfaceListeners.forEach((listener) => {
    try {
      listener.onCreated?.(context);
    } catch (error) {
      console.error('Fluid surface creation listener failed:', error);
    }
  });
}

function notifySurfaceDisposed(context) {
  fluidSurfaceListeners.forEach((listener) => {
    try {
      listener.onDisposed?.(context);
    } catch (error) {
      console.error('Fluid surface disposal listener failed:', error);
    }
  });
}

export function initializeFluidRegistry({ THREE }) {
  if (!THREE) {
    throw new Error('initializeFluidRegistry requires a THREE instance');
  }
  THREERef = THREE;
  fluidDefinitions.clear();
  fluidRuntime.clear();

  registerFluidType('water', {
    label: 'Water',
    createMaterial: (context) => createHydraWaterMaterial(context),
    presenceResolver: ({
      x,
      z,
      sampleColumnHeight,
      worldConfig,
    }) => {
      const config = worldConfig ?? getWorldOptions();
      const groundHeight = sampleColumnHeight(x, z);
      if (groundHeight < config.waterLevel) {
        const surfaceY = config.waterLevel + 0.5;
        return {
          hasFluid: true,
          surfaceY,
          bottomY: groundHeight + 0.5,
        };
      }
      const surfaceY = groundHeight + 0.5;
      return {
        hasFluid: false,
        surfaceY,
        bottomY: surfaceY,
      };
    },
  });

  registerFluidType('lumen_bloom', {
    label: 'Lumen Bloom',
    createMaterial: (context) => createLumenBloomMaterial(context),
    presenceResolver: resolveLumenBloomPresence,
  });

  registerFluidType('abyssal_serum', {
    label: 'Abyssal Serum',
    createMaterial: (context) => createAbyssalSerumMaterial(context),
    presenceResolver: resolveAbyssalSerumPresence,
  });
}

export function registerFluidSurfaceLifecycle(callbacks = {}) {
  const entry = {
    onCreated:
      typeof callbacks.onCreated === 'function' ? callbacks.onCreated : null,
    onDisposed:
      typeof callbacks.onDisposed === 'function' ? callbacks.onDisposed : null,
  };
  if (!entry.onCreated && !entry.onDisposed) {
    throw new Error(
      'registerFluidSurfaceLifecycle requires at least one lifecycle callback.',
    );
  }
  fluidSurfaceListeners.add(entry);
  return () => {
    fluidSurfaceListeners.delete(entry);
  };
}

export function registerFluidType(id, definition) {
  if (!THREERef) {
    throw new Error(
      'Fluid registry must be initialized with initializeFluidRegistry before registering fluids',
    );
  }
  if (!id) {
    throw new Error('registerFluidType requires a string identifier');
  }
  const normalized = {
    label: definition?.label ?? id,
    createMaterial: definition?.createMaterial,
    presenceResolver: definition?.presenceResolver ?? null,
    waveProfile: definition?.waveProfile ?? null,
  };
  fluidDefinitions.set(id, normalized);
  fluidRuntime.delete(id);
}

export function applyFluidSurfaceMetadata(mesh, geometry) {
  if (!mesh || typeof mesh !== 'object') {
    return;
  }
  mesh.userData = mesh.userData || {};
  const fluidType = mesh.userData.fluidType ?? null;
  const metadata = geometry?.userData;

  const cues = Array.isArray(metadata?.lifecycleCues)
    ? Array.from(new Set(metadata.lifecycleCues.map((cue) => String(cue))))
    : [];
  if (cues.length > 0) {
    mesh.userData.lifecycleCues = cues;
  } else if (fluidType === 'lumen_bloom') {
    mesh.userData.lifecycleCues = [];
  }

  if (metadata && Number.isFinite(metadata.auroraIntensity)) {
    mesh.userData.auroraIntensity = metadata.auroraIntensity;
  } else if (fluidType === 'lumen_bloom') {
    delete mesh.userData.auroraIntensity;
  }

  if (metadata && Number.isFinite(metadata.ribbonOrientation)) {
    mesh.userData.ribbonOrientation = metadata.ribbonOrientation;
  } else if (fluidType === 'lumen_bloom') {
    delete mesh.userData.ribbonOrientation;
  }
}

export function isFluidType(id) {
  return fluidDefinitions.has(id);
}

export function getFluidDefinition(id) {
  return fluidDefinitions.get(id) ?? null;
}

function ensureRuntime(id) {
  if (!THREERef) {
    throw new Error('Fluid registry not initialized. Call initializeFluidRegistry first.');
  }
  if (!fluidDefinitions.has(id)) {
    throw new Error(`Unknown fluid type: ${id}`);
  }
  let runtime = fluidRuntime.get(id);
  if (runtime) {
    return runtime;
  }
  const definition = fluidDefinitions.get(id);
  const materialFactory = definition.createMaterial;
  if (typeof materialFactory !== 'function') {
    throw new Error(`Fluid type "${id}" is missing a createMaterial() factory.`);
  }
  const { material, update, onSurfaceCreated, onSurfaceDisposed } = materialFactory({
    THREE: THREERef,
    definition,
  });
  material.depthWrite = false;
  material.transparent = true;
  runtime = {
    definition,
    material,
    update: typeof update === 'function' ? update : null,
    surfaces: new Set(),
    handleSurfaceCreated:
      typeof onSurfaceCreated === 'function' ? onSurfaceCreated : null,
    handleSurfaceDisposed:
      typeof onSurfaceDisposed === 'function' ? onSurfaceDisposed : null,
  };
  fluidRuntime.set(id, runtime);
  return runtime;
}

export function createFluidSurface({ type, geometry }) {
  const runtime = ensureRuntime(type);
  const material = DEV_USE_BASIC_FLUID_MATERIAL
    ? getDebugBasicMaterial(runtime.material)
    : runtime.material;
  const mesh = new THREERef.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.fluidType = type;
  applyFluidSurfaceMetadata(mesh, geometry);
  runtime.surfaces.add(mesh);
  if (runtime.handleSurfaceCreated) {
    runtime.handleSurfaceCreated(mesh);
  }
  notifySurfaceCreated({ type, mesh, runtime });
  return mesh;
}

function getDebugBasicMaterial(runtimeMaterial) {
  if (!debugBasicMaterial) {
    debugBasicMaterial = new THREERef.MeshBasicMaterial({
      color: new THREERef.Color('#ffffff'),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREERef.DoubleSide,
    });
  }
  if (runtimeMaterial) {
    debugBasicMaterial.opacity = runtimeMaterial.opacity ?? 1;
    debugBasicMaterial.transparent = runtimeMaterial.transparent ?? true;
  }
  return debugBasicMaterial;
}

export function disposeFluidSurface(mesh) {
  if (!mesh) {
    return;
  }
  const type = mesh.userData?.fluidType;
  if (!type) {
    return;
  }
  const runtime = fluidRuntime.get(type);
  if (!runtime) {
    return;
  }
  runtime.surfaces.delete(mesh);
  if (runtime.handleSurfaceDisposed) {
    runtime.handleSurfaceDisposed(mesh);
  }
  notifySurfaceDisposed({ type, mesh, runtime });
}

export function updateFluids(delta) {
  if (!delta || delta <= 0) {
    return;
  }
  fluidRuntime.forEach((runtime) => {
    if (typeof runtime.update === 'function') {
      runtime.update(delta, runtime.surfaces);
    }
  });
}

export function getFluidMaterial(type) {
  const runtime = ensureRuntime(type);
  return runtime.material;
}

export function resolveFluidPresence({
  type,
  x,
  z,
  sampleColumnHeight,
  worldConfig,
  sampleBiomeAt,
}) {
  const config = worldConfig ?? getWorldOptions();
  const definition = fluidDefinitions.get(type);
  if (!definition) {
    const fallbackSurface = sampleColumnHeight(x, z) + 0.5;
    return {
      hasFluid: false,
      surfaceY: fallbackSurface,
      bottomY: fallbackSurface,
    };
  }
  if (typeof definition.presenceResolver === 'function') {
    return definition.presenceResolver({
      x,
      z,
      sampleColumnHeight,
      worldConfig: config,
      sampleBiomeAt,
    });
  }
  const groundHeight = sampleColumnHeight(x, z);
  const surfaceY = groundHeight + 0.5;
  return {
    hasFluid: false,
    surfaceY,
    bottomY: surfaceY,
  };
}
