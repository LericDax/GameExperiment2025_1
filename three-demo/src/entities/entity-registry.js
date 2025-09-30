const registry = new Map();

function cloneDefinition(definition) {
  if (!definition) {
    return null;
  }
  return {
    id: definition.id,
    label: definition.label,
    create: definition.create,
    metadata: definition.metadata,
    autoload: definition.autoload,
  };
}

export function registerEntityDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('registerEntityDefinition requires a definition object.');
  }
  const { id, create } = definition;
  if (!id) {
    throw new Error('registerEntityDefinition requires an id.');
  }
  if (typeof create !== 'function') {
    throw new Error('registerEntityDefinition requires a create factory function.');
  }
  const entry = {
    id,
    label: definition.label ?? id,
    create,
    metadata: definition.metadata ?? null,
    autoload: definition.autoload !== false,
  };
  registry.set(id, entry);
  return () => {
    registry.delete(id);
  };
}

export function unregisterEntityDefinition(id) {
  registry.delete(id);
}

export function getEntityDefinition(id) {
  return cloneDefinition(registry.get(id));
}

export function listEntityDefinitions({ autoloadOnly = false } = {}) {
  return Array.from(registry.values())
    .filter((entry) => (autoloadOnly ? entry.autoload !== false : true))
    .map((entry) => cloneDefinition(entry));
}

export function applyRegistryToManager(manager, { autoloadOnly = true } = {}) {
  if (!manager || typeof manager.registerEntityType !== 'function') {
    return () => {};
  }
  const definitions = listEntityDefinitions({ autoloadOnly });
  const disposers = [];
  definitions.forEach((definition) => {
    try {
      if (typeof manager.listEntityTypes === 'function') {
        const alreadyRegistered = manager
          .listEntityTypes()
          .some((entry) => entry.id === definition.id);
        if (alreadyRegistered) {
          return;
        }
      }
      const dispose = manager.registerEntityType(definition);
      if (typeof dispose === 'function') {
        disposers.push(dispose);
      }
    } catch (error) {
      console.error(
        `Failed to register entity definition ${definition.id} with manager:`,
        error,
      );
    }
  });
  return () => {
    disposers.splice(0, disposers.length).forEach((dispose) => {
      try {
        dispose();
      } catch (error) {
        console.error('Failed to dispose registered entity definition:', error);
      }
    });
  };
}
