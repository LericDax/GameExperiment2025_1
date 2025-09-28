/**
 * @module ParticleSystem
 *
 * Provides a particle system manager that supports GPU-driven billboard emitters.
 * Consumers create an instance with {@link createParticleSystem} and use
 * {@link ParticleSystem.emit} to register emitters. Emitters are plain objects
 * that may implement the following optional lifecycle hooks:
 *
 * - `initialize(context)` — called immediately when the emitter is registered.
 *   The provided context exposes helpers such as `createInstancedPool` for
 *   allocating GPU-backed particle storage and `getElapsedTime()` for querying
 *   the system clock.
 * - `update(context)` — invoked once per frame while the emitter is alive.
 *   Return `false` to signal that the emitter should be removed once all of its
 *   particles have expired.
 * - `dispose()` — called once when the emitter is removed from the system.
 */

const DEFAULT_POOL_CAPACITY = 128;

function toVector3(THREE, value) {
  if (value?.isVector3) {
    return value.clone();
  }
  const vector = new THREE.Vector3();
  if (Array.isArray(value)) {
    vector.fromArray(value);
    return vector;
  }
  const source = value ?? {};
  vector.set(
    Number.isFinite(source.x) ? source.x : 0,
    Number.isFinite(source.y) ? source.y : 0,
    Number.isFinite(source.z) ? source.z : 0,
  );
  return vector;
}

/**
 * Computes a set of world-space anchor points around a fluid contact based on
 * the player's feet position and the resolved surface height.
 */
export function computeFluidContactPoints({
  THREE,
  feetPosition,
  surfaceY,
  surfaceOffset = 0.12,
  subsurfaceDepth = 0.4,
} = {}) {
  if (!THREE) {
    throw new Error('computeFluidContactPoints requires a THREE instance.');
  }
  if (!Number.isFinite(surfaceY)) {
    throw new Error('computeFluidContactPoints requires a numeric surfaceY.');
  }
  if (!feetPosition) {
    throw new Error('computeFluidContactPoints requires a feetPosition.');
  }
  const feet = toVector3(THREE, feetPosition);
  feet.y = Number.isFinite(feet.y) ? feet.y : surfaceY;
  const surfacePoint = feet.clone();
  surfacePoint.y = surfaceY + surfaceOffset;
  const subsurfacePoint = feet.clone();
  subsurfacePoint.y = surfaceY - subsurfaceDepth;
  return {
    feet,
    surface: surfacePoint,
    subsurface: subsurfacePoint,
  };
}

/**
 * Approximates a representative spawn anchor for a fluid surface mesh by
 * sampling its world-space bounding box.
 */
export function computeFluidSurfaceAnchor({
  THREE,
  mesh,
  surfaceOffset = 0.45,
} = {}) {
  if (!THREE) {
    throw new Error('computeFluidSurfaceAnchor requires a THREE instance.');
  }
  if (!mesh?.isObject3D) {
    return null;
  }
  const boundingBox = new THREE.Box3();
  boundingBox.setFromObject(mesh);
  if (!Number.isFinite(boundingBox.min.y) || !Number.isFinite(boundingBox.max.y)) {
    return null;
  }
  const center = new THREE.Vector3();
  boundingBox.getCenter(center);
  center.y = boundingBox.max.y + surfaceOffset;
  return center;
}

function cloneBufferAttribute(THREE, attribute) {
  const cloned = attribute.clone();
  if (cloned.isInterleavedBufferAttribute) {
    return cloned; // Interleaved attributes copy the buffer reference automatically.
  }
  const array = attribute.array;
  const ArrayType = array.constructor;
  cloned.array = new ArrayType(array.length);
  cloned.array.set(array);
  return cloned;
}

function copyBaseGeometry(THREE, target, source) {
  if (!source) {
    throw new Error('Instanced pool requires a base geometry.');
  }
  if (source.index) {
    target.setIndex(source.index.clone());
  }
  const attributeNames = Object.keys(source.attributes);
  for (const name of attributeNames) {
    target.setAttribute(name, cloneBufferAttribute(THREE, source.getAttribute(name)));
  }
}

