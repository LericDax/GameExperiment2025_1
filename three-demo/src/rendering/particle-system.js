/**
 * @module ParticleSystem
 *
 * Provides a lightweight particle system for the sandbox demo. Consumers create an
 * instance with {@link createParticleSystem} and use {@link ParticleSystem.emit}
 * to register emitters. Emitters are plain objects that may implement the
 * following optional lifecycle methods:
 *
 * - `initialize(context)` — called immediately when the emitter is registered.
 *   Use `context.addParticle(options)` to spawn particles that belong to the
 *   emitter. `options` accepts a `position`, `velocity`, `lifetime` (in
 *   seconds), `color`, `gravity`, `drag`, and `fade` flag. All vector inputs are
 *   cloned internally so the emitter can safely reuse its instances.
 * - `update(context)` — invoked each frame while the emitter is alive. Return
 *   `false` to signal that no more particles should be spawned; the emitter will
 *   remain active until all of its particles expire. The `context` exposes the
 *   same helpers as `initialize`, plus `delta` (frame time in seconds) and
 *   `getActiveParticleCount()`.
 * - `dispose()` — called once when the emitter is removed from the system.
 *
 * For common burst-style effects, {@link createBillboardEmitter} can be used to
 * instantiate a ready-to-go emitter. It supports options such as `count`,
 * `position`, `positionJitter`, `velocity`, `velocityJitter`, `lifetime`,
 * `color`, `gravity`, `drag`, and automatic color fading.
 */

