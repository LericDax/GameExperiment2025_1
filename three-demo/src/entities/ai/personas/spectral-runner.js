export const spectralRunnerPersona = {
  name: 'spectral-runner',
  label: 'Spectral Runner',
  description: 'An ethereal scout that thrives in low light and coordinates with its pack.',
  traits: [
    { name: 'nocturnal', options: { lightThreshold: 0.45 } },
    { name: 'packHunter', options: { minAllies: 1, formation: 'pincer' } },
    { name: 'builder', options: { resource: 'ectoplasm', reserve: 20 } },
  ],
  sensors: {
    presets: ['spectral-vision', 'echo-location'],
    visionRange: 75,
    hearingRange: 110,
  },
  resources: {
    stamina: { max: 120, regen: 6, initial: 120 },
    ectoplasm: { max: 90, regen: 4, initial: 60 },
  },
  behaviors: [
    {
      name: 'spectral-scouting',
      loop: 'idle',
      priority: 4,
      duration: { min: 3, max: 7, unit: 'seconds' },
      triggers: [
        { type: 'time', after: 1.5 },
        { type: 'percept', key: 'threatLevel', equals: 'low' },
      ],
      options: {
        wanderChance: 0.4,
        idleChance: 0.1,
      },
      metadata: {
        role: 'scout',
      },
    },
    {
      name: 'spectral-chase',
      loop: 'chase',
      priority: 8,
      duration: { min: 5, max: 12, unit: 'seconds' },
      triggers: [{ type: 'percept', key: 'targetVisible', equals: true }],
      options: {
        wanderChance: 0,
        idleChance: 0.05,
      },
      metadata: {
        role: 'hunter',
      },
    },
  ],
};

export default spectralRunnerPersona;