function createInstancedPool({
  THREE,
  root,
  state,
  baseGeometry,
  material,
  capacity = DEFAULT_POOL_CAPACITY,
  attributes,
  frustumCulled = false,
}) {
  if (!attributes || attributes.length === 0) {
    throw new Error('Instanced pool requires at least one attribute definition.');
  }
  if (!material) {
    throw new Error('Instanced pool requires a material.');
  }

  const geometry = new THREE.InstancedBufferGeometry();
  copyBaseGeometry(THREE, geometry, baseGeometry);
  geometry.instanceCount = 0;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = frustumCulled;
  root.add(mesh);

  const attributeMap = new Map();
  const dirtyAttributes = new Set();
  let capacityValue = Math.max(1, Math.floor(capacity));

  for (const definition of attributes) {
    const { name, itemSize, arrayType = Float32Array } = definition;
    if (!name) {
      throw new Error('Instanced attribute definition is missing a `name`.');
    }
    const resolvedItemSize = Math.max(1, Math.floor(itemSize));
    const initialArray = new arrayType(capacityValue * resolvedItemSize);
    const attribute = new THREE.InstancedBufferAttribute(initialArray, resolvedItemSize);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    attributeMap.set(name, {
      definition,
      attribute,
      arrayType,
      itemSize: resolvedItemSize,
    });
  }

  const activeIndices = [];
  const indexLookup = new Map();
  const freeList = [];
  let nextIndex = 0;
  let disposed = false;

  function ensureCapacity(target) {
    if (target <= capacityValue) {
      return;
    }
    let nextCapacity = capacityValue;
    while (nextCapacity < target) {
      nextCapacity *= 2;
    }
    for (const info of attributeMap.values()) {
      const { attribute, itemSize, arrayType } = info;
      const nextArray = new arrayType(nextCapacity * itemSize);
      nextArray.set(attribute.array);
      attribute.array = nextArray;
      attribute.count = nextCapacity;
      attribute.needsUpdate = true;
      dirtyAttributes.add(info.definition.name);
    }
    capacityValue = nextCapacity;
  }

  function allocateInstance() {
    if (disposed) {
      return -1;
    }
    let index = freeList.pop();
    if (index === undefined) {
      index = nextIndex;
      nextIndex += 1;
      ensureCapacity(index + 1);
    }
    activeIndices.push(index);
    indexLookup.set(index, activeIndices.length - 1);
    geometry.instanceCount = activeIndices.length;
    return index;
  }

  function releaseInstance(index) {
    if (disposed) {
      return false;
    }
    const position = indexLookup.get(index);
    if (position === undefined) {
      return false;
    }
    const lastIndex = activeIndices[activeIndices.length - 1];
    activeIndices[position] = lastIndex;
    activeIndices.pop();
    if (lastIndex !== index) {
      indexLookup.set(lastIndex, position);
    }
    indexLookup.delete(index);
    freeList.push(index);
    geometry.instanceCount = activeIndices.length;
    return true;
  }

  function setAttributeValues(name, index, values) {
    const info = attributeMap.get(name);
    if (!info) {
      throw new Error(`Unknown instanced attribute: ${name}`);
    }
    const { attribute, itemSize } = info;
    const offset = index * itemSize;
    for (let i = 0; i < itemSize; i += 1) {
      attribute.array[offset + i] = values[i] ?? 0;
    }
    dirtyAttributes.add(name);
  }

  function markAttributeDirty(name) {
    if (attributeMap.has(name)) {
      dirtyAttributes.add(name);
    }
  }

  function getAttributeArray(name) {
    const info = attributeMap.get(name);
    if (!info) {
      throw new Error(`Unknown instanced attribute: ${name}`);
    }
    return info.attribute.array;
  }

  function getItemSize(name) {
    const info = attributeMap.get(name);
    if (!info) {
      throw new Error(`Unknown instanced attribute: ${name}`);
    }
    return info.itemSize;
  }

  function forEachActive(callback) {
    for (let i = 0; i < activeIndices.length; i += 1) {
      callback(activeIndices[i], i);
    }
  }

  function commit() {
    if (disposed) {
      return;
    }
    for (const name of dirtyAttributes) {
      const info = attributeMap.get(name);
      if (info) {
        info.attribute.needsUpdate = true;
      }
    }
    dirtyAttributes.clear();
    geometry.instanceCount = activeIndices.length;
  }

  function disposePool() {
    if (disposed) {
      return;
    }
    disposed = true;
    root.remove(mesh);
    geometry.dispose();
    material.dispose?.();
    activeIndices.length = 0;
    indexLookup.clear();
    freeList.length = 0;
  }

  const api = {
    mesh,
    geometry,
    allocateInstance,
    releaseInstance,
    setAttributeValues,
    markAttributeDirty,
    getAttributeArray,
    getItemSize,
    forEachActive,
    getActiveCount: () => activeIndices.length,
    commit,
    dispose: disposePool,
  };

  state.instancedPools.add(api);

  return api;
}

