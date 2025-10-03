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
  metadata: {
    movement: {
      walkDurationRange: [3.5, 6],
      idleDurationRange: [2, 4],
      walkSpeed: 0.9,
      walkAcceleration: 2.4,
      walkDeceleration: 3.2,
      idleYawAmount: 0.35,
      idleYawSpeed: 0.7,
      walkHeadingJitter: Math.PI / 2,
      minHeadingDelta: (10 * Math.PI) / 180,
      headingChangeBias: Math.PI - (10 * Math.PI) / 180,
      collisionIdleDuration: 2,
      turnInPlaceDuration: 1.25,
      turnAlignmentThreshold: 0.12,
      turnResumeClearance: 0.65,
      blockedHeadingMemoryDuration: 4,
      blockedHeadingAvoidanceAngle: Math.PI / 2.5,
      headingClearanceThreshold: 0.55,
      runnerAnimationSpeedScale: 1,
      runnerAnimationSpeedFloor: 0.35,
      runnerAnimationSpeedCeil: 1.2,
      headingTurnSpeed: 6,
    },
    presentation: {
      states: {
        idle: { animation: { variant: 'idle', fadeDuration: 0.35 } },
        walk: { animation: { variant: 'runner', fadeDuration: 0.2 } },
        turn: { animation: { variant: 'idle', fadeDuration: 0.2 } },
        'mob-idle:idle': { animation: { variant: 'idle', fadeDuration: 0.35 } },
        'mob-idle:wander': { animation: { variant: 'runner', fadeDuration: 0.2 } },
        'mob-idle:chase': { animation: { variant: 'runner', fadeDuration: 0.15 } },
      },
    },
  },
};

export default spectralRunnerPersona;
