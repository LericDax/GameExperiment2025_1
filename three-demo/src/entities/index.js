import { createEntityManager } from './entity-manager.js';
import { BaseEntity } from './entity-base.js';
import {
  registerEntityDefinition,
  unregisterEntityDefinition,
  getEntityDefinition,
  listEntityDefinitions,
  applyRegistryToManager,
} from './entity-registry.js';

export {
  createEntityManager,
  BaseEntity,
  registerEntityDefinition,
  unregisterEntityDefinition,
  getEntityDefinition,
  listEntityDefinitions,
  applyRegistryToManager,
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