/**
 * Creates the shared particle system instance.
 * @param {Object} params
 * @param {typeof import('three')} params.THREE
 * @param {import('three').Scene} params.scene
 */
export function createParticleSystem({ THREE, scene }) {
  if (!THREE) {
    throw new Error('createParticleSystem requires a valid THREE namespace');
  }
  if (!scene) {
    throw new Error('createParticleSystem requires a scene to attach to');
  }

  let isDisposed = false;
  let elapsedTime = 0;

  const root = new THREE.Group();
  root.name = 'ParticleSystemRoot';
  scene.add(root);

  /** @type {Set<EmitterState>} */
  const activeEmitters = new Set();
  const fluidSurfaceFactories = new Map();
  const fluidSurfaceState = new Map();
  let emitterIdCounter = 0;

  function disposeEmitterState(state) {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    activeEmitters.delete(state);
    for (const pool of state.instancedPools) {
      pool.dispose();
    }
    state.instancedPools.clear();
    try {
      state.emitter.dispose?.();
    } catch (error) {
      console.error('Particle emitter dispose failed:', error);
    }
  }

  function emit(emitter) {
    if (isDisposed) {
      throw new Error('Cannot emit from a disposed particle system');
    }
    if (!emitter || typeof emitter !== 'object') {
      throw new Error('emit expects an emitter object');
    }

    const state = {
      emitter,
      shouldRemove: false,
      disposed: false,
      instancedPools: new Set(),
      debugLabel: null,
      debugId: (emitterIdCounter += 1),
    };

    function createPool(options) {
      return createInstancedPool({
        THREE,
        root,
        state,
        ...options,
      });
    }

    state.createInstancedPool = createPool;

    activeEmitters.add(state);

    try {
      emitter.initialize?.({
        THREE,
        createInstancedPool: createPool,
        getElapsedTime: () => elapsedTime,
        root,
      });
      const label =
        typeof emitter.debugLabel === 'string'
          ? emitter.debugLabel
          : typeof emitter.label === 'string'
          ? emitter.label
          : null;
      state.debugLabel = label;
    } catch (error) {
      console.error('Particle emitter initialize failed:', error);
      state.shouldRemove = true;
    }

    if (!emitter.update && state.instancedPools.size === 0) {
      disposeEmitterState(state);
    }

    return {
      stop: () => {
        state.shouldRemove = true;
      },
      getActiveParticleCount: () => {
        let count = 0;
        for (const pool of state.instancedPools) {
          count += pool.getActiveCount();
        }
        return count;
      },
    };
  }

  function attachFactoryToSurface(info, factory) {
    if (!info || typeof factory !== 'function') {
      return;
    }
    let attachment = null;
    try {
      attachment = factory({
        mesh: info.mesh,
        type: info.type,
        emit,
        THREE,
        getElapsedTime: () => elapsedTime,
        cues: Array.isArray(info.mesh.userData?.lifecycleCues)
          ? info.mesh.userData.lifecycleCues.map((cue) => String(cue))
          : [],
        metadata: info.metadata,
      });
    } catch (error) {
      console.error('Fluid surface effect factory failed:', error);
      attachment = null;
    }
    if (!attachment) {
      return;
    }
    info.attachments.set(factory, attachment);
  }

  function detachFactoryFromSurface(info, factory) {
    if (!info) {
      return;
    }
    const attachment = info.attachments.get(factory);
    if (!attachment) {
      return;
    }
    info.attachments.delete(factory);
    try {
      attachment.dispose?.();
    } catch (error) {
      console.error('Fluid surface effect dispose failed:', error);
    }
  }

  function notifyFluidSurfaceCreated({ type, mesh, runtime } = {}) {
    if (!mesh || !type) {
      return;
    }
    const normalizedType = String(type);
    const info = {
      type: normalizedType,
      mesh,
      runtime: runtime ?? null,
      attachments: new Map(),
      metadata: mesh.userData ?? {},
    };
    fluidSurfaceState.set(mesh, info);
    const factories = fluidSurfaceFactories.get(normalizedType);
    if (!factories) {
      return;
    }
    factories.forEach((factory) => {
      if (!info.attachments.has(factory)) {
        attachFactoryToSurface(info, factory);
      }
    });
  }

  function notifyFluidSurfaceDisposed({ mesh } = {}) {
    if (!mesh) {
      return;
    }
    const info = fluidSurfaceState.get(mesh);
    if (!info) {
      return;
    }
    const factories = Array.from(info.attachments.keys());
    factories.forEach((factory) => {
      detachFactoryFromSurface(info, factory);
    });
    fluidSurfaceState.delete(mesh);
  }

  function registerFluidSurfaceEffect(type, factory) {
    if (!type) {
      throw new Error('registerFluidSurfaceEffect requires a fluid type.');
    }
    if (typeof factory !== 'function') {
      throw new Error('registerFluidSurfaceEffect expects a factory function.');
    }
    const normalizedType = String(type);
    let factories = fluidSurfaceFactories.get(normalizedType);
    if (!factories) {
      factories = new Set();
      fluidSurfaceFactories.set(normalizedType, factories);
    }
    factories.add(factory);
    fluidSurfaceState.forEach((info) => {
      if (info.type === normalizedType && !info.attachments.has(factory)) {
        attachFactoryToSurface(info, factory);
      }
    });
    return () => {
      const registered = fluidSurfaceFactories.get(normalizedType);
      if (registered) {
        registered.delete(factory);
        if (registered.size === 0) {
          fluidSurfaceFactories.delete(normalizedType);
        }
      }
      fluidSurfaceState.forEach((info) => {
        if (info.type === normalizedType && info.attachments.has(factory)) {
          detachFactoryFromSurface(info, factory);
        }
      });
    };
  }

  function getDebugInfo() {
    const emitters = [];
    let totalActiveParticles = 0;
    activeEmitters.forEach((state) => {
      if (state.disposed) {
        return;
      }
      let activeParticles = 0;
      state.instancedPools.forEach((pool) => {
        activeParticles += pool.getActiveCount();
      });
      totalActiveParticles += activeParticles;
      emitters.push({
        id: state.debugId,
        label: state.debugLabel ?? `Emitter #${state.debugId}`,
        activeParticles,
        pendingRemoval: Boolean(state.shouldRemove),
      });
    });
    emitters.sort((a, b) => a.id - b.id);
    const fluidSurfaces = [];
    fluidSurfaceState.forEach((info) => {
      fluidSurfaces.push({
        type: info.type,
        mesh: info.mesh,
        attachmentCount: info.attachments.size,
      });
    });
    return {
      emitterCount: emitters.length,
      totalActiveParticles,
      emitters,
      fluidSurfaces,
    };
  }

  function update(delta) {
    if (isDisposed) {
      return;
    }

    const deltaSeconds = Math.max(0, delta);
    elapsedTime += deltaSeconds;

    const emitterStates = Array.from(activeEmitters);

    for (const state of emitterStates) {
      if (state.disposed) {
        continue;
      }
      if (typeof state.emitter.update === 'function') {
        let keepAlive = true;
        try {
          const result = state.emitter.update({
            delta: deltaSeconds,
            THREE,
            getElapsedTime: () => elapsedTime,
            createInstancedPool: state.createInstancedPool,
            root,
          });
          if (result === false) {
            keepAlive = false;
          }
        } catch (error) {
          console.error('Particle emitter update failed:', error);
          keepAlive = false;
        }
        if (!keepAlive) {
          state.shouldRemove = true;
        }
      }
    }

    for (const state of emitterStates) {
      if (state.disposed) {
        continue;
      }
      for (const pool of state.instancedPools) {
        pool.commit();
      }
      if (state.shouldRemove) {
        let hasActiveParticles = false;
        for (const pool of state.instancedPools) {
          if (pool.getActiveCount() > 0) {
            hasActiveParticles = true;
            break;
          }
        }
        if (!hasActiveParticles) {
          disposeEmitterState(state);
        }
      }
    }
  }

  function dispose() {
    if (isDisposed) {
      return;
    }
    isDisposed = true;

    for (const state of Array.from(activeEmitters)) {
      disposeEmitterState(state);
    }

    fluidSurfaceState.forEach((info) => {
      const factories = Array.from(info.attachments.keys());
      factories.forEach((factory) => {
        detachFactoryFromSurface(info, factory);
      });
    });
    fluidSurfaceState.clear();
    fluidSurfaceFactories.clear();

    scene.remove(root);
    root.children.length = 0;
  }

  return {
    emit,
    update,
    dispose,
    getDebugInfo,
    registerFluidSurfaceEffect,
    notifyFluidSurfaceCreated,
    notifyFluidSurfaceDisposed,
    root,
  };
}

/**
 * Legacy helper maintained for backwards compatibility. New effects should use
 * {@link createGpuBillboardEmitter} from `./particles/gpu-billboard-emitter.js`.
 */
export { createGpuBillboardEmitter as createBillboardEmitter } from './particles/gpu-billboard-emitter.js';
