import { createHydraWaterMaterial } from './water-material.js';

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
const fluidFallbackStates = new Map();

function ensureColor(value) {
  if (!THREERef) {
    return null;
  }
  const color = value instanceof THREERef.Color ? value : new THREERef.Color(value ?? '#3a79c5');
  return color;
}

function ensureFallbackMaterial(runtime, { color, opacity } = {}) {
  const fallbackColor = ensureColor(color ?? runtime.fallbackColor ?? '#3a79c5');
  const fallbackOpacity = typeof opacity === 'number' ? opacity : runtime.fallbackOpacity ?? 0.82;
  if (!runtime.fallbackMaterial) {
    runtime.fallbackMaterial = new THREERef.MeshBasicMaterial({
      color: fallbackColor.clone(),
      transparent: true,
      opacity: fallbackOpacity,
      depthWrite: false,
      side: THREERef.DoubleSide,
      vertexColors: true,
    });
  } else {
    runtime.fallbackMaterial.color.copy(fallbackColor);
    runtime.fallbackMaterial.opacity = fallbackOpacity;
  }
  runtime.fallbackColor = `#${runtime.fallbackMaterial.color.getHexString()}`;
  runtime.fallbackOpacity = runtime.fallbackMaterial.opacity;
  return runtime.fallbackMaterial;
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
      const groundHeight = sampleColumnHeight(x, z);
      if (groundHeight < worldConfig.waterLevel) {
        const surfaceY = worldConfig.waterLevel + 0.5;
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
  const { material, update, pipeline } = materialFactory({ THREE: THREERef, definition });
  material.depthWrite = false;
  material.transparent = true;
  runtime = {
    definition,
    material,
    update: typeof update === 'function' ? update : null,
    pipeline: pipeline ?? null,
    surfaces: new Set(),
    forcedFallbackActive: false,
    fallbackMaterial: null,
    fallbackColor: '#3a79c5',
    fallbackOpacity: 0.82,
  };
  fluidRuntime.set(id, runtime);
  return runtime;
}

export function createFluidSurface({ type, geometry }) {
  const runtime = ensureRuntime(type);
  let material;
  if (runtime.forcedFallbackActive) {
    material = ensureFallbackMaterial(runtime);
  } else if (DEV_USE_BASIC_FLUID_MATERIAL) {
    material = getDebugBasicMaterial(runtime.material);
  } else {
    material = runtime.material;
  }
  const mesh = new THREERef.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.fluidType = type;
  if (runtime.forcedFallbackActive) {
    mesh.userData.safetyFallback = true;
  }
  runtime.surfaces.add(mesh);
  if (runtime.pipeline) {
    runtime.pipeline.validateSurfaces(runtime.surfaces);
  }
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

export function resolveFluidPresence({ type, x, z, sampleColumnHeight, worldConfig }) {
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
      worldConfig,
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

export function isFluidFallbackActive(type) {
  if (!fluidDefinitions.has(type)) {
    return false;
  }
  const runtime = ensureRuntime(type);
  return Boolean(runtime.forcedFallbackActive);
}

export function forceFluidMaterialFallback(
  type,
  { color, opacity, reason = 'Hydra visibility probe triggered fallback', metrics = null } = {},
) {
  const runtime = ensureRuntime(type);
  const fallbackMaterial = ensureFallbackMaterial(runtime, { color, opacity });
  runtime.forcedFallbackActive = true;
  const state = {
    type,
    reason,
    color: runtime.fallbackColor,
    opacity: runtime.fallbackOpacity,
    activatedAt: Date.now(),
    metrics,
  };
  fluidFallbackStates.set(type, state);
  runtime.surfaces.forEach((mesh) => {
    if (mesh.material !== fallbackMaterial) {
      mesh.material = fallbackMaterial;
    }
    mesh.userData = mesh.userData || {};
    mesh.userData.safetyFallback = true;
  });
  console.warn(`[hydra] Forced ${type} fluid fallback: ${reason}`);
  return state;
}

export function getFluidFallbackStates() {
  return Array.from(fluidFallbackStates.values()).sort((a, b) => a.activatedAt - b.activatedAt);
}

export function clearFluidMaterialFallback(type) {
  if (!fluidDefinitions.has(type)) {
    return;
  }
  const runtime = ensureRuntime(type);
  if (!runtime.forcedFallbackActive) {
    return;
  }
  runtime.forcedFallbackActive = false;
  fluidFallbackStates.delete(type);
  runtime.surfaces.forEach((mesh) => {
    mesh.material = DEV_USE_BASIC_FLUID_MATERIAL
      ? getDebugBasicMaterial(runtime.material)
      : runtime.material;
    if (mesh.userData) {
      delete mesh.userData.safetyFallback;
    }
  });
}
