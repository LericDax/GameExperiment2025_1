import * as THREE from 'three';

import { listEntityDefinitions } from './entity-registry.js';

function normalizeVector3(input, THREERef) {
  const vector = new THREERef.Vector3();
  if (!input) {
    return vector;
  }
  if (input.isVector3) {
    vector.copy(input);
    return vector;
  }
  if (Array.isArray(input)) {
    const [x = 0, y = 0, z = 0] = input;
    vector.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
    return vector;
  }
  if (typeof input === 'object') {
    vector.set(
      Number(input.x) || 0,
      Number(input.y) || 0,
      Number(input.z) || 0,
    );
    return vector;
  }
  return vector;
}

export function createEntityManager({
  THREE: injectedTHREE = THREE,
  scene,
  camera = null,
  chunkManager = null,
  playerControls = null,
  terrainHeight = null,
  sampleBiomeAt = null,
  weatherManager = null,
  autoRegister = true,
} = {}) {
  if (!scene) {
    throw new Error('createEntityManager requires a scene reference.');
  }

  const THREERef = injectedTHREE ?? THREE;
  const entityTypes = new Map();
  const entities = new Map();
  const entityMixers = new Map();
  const spawnContexts = new Map();
  const mixers = new Set();
  let nextEntityId = 1;
  let disposed = false;
  let defaultCamera = camera ?? null;
  let defaultPlayerControls = playerControls ?? null;
  let managerApi = null;

  const defaultTimeOfDay = Object.freeze({ normalized: 0, label: 'Unknown' });

  function assertActive() {
    if (disposed) {
      throw new Error('Entity manager has already been disposed.');
    }
  }

  function registerEntityType(definition) {
    assertActive();
    const entry = definition ?? {};
    const { id, label = id, create, metadata = {} } = entry;
    if (!id) {
      throw new Error('registerEntityType requires an id.');
    }
    if (typeof create !== 'function') {
      throw new Error('registerEntityType requires a create factory function.');
    }
    if (entityTypes.has(id)) {
      throw new Error(`Entity type ${id} is already registered.`);
    }
    const record = {
      id,
      label,
      create,
      metadata,
    };
    entityTypes.set(id, record);
    return () => {
      if (!entityTypes.has(id)) {
        return;
      }
      const ids = Array.from(entities.keys());
      ids.forEach((entityId) => {
        const entity = entities.get(entityId);
        if (entity?.typeId === id) {
          managerApi?.despawnEntity(entityId);
        }
      });
      entityTypes.delete(id);
    };
  }

  function buildSpawnContext({ entityId, typeId, position, metadata, userData }) {
    const contextPosition = position.clone();
    const terrainValue =
      typeof terrainHeight === 'function'
        ? terrainHeight(contextPosition.x, contextPosition.z)
        : null;
    const biomeValue =
      typeof sampleBiomeAt === 'function'
        ? sampleBiomeAt(contextPosition.x, contextPosition.z)
        : null;
    const weatherValue = weatherManager?.getCurrentWeather?.() ?? null;

    return {
      entityId,
      typeId,
      position: contextPosition,
      biome: biomeValue,
      weather: weatherValue,
      terrain: {
        height: Number.isFinite(terrainValue) ? terrainValue : null,
      },
      timeOfDay: { ...defaultTimeOfDay },
      metadata: metadata ?? null,
      userData: userData ?? null,
    };
  }

  function updateSpawnContext(entityId, entity, context) {
    if (!context) {
      return;
    }
    context.position.copy(entity.root.position);
    if (typeof sampleBiomeAt === 'function') {
      context.biome = sampleBiomeAt(context.position.x, context.position.z);
    }
    if (typeof terrainHeight === 'function') {
      const terrainValue = terrainHeight(context.position.x, context.position.z);
      context.terrain.height = Number.isFinite(terrainValue) ? terrainValue : null;
    }
    if (weatherManager?.getCurrentWeather) {
      context.weather = weatherManager.getCurrentWeather();
    }
    context.timeOfDay = context.timeOfDay || { ...defaultTimeOfDay };
  }

  function registerMixerForEntity(entityId, root = null) {
    if (!entities.has(entityId)) {
      throw new Error(`Unknown entity ${entityId}; cannot register mixer.`);
    }
    const entity = entities.get(entityId);
    const target = root ?? entity?.root;
    if (!target?.isObject3D) {
      throw new Error('Animation mixers require a valid Object3D root.');
    }
    const mixer = new THREERef.AnimationMixer(target);
    mixers.add(mixer);
    let bucket = entityMixers.get(entityId);
    if (!bucket) {
      bucket = new Set();
      entityMixers.set(entityId, bucket);
    }
    bucket.add(mixer);
    return mixer;
  }

  function spawnEntity(typeId, options = {}) {
    assertActive();
    if (!entityTypes.has(typeId)) {
      throw new Error(`Unknown entity type: ${typeId}`);
    }
    const typeEntry = entityTypes.get(typeId);
    const entityId = options.id ?? `${typeId}-${nextEntityId++}`;
    if (entities.has(entityId)) {
      throw new Error(`Entity id ${entityId} is already in use.`);
    }

    const position = normalizeVector3(options.position, THREERef);
    const spawnContext = buildSpawnContext({
      entityId,
      typeId,
      position,
      metadata: options.metadata,
      userData: options.userData,
    });

    const createParams = {
      id: entityId,
      typeId,
      manager: managerApi,
      THREE: THREERef,
      scene,
      camera: defaultCamera,
      playerControls: defaultPlayerControls,
      chunkManager,
      terrainHeight,
      sampleBiomeAt,
      weatherManager,
      spawnContext,
      options,
    };

    const entity = typeEntry.create(createParams);
    if (!entity) {
      throw new Error(`Entity factory for ${typeId} did not return an instance.`);
    }
    if (!entity.root || !entity.root.isObject3D) {
      throw new Error(
        `Entity type ${typeId} must provide a root THREE.Object3D-compatible node.`,
      );
    }

    entity.id = entityId;
    entity.typeId = typeId;
    entities.set(entityId, entity);
    entityMixers.set(entityId, new Set());
    spawnContexts.set(entityId, spawnContext);

    entity.root.userData = entity.root.userData || {};
    entity.root.userData.entityId = entityId;
    entity.root.userData.entityTypeId = typeId;

    scene.add(entity.root);
    if (options.position) {
      if (typeof entity.setPosition === 'function') {
        entity.setPosition(position);
      } else {
        entity.root.position.copy(position);
      }
    }

    try {
      entity.onSpawn?.(spawnContext, options);
    } catch (error) {
      console.error(`Entity ${entityId} onSpawn hook failed:`, error);
    }

    return entity;
  }

  function disposeMixersForEntity(entityId) {
    const bucket = entityMixers.get(entityId);
    if (!bucket) {
      return;
    }
    bucket.forEach((mixer) => {
      try {
        mixer.stopAllAction?.();
        mixer.uncacheRoot?.();
      } catch (error) {
        console.warn('Failed to dispose animation mixer:', error);
      }
      mixers.delete(mixer);
    });
    entityMixers.delete(entityId);
  }

  function despawnEntity(entityId) {
    if (!entities.has(entityId)) {
      return false;
    }
    const entity = entities.get(entityId);
    entities.delete(entityId);
    spawnContexts.delete(entityId);
    disposeMixersForEntity(entityId);
    if (entity.root?.parent === scene) {
      scene.remove(entity.root);
    }
    try {
      entity.dispose?.({ manager: managerApi });
    } catch (error) {
      console.error(`Entity ${entityId} dispose hook failed:`, error);
    }
    return true;
  }

  function listEntityTypes() {
    return Array.from(entityTypes.values()).map((entry) => ({
      id: entry.id,
      label: entry.label ?? entry.id,
      metadata: entry.metadata ?? null,
    }));
  }

  function getEntityById(entityId) {
    return entities.get(entityId) ?? null;
  }

  function getEntityCount() {
    return entities.size;
  }

  function getEntities() {
    return Array.from(entities.entries()).map(([entityId, entity]) => ({
      id: entityId,
      typeId: entity.typeId,
      entity,
    }));
  }

  function update({
    delta = 0,
    elapsedTime = 0,
    camera: overrideCamera = null,
    playerControls: overrideControls = null,
  } = {}) {
    if (disposed) {
      return;
    }
    const activeCamera = overrideCamera ?? defaultCamera;
    const activeControls = overrideControls ?? defaultPlayerControls;
    mixers.forEach((mixer) => {
      try {
        mixer.update(delta);
      } catch (error) {
        console.error('Animation mixer update failed:', error);
      }
    });
    entities.forEach((entity, entityId) => {
      const context = spawnContexts.get(entityId);
      updateSpawnContext(entityId, entity, context);
      try {
        entity.update?.({
          delta,
          elapsedTime,
          camera: activeCamera,
          playerControls: activeControls,
          manager: managerApi,
          spawnContext: context,
        });
      } catch (error) {
        console.error(`Entity ${entityId} update failed:`, error);
      }
    });
  }

  function setCamera(nextCamera) {
    defaultCamera = nextCamera ?? null;
  }

  function setPlayerControls(nextControls) {
    defaultPlayerControls = nextControls ?? null;
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    const ids = Array.from(entities.keys());
    ids.forEach((entityId) => {
      try {
        despawnEntity(entityId);
      } catch (error) {
        console.error(`Failed to despawn entity ${entityId} during dispose:`, error);
      }
    });
    mixers.forEach((mixer) => {
      try {
        mixer.stopAllAction?.();
        mixer.uncacheRoot?.();
      } catch (error) {
        console.warn('Failed to dispose animation mixer:', error);
      }
    });
    mixers.clear();
    entityMixers.clear();
    spawnContexts.clear();
    entityTypes.clear();
  }

  managerApi = {
    registerEntityType,
    spawnEntity,
    despawnEntity,
    listEntityTypes,
    update,
    dispose,
    registerMixerForEntity,
    getEntityById,
    getEntityCount,
    getEntities,
    setCamera,
    setPlayerControls,
  };

  if (autoRegister) {
    const definitions = listEntityDefinitions({ autoloadOnly: true });
    definitions.forEach((definition) => {
      try {
        if (!entityTypes.has(definition.id)) {
          registerEntityType(definition);
        }
      } catch (error) {
        console.error(`Failed to auto-register entity type ${definition.id}:`, error);
      }
    });
  }

  return managerApi;
}
