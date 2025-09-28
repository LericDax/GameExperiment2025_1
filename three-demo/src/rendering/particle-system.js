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

    scene.remove(root);
    root.children.length = 0;
  }

  return {
    emit,
    update,
    dispose,
    root,
  };
}

/**
 * Legacy helper maintained for backwards compatibility. New effects should use
 * {@link createGpuBillboardEmitter} from `./particles/gpu-billboard-emitter.js`.
 */
export { createGpuBillboardEmitter as createBillboardEmitter } from './particles/gpu-billboard-emitter.js';
