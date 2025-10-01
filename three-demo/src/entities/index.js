import { createEntityManager } from './entity-manager.js';
import { BaseEntity } from './entity-base.js';
import {
  registerEntityDefinition,
  unregisterEntityDefinition,
  getEntityDefinition,
  listEntityDefinitions,
  applyRegistryToManager,
} from './entity-registry.js';
import {
  EntityAssetLoader,
  createEntityAssetLoader,
  getSharedEntityAssetLoader,
} from './entity-asset-loader.js';
import { EntityAnimationController } from './entity-animation-controller.js';
import { CrownedGhostEntity } from './crowned-ghost.js';
import { CrownedGhostRunnerEntity } from './crowned-ghost-runner.js';

export {
  createEntityManager,
  BaseEntity,
  registerEntityDefinition,
  unregisterEntityDefinition,
  getEntityDefinition,
  listEntityDefinitions,
  applyRegistryToManager,
  EntityAssetLoader,
  createEntityAssetLoader,
  getSharedEntityAssetLoader,
  EntityAnimationController,
  CrownedGhostEntity,
  CrownedGhostRunnerEntity,
};

export function registerEntityFactory(idOrDefinition, factory, options = {}) {
  if (
    typeof idOrDefinition === 'object' &&
    idOrDefinition !== null &&
    typeof idOrDefinition.id === 'string'
  ) {
    const definition = {
      ...idOrDefinition,
      create: idOrDefinition.create ?? factory,
    };
    return registerEntityDefinition(definition);
  }
  const id = idOrDefinition;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('registerEntityFactory requires a string id.');
  }
  if (typeof factory !== 'function') {
    throw new Error('registerEntityFactory requires a factory function.');
  }
  return registerEntityDefinition({
    id,
    label: options.label ?? id,
    metadata: options.metadata ?? null,
    autoload: options.autoload,
    create: factory,
  });
}

export function registerEntityClass({
  id,
  label = id,
  EntityClass,
  metadata = null,
  autoload,
}) {
  if (!id) {
    throw new Error('registerEntityClass requires an id.');
  }
  if (typeof EntityClass !== 'function') {
    throw new Error('registerEntityClass requires an EntityClass constructor.');
  }
  const factory = (params) => new EntityClass(params);
  return registerEntityDefinition({
    id,
    label,
    metadata,
    autoload,
    create: factory,
  });
}

let builtinsRegistered = false;

export function registerBuiltinEntities() {
  if (builtinsRegistered) {
    return;
  }

  const existing = getEntityDefinition('crowned_ghost');
  if (!existing) {
    registerEntityClass({
      id: 'crowned_ghost',
      label: 'Crowned Ghost',
      EntityClass: CrownedGhostEntity,
      metadata: {
        aliases: {
          numeric: [1],
        },
        tags: {
          biomes: ['haunted', 'mistwood', 'luminous_cavern'],
          weather: ['clear', 'foggy', 'storm'],
        },
        animations: {
          default: 'idle',
          variants: {
            idle: 'Default hover idle loop from the base rig.',
            runner: 'High-energy chase loop suitable for pursuit.',
            walker: 'Leisurely patrol loop for ambient wandering.',
          },
        },
      },
    });
  }

  const existingRunner = getEntityDefinition('crowned_ghost_2');
  if (!existingRunner) {
    registerEntityClass({
      id: 'crowned_ghost_2',
      label: 'Crowned Ghost Runner',
      EntityClass: CrownedGhostRunnerEntity,
      metadata: {
        aliases: {
          numeric: [2],
        },
        tags: {
          biomes: ['haunted', 'mistwood', 'luminous_cavern'],
          weather: ['clear', 'foggy', 'storm'],
        },
        animations: {
          default: 'idle',
          variants: {
            idle: 'Base hover idle loop shared with the crowned ghost.',
            runner: 'Ghost guy runner loop used for high-energy wandering.',
          },
        },
      },
    });
  }

  builtinsRegistered = true;
}
