export const builderTrait = {
  name: 'builder',
  description: 'Encourages structure crafting by monitoring resource reserves and setting build flags.',
  apply(core, options = {}) {
    const resourceName = options.resource ?? 'construction';
    const reserve = Math.max(options.reserve ?? 0, 0);

    const afterUpdate = (context) => {
      context.resources ??= {};
      const resource = context.resources[resourceName];
      if (!resource) {
        return;
      }
      const available = Number(resource.current ?? resource.initial ?? resource.max ?? 0);
      const cap = Number(resource.max ?? available);
      const ready = available > reserve && cap > 0;
      context.flags ??= {};
      context.flags.canBuild = ready;
      context.flags.buildReserve = reserve;
      context.flags.buildResource = resourceName;
    };

    core.on('afterUpdate', afterUpdate);

    return {
      dispose() {
        core.off('afterUpdate', afterUpdate);
      },
    };
  },
};

export default builderTrait;
