export function createMeshMorpher({ THREE }) {
  if (!THREE) {
    throw new Error('createMeshMorpher requires a valid THREE namespace');
  }

  const registry = new Map();

  function registerMesh(mesh, { attributes = ['position'], resetOnUpdate = true } = {}) {
    if (!mesh || !mesh.geometry) {
      throw new Error('Mesh morphing requires a mesh with geometry');
    }

    if (registry.has(mesh)) {
      return registry.get(mesh);
    }

    if (!Array.isArray(attributes) || attributes.length === 0) {
      throw new Error('Mesh morphing requires at least one attribute to track');
    }

    const trackedAttributes = attributes.map((name) => {
      const attribute = mesh.geometry.getAttribute(name);
      if (!attribute) {
        throw new Error(`Mesh geometry is missing attribute "${name}" required for morphing`);
      }

      if (typeof attribute.setUsage === 'function') {
        attribute.setUsage(THREE.DynamicDrawUsage);
      }

      return {
        name,
        attribute,
        base: attribute.array.slice(0),
      };
    });

    const record = {
      mesh,
      attributes: trackedAttributes,
      effects: new Set(),
      resetOnUpdate,
    };

    registry.set(mesh, record);
    return record;
  }

  function unregisterMesh(mesh) {
    const record = registry.get(mesh);
    if (!record) {
      return;
    }

    record.attributes.forEach(({ attribute, base }) => {
      attribute.array.set(base);
      attribute.needsUpdate = true;
    });

    registry.delete(mesh);
  }

  function addEffect(mesh, effect) {
    if (typeof effect !== 'function') {
      throw new Error('Morph effects must be provided as functions');
    }

    const record = registry.get(mesh);
    if (!record) {
      throw new Error('Mesh must be registered with the morph system before adding effects');
    }

    record.effects.add(effect);
    return () => {
      record.effects.delete(effect);
    };
  }

  function hasMesh(mesh) {
    return registry.has(mesh);
  }

  function update(delta, context = {}) {
    if (!delta || delta <= 0) {
      return;
    }

    registry.forEach((record, mesh) => {
      if (!mesh || !mesh.geometry) {
        registry.delete(mesh);
        return;
      }

      if (record.resetOnUpdate) {
        record.attributes.forEach(({ attribute, base }) => {
          attribute.array.set(base);
        });
      }

      if (record.effects.size === 0) {
        return;
      }

      const effectContext = {
        ...context,
        delta,
        mesh,
        attributes: record.attributes,
        getAttribute: (name) => {
          const entry = record.attributes.find((item) => item.name === name);
          return entry ? entry.attribute : null;
        },
        getAttributeData: (name) => {
          return record.attributes.find((item) => item.name === name) ?? null;
        },
      };

      record.effects.forEach((effect) => {
        effect(effectContext);
      });

      record.attributes.forEach(({ attribute }) => {
        attribute.needsUpdate = true;
      });
    });
  }

  return {
    registerMesh,
    unregisterMesh,
    addEffect,
    hasMesh,
    update,
  };
}
