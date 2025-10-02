export const packHunterTrait = {
  name: 'packHunter',
  description: 'Coordinates tactics with nearby allies and boosts aggression when the pack is assembled.',
  apply(core, options = {}) {
    const minAllies = Math.max(options.minAllies ?? 2, 0);
    const formation = options.formation ?? 'encircle';

    const afterUpdate = (context) => {
      const allies = Number(context.percepts?.allyCount ?? 0);
      const hasPack = allies >= minAllies;
      context.flags ??= {};
      context.flags.packPresence = allies;
      context.flags.packReady = hasPack;
      if (hasPack) {
        context.tactics ??= {};
        context.tactics.formation = formation;
        context.tactics.preferredTarget = context.percepts?.targetId ?? null;
      }
    };

    core.on('afterUpdate', afterUpdate);

    return {
      dispose() {
        core.off('afterUpdate', afterUpdate);
      },
    };
  },
};

export default packHunterTrait;
