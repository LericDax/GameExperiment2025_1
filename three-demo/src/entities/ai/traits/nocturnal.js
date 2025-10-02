export const nocturnalTrait = {
  name: 'nocturnal',
  description: 'Boosts activity and perception while ambient light is low.',
  apply(core, options = {}) {
    const threshold = Math.min(Math.max(options.lightThreshold ?? 0.4, 0), 1);
    const wanderBonus = options.wanderBonus ?? 0.2;

    const beforeUpdate = (context) => {
      const lightLevel = context.environment?.lightLevel ?? context.timeOfDay ?? 0.5;
      const isNight = Number(lightLevel) <= threshold;
      context.flags ??= {};
      context.flags.nocturnalActive = isNight;
      if (isNight) {
        context.flags.wanderBias = (context.flags.wanderBias ?? 0) + wanderBonus;
      } else {
        context.flags.wanderBias = Math.max((context.flags.wanderBias ?? 0) - wanderBonus, 0);
      }
    };

    core.on('beforeUpdate', beforeUpdate);

    return {
      dispose() {
        core.off('beforeUpdate', beforeUpdate);
      },
    };
  },
};

export default nocturnalTrait;
