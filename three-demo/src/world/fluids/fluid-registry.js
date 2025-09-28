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

function resolveLumenBloomPresence({ x, z, sampleColumnHeight, worldConfig }) {
  const groundHeight = sampleColumnHeight(x, z);
  const baseSurface = groundHeight + 0.5;
  const seed = worldConfig?.seedHash ?? DEFAULT_FLUID_SEED;
  const cluster = pseudoRandom2D(x * 0.12, z * 0.12, seed * 0.73);
  const bloom = pseudoRandom2D(x * 0.27 + 11.3, z * 0.27 - 6.1, seed * 0.41);
  const altitudeBias = Math.max(0, (worldConfig?.waterLevel ?? groundHeight) - groundHeight);

  if (cluster + bloom * 0.4 + altitudeBias * 0.01 < 0.75) {
    return {
      hasFluid: false,
      surfaceY: baseSurface,
      bottomY: baseSurface,
    };
  }

  const surfaceRise = 0.6 + (cluster - 0.5) * 1.2 + bloom * 0.5;
  const depth = 0.6 + bloom * 0.9;
  const surfaceY = baseSurface + surfaceRise;

  return {
    hasFluid: true,
    surfaceY,
    bottomY: surfaceY - depth,
  };
}

function resolveAbyssalSerumPresence({ x, z, sampleColumnHeight, worldConfig }) {
  const groundHeight = sampleColumnHeight(x, z);
  const baseSurface = groundHeight + 0.5;
  const seed = worldConfig?.seedHash ?? DEFAULT_FLUID_SEED;
  const caverns = pseudoRandom2D(x * 0.18 - 4.2, z * 0.18 + 3.6, seed * 0.91);
  const seep = pseudoRandom2D(x * 0.05 + 12.5, z * 0.05 - 2.7, seed * 0.33);
  const depthBias = Math.max(0, (worldConfig?.waterLevel ?? groundHeight) - groundHeight);
  const threshold = 0.68 - depthBias * 0.01;

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