const DEFAULT_CAPACITY = 128;

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
  let capacity = 0;
  let positionsAttribute = null;
  let colorsAttribute = null;

  const geometry = new THREE.BufferGeometry();
  const material = new THREE.PointsMaterial({
    size: 0.25,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  /** @type {Set<EmitterState>} */
  const activeEmitters = new Set();
  /** @type {Particle[]} */
  const particles = [];

  const tempColor = new THREE.Color();

  function ensureCapacity(targetCount) {
    if (capacity >= targetCount) {
      return;
    }

    let nextCapacity = capacity > 0 ? capacity : DEFAULT_CAPACITY;
    while (nextCapacity < targetCount) {
      nextCapacity *= 2;
    }

    const nextPositions = new Float32Array(nextCapacity * 3);
    const nextColors = new Float32Array(nextCapacity * 3);
    if (positionsAttribute) {
      nextPositions.set(positionsAttribute.array);
    }
    if (colorsAttribute) {
      nextColors.set(colorsAttribute.array);
    }

    positionsAttribute = new THREE.BufferAttribute(nextPositions, 3);
    positionsAttribute.setUsage(THREE.DynamicDrawUsage);
    colorsAttribute = new THREE.BufferAttribute(nextColors, 3);
    colorsAttribute.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', positionsAttribute);
    geometry.setAttribute('color', colorsAttribute);
    geometry.setDrawRange(0, particles.length);

    capacity = nextCapacity;
  }

  function writeParticleAttributes(particle) {
    if (!positionsAttribute || !colorsAttribute) {
      return;
    }
    const { index, position, baseColor, age, lifetime, fade } = particle;
    const offset = index * 3;
    positionsAttribute.array[offset] = position.x;
    positionsAttribute.array[offset + 1] = position.y;
    positionsAttribute.array[offset + 2] = position.z;

    const intensity = fade ? Math.max(0, 1 - age / lifetime) : 1;
    tempColor.copy(baseColor).multiplyScalar(intensity);
    colorsAttribute.array[offset] = tempColor.r;
    colorsAttribute.array[offset + 1] = tempColor.g;
    colorsAttribute.array[offset + 2] = tempColor.b;
  }

  function addParticle(options) {
    if (isDisposed) {
      return null;
    }
    const {
      position,
      velocity,
      lifetime,
      color,
      gravity,
      drag = 0,
      fade = true,
      emitterState,
    } = options;

    const resolvedLifetime = Math.max(0.01, Number(lifetime) || 0.01);

    ensureCapacity(particles.length + 1);

    const particle = {
      index: particles.length,
      position: position ? position.clone() : new THREE.Vector3(),
      velocity: velocity ? velocity.clone() : new THREE.Vector3(),
      gravity: gravity ? gravity.clone() : new THREE.Vector3(),
      drag: Math.max(0, Number(drag) || 0),
      lifetime: resolvedLifetime,
      age: 0,
      baseColor: color
        ? color.isColor
          ? color.clone()
          : new THREE.Color(color)
        : new THREE.Color(0xffffff),
      fade: Boolean(fade),
      emitterState: emitterState ?? null,
    };

    particles.push(particle);
    if (emitterState) {
      emitterState.activeParticles += 1;
    }

    writeParticleAttributes(particle);
    geometry.setDrawRange(0, particles.length);
    points.visible = particles.length > 0;

    return particle;
  }

  function swapAndPopParticle(index) {
    const lastIndex = particles.length - 1;
    const particle = particles[index];
    const lastParticle = particles[lastIndex];
    particles[index] = lastParticle;
    lastParticle.index = index;
    writeParticleAttributes(lastParticle);
    particles.pop();

    if (particle.emitterState) {
      particle.emitterState.activeParticles = Math.max(
        0,
        particle.emitterState.activeParticles - 1,
      );
    }
  }

  function removeParticle(index) {
    const lastIndex = particles.length - 1;
    if (index !== lastIndex) {
      swapAndPopParticle(index);
    } else {
      const particle = particles.pop();
      if (particle?.emitterState) {
        particle.emitterState.activeParticles = Math.max(
          0,
          particle.emitterState.activeParticles - 1,
        );
      }
    }

    geometry.setDrawRange(0, particles.length);
    points.visible = particles.length > 0;
  }

  function disposeEmitterState(state) {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    activeEmitters.delete(state);
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
      activeParticles: 0,
      shouldRemove: false,
      disposed: false,
      addParticle: null,
    };

    state.addParticle = (options) =>
      addParticle({
        ...options,
        emitterState: state,
      });

    activeEmitters.add(state);

    try {
      emitter.initialize?.({
        THREE,
        addParticle: state.addParticle,
        getActiveParticleCount: () => state.activeParticles,
      });
    } catch (error) {
      console.error('Particle emitter initialize failed:', error);
      state.shouldRemove = true;
    }

    if (!emitter.update && state.activeParticles === 0) {
      disposeEmitterState(state);
    }

    return {
      stop: () => {
        state.shouldRemove = true;
      },
      getActiveParticleCount: () => state.activeParticles,
    };
  }

  function update(delta) {
    if (isDisposed) {
      return;
    }

    const emitterStates = Array.from(activeEmitters);
    for (const state of emitterStates) {
      if (state.disposed) {
        continue;
      }
      if (typeof state.emitter.update === 'function') {
        let keepAlive = true;
        try {
          const result = state.emitter.update({
            delta,
            THREE,
            addParticle: state.addParticle,
            getActiveParticleCount: () => state.activeParticles,
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

    if (!positionsAttribute || !colorsAttribute) {
      return;
    }

    const deltaSeconds = Math.max(0, delta);

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.age += deltaSeconds;
      if (particle.age >= particle.lifetime) {
        removeParticle(i);
        continue;
      }

      if (!particle.velocity) {
        particle.velocity = new THREE.Vector3();
      }
      if (particle.gravity) {
        particle.velocity.addScaledVector(particle.gravity, deltaSeconds);
      }
      if (particle.drag > 0) {
        const dragFactor = Math.max(0, 1 - particle.drag * deltaSeconds);
        particle.velocity.multiplyScalar(dragFactor);
      }
      particle.position.addScaledVector(particle.velocity, deltaSeconds);

      writeParticleAttributes(particle);
    }

    positionsAttribute.needsUpdate = true;
    colorsAttribute.needsUpdate = true;

    for (const state of emitterStates) {
      if (state.disposed) {
        continue;
      }
      if (
        state.activeParticles === 0 &&
        (state.shouldRemove || !state.emitter.update)
      ) {
        disposeEmitterState(state);
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

    scene.remove(points);
    geometry.dispose();
    material.dispose();

    particles.length = 0;
    positionsAttribute = null;
    colorsAttribute = null;
  }

  return {
    emit,
    update,
    dispose,
    /**
     * Direct access to the shared THREE.Points instance for advanced use cases.
     */
    points,
  };
}

/**
 * Creates a burst-style billboard particle emitter.
 * @param {Object} options
 * @param {import('three').Vector3} [options.position]
 * @param {import('three').Vector3} [options.positionJitter]
 * @param {number} [options.count=12]
 * @param {import('three').Vector3} [options.velocity]
 * @param {import('three').Vector3} [options.velocityJitter]
 * @param {number|{min:number, max:number}} [options.lifetime=1]
 * @param {import('three').ColorRepresentation} [options.color=0xffffff]
 * @param {import('three').Vector3} [options.gravity]
 * @param {number} [options.drag=1.5]
 * @param {boolean} [options.fade=true]
 */
export function createBillboardEmitter(options = {}) {
  const {
    position = null,
    positionJitter = null,
    count = 12,
    velocity = null,
    velocityJitter = null,
    lifetime = 1,
    color = 0xffffff,
    gravity = null,
    drag = 1.5,
    fade = true,
  } = options;

  function randomInRange(range) {
    if (typeof range === 'number') {
      return range;
    }
    if (!range) {
      return 0;
    }
    const min = 'min' in range ? Number(range.min) : 0;
    const max = 'max' in range ? Number(range.max) : 0;
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return 0;
    }
    if (min === max) {
      return min;
    }
    return min + Math.random() * (max - min);
  }

  return {
    initialize({ addParticle, THREE }) {
      const basePosition = position?.clone() ?? new THREE.Vector3();
      const baseVelocity = velocity?.clone() ?? new THREE.Vector3();
      const jitterPosition = positionJitter?.clone() ?? new THREE.Vector3();
      const jitterVelocity = velocityJitter?.clone() ?? new THREE.Vector3();
      const baseGravity = gravity?.clone() ?? new THREE.Vector3(0, -3, 0);
      const baseColor =
        color && color.isColor ? color : new THREE.Color(color ?? 0xffffff);

      for (let i = 0; i < Math.max(0, Math.floor(count)); i += 1) {
        const spawnPosition = basePosition.clone();
        if (jitterPosition.lengthSq() > 0) {
          spawnPosition.x += (Math.random() - 0.5) * jitterPosition.x;
          spawnPosition.y += (Math.random() - 0.5) * jitterPosition.y;
          spawnPosition.z += (Math.random() - 0.5) * jitterPosition.z;
        }

        const spawnVelocity = baseVelocity.clone();
        if (jitterVelocity.lengthSq() > 0) {
          spawnVelocity.x += (Math.random() - 0.5) * jitterVelocity.x;
          spawnVelocity.y += (Math.random() - 0.5) * jitterVelocity.y;
          spawnVelocity.z += (Math.random() - 0.5) * jitterVelocity.z;
        }

        const particleLifetime = randomInRange(lifetime);

        addParticle({
          position: spawnPosition,
          velocity: spawnVelocity,
          lifetime: particleLifetime,
          color: baseColor,
          gravity: baseGravity,
          drag,
          fade,
        });
      }
    },
    update({ getActiveParticleCount }) {
      return getActiveParticleCount() > 0;
    },
  };
}

/**
 * @typedef {Object} Particle
 * @property {number} index
 * @property {import('three').Vector3} position
 * @property {import('three').Vector3} velocity
 * @property {import('three').Vector3} gravity
 * @property {number} drag
 * @property {number} lifetime
 * @property {number} age
 * @property {import('three').Color} baseColor
 * @property {boolean} fade
 * @property {EmitterState|null} emitterState
 */

/**
 * @typedef {Object} EmitterState
 * @property {Object} emitter
 * @property {number} activeParticles
 * @property {boolean} shouldRemove
 * @property {boolean} disposed
 * @property {(options: Object) => Particle|null} addParticle
 */
