import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { EntityAssetLoader } from '../entity-asset-loader.js';

if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

class StubAnimationController {
  static instances = [];

  constructor({ variantClips } = {}) {
    this.variantClips = variantClips instanceof Map ? new Map(variantClips) : new Map();
    this.playCalls = [];
    this.setVariantClipCalls = [];
    this.activeVariantId = null;
    this.disposeCalled = false;
    this.speed = 1;
    this.stopCalls = [];
    StubAnimationController.instances.push(this);
  }

  setVariantClips(next) {
    this.variantClips = next instanceof Map ? new Map(next) : new Map();
    this.setVariantClipCalls.push(this.variantClips);
  }

  playVariant(variantId, options = {}) {
    const clips = this.variantClips.get(variantId) ?? [];
    const hasClips = Array.isArray(clips) ? clips.length > 0 : false;
    const call = { variantId, options, hasClips };
    this.playCalls.push(call);
    if (!hasClips) {
      return null;
    }
    this.activeVariantId = variantId;
    return { id: `ghost-runner-action-${variantId}` };
  }

  setSpeed(nextSpeed) {
    this.speed = nextSpeed;
  }

  stop(options = {}) {
    this.stopCalls.push(options);
  }

  dispose() {
    this.disposeCalled = true;
  }
}

class FileSystemEntityAssetLoader extends EntityAssetLoader {
  constructor(options = {}) {
    super(options);
  }

  async loadGLTF(url) {
    const source = String(url ?? '');
    if (!source) {
      throw new Error('EntityAssetLoader.loadGLTF requires a URL.');
    }

    if (!source.startsWith('file:')) {
      return super.loadGLTF(url);
    }

    if (this.cache.has(source)) {
      const entry = this.cache.get(source);
      if (entry.asset) {
        return entry.asset;
      }
      return entry.promise;
    }

    const entry = {};
    const promise = (async () => {
      const fileUrl = new URL(source);
      const filePath = fileURLToPath(fileUrl);
      const fileData = await readFile(filePath);
      const arrayBuffer = fileData.buffer.slice(
        fileData.byteOffset,
        fileData.byteOffset + fileData.byteLength,
      );
      const directory = `${path.dirname(filePath)}/`;
      const gltf = await this.loader.parseAsync(arrayBuffer, directory);
      entry.asset = gltf;
      return gltf;
    })();

    entry.promise = promise.catch((error) => {
      this.cache.delete(source);
      throw error;
    });

    this.cache.set(source, entry);
    return entry.promise;
  }
}

test('CrownedGhostRunnerEntity alternates between idle and walk states with animation swaps', async () => {
  let receivedConfig;
  const idleClip = new THREE.AnimationClip('Ghost_Guy_Runner_Idle', -1, []);
  const runnerClip = new THREE.AnimationClip('Ghost_Guy_Runner', -1, []);
  const fakeLoader = {
    createVariantInstance: async (config) => {
      receivedConfig = config;
      return {
        scene: new THREE.Group(),
        animations: [idleClip, runnerClip],
        dispose() {},
      };
    },
  };

  const randomValues = [0.25, 0.35, 0.8, 0.6, 0.4, 0.2, 0.75];
  const random = () => {
    if (randomValues.length === 0) {
      return 0.5;
    }
    return randomValues.shift();
  };

  const { CrownedGhostRunnerEntity } = await import('../crowned-ghost-runner.js');

  StubAnimationController.instances.length = 0;

  const entity = new CrownedGhostRunnerEntity({
    THREE,
    assetLoader: fakeLoader,
    animationControllerClass: StubAnimationController,
    random,
    behavior: {
      walkDurationRange: [0.3, 0.3],
      idleDurationRange: [0.2, 0.2],
      walkSpeed: 2,
      idleYawAmount: 0.2,
      idleYawSpeed: 1.5,
      collisionIdleDuration: 0.15,
      walkHeadingJitter: Math.PI / 3,
    },
  });

  entity.onSpawn();
  await entity.assetLoadPromise;

  assert.ok(receivedConfig, 'runner entity should request an asset config');
  assert.match(
    receivedConfig.baseUrl ?? '',
    /entity_ghost_guy_1_runner\.glb$/i,
    'runner config should point to the dedicated runner GLB',
  );
  const variantUrlCount =
    receivedConfig && typeof receivedConfig.variantUrls === 'object'
      ? Object.keys(receivedConfig.variantUrls).length
      : 0;
  assert.equal(
    variantUrlCount,
    0,
    'runner config should not include external variant URLs',
  );
  assert.equal(
    entity.variantClipMap.get('idle')?.[0],
    idleClip,
    'idle variant should originate from the runner asset animations',
  );
  assert.equal(
    entity.variantClipMap.get('runner')?.[0],
    runnerClip,
    'runner variant should originate from the runner asset animations',
  );

  const initialForward = entity.forward.clone();
  const initialBasis = entity.getVisualForwardBasis(new THREE.Vector3());
  assert.ok(
    initialForward.angleTo(initialBasis) < 1e-6,
    'entity.forward should match the mesh basis before updates',
  );
  const sensorContext = entity.getSensorContext();
  assert.equal(
    sensorContext.forward,
    entity.forward,
    'sensor context should surface the shared forward vector reference',
  );

  assert.equal(StubAnimationController.instances.length, 1, 'should create one animation controller');
  const controller = StubAnimationController.instances[0];

  assert.equal(entity.currentMovementState, 'idle', 'entity should begin in idle state');
  assert.ok(
    controller.playCalls.some((call) => call.variantId === 'idle'),
    'idle animation should play on spawn',
  );

  let elapsed = 0;
  const step = (dt) => {
    elapsed += dt;
    entity.update({ delta: dt, elapsedTime: elapsed });
  };

  const initialYaw = entity.visualRoot.rotation.y;
  step(0.1);
  assert.ok(
    Math.abs(entity.visualRoot.rotation.y - initialYaw) > 1e-5,
    'idle update should adjust the visual yaw over time',
  );

  step(0.12);
  assert.equal(entity.currentMovementState, 'walk', 'entity should transition to walk after idle timer');
  assert.ok(
    controller.playCalls.some((call) => call.variantId === 'runner' && call.hasClips),
    'runner animation should play during walk',
  );
  assert.ok(
    Number.isFinite(entity.targetHeadingAngle),
    'walk state should compute a target heading angle',
  );

  const collisionSchedule = [
    [],
    [
      {
        label: 'forward',
        isSolid: true,
      },
    ],
  ];
  entity.gatherCollisionSamples = () => collisionSchedule.shift() ?? [];

  const walkStart = entity.root.position.clone();
  step(0.1);
  assert.ok(
    entity.root.position.distanceTo(walkStart) > 0.01,
    'walk update should move the entity forward with acceleration applied',
  );
  const worldForward = entity.getVisualForwardBasis(new THREE.Vector3());
  assert.ok(
    worldForward.angleTo(entity.forward) < 1e-6,
    'entity.forward should stay aligned with the mesh orientation in world space',
  );
  const walkIntent = entity.buildMovementIntent('walk', {});
  assert.ok(walkIntent.movement.vector.isVector3, 'walk intent should include a movement vector');
  assert.ok(
    walkIntent.movement.vector.angleTo(worldForward) < 1e-6,
    'movement vector should align with the mesh-oriented forward basis',
  );
  assert.ok(
    walkIntent.movement.forward?.isVector3,
    'movement intent should expose a forward basis vector',
  );
  assert.ok(
    walkIntent.movement.forward.angleTo(worldForward) < 1e-6,
    'movement intent forward basis should match the mesh orientation',
  );
  assert.ok(
    walkIntent.forward?.isVector3,
    'top-level intent should share the entity forward vector',
  );
  assert.ok(
    walkIntent.forward.angleTo(worldForward) < 1e-6,
    'intent forward vector should align with the entity forward basis',
  );
  const expectedYaw = entity.normalizeAngle(entity.visualYawOffset + entity.getModelForwardYaw());
  const idleIntent = entity.buildMovementIntent('idle', {});
  assert.ok(
    Math.abs(idleIntent.visualYawOffset - expectedYaw) < 1e-6,
    'idle intent yaw offset should include the model forward yaw',
  );
  const turnIntent = entity.buildMovementIntent('turn', {});
  assert.ok(
    Math.abs(turnIntent.movement.visualYawOffset - expectedYaw) < 1e-6,
    'turn intent yaw offset should include the model forward yaw',
  );
  const rootHeading = entity.root.rotation.y;
  const combinedVisualYaw = rootHeading + entity.visualRoot.rotation.y;
  assert.ok(
    Math.abs(combinedVisualYaw - rootHeading) < 1e-3,
    'walk update should keep the visual yaw aligned with the root heading',
  );

  const preCollisionPlayCount = controller.playCalls.length;
  step(0.1);
  assert.equal(entity.currentMovementState, 'turn', 'collision should push the runner into a turn state');
  assert.ok(
    controller.playCalls.length > preCollisionPlayCount &&
      controller.playCalls.at(-1)?.variantId === 'idle',
    'idle animation should resume after collision stop',
  );

  step(0.1);
  assert.equal(entity.currentMovementState, 'walk', 'turning in place should resolve back to walking');

  entity.dispose();
  assert.ok(controller.disposeCalled, 'dispose should propagate to the animation controller');
});

test('CrownedGhostRunnerEntity responds to ambient inspect and linger intents', async () => {
  const idleClip = new THREE.AnimationClip('Ghost_Guy_Runner_Idle', -1, []);
  const runnerClip = new THREE.AnimationClip('Ghost_Guy_Runner', -1, []);
  const fakeLoader = {
    createVariantInstance: async () => ({
      scene: new THREE.Group(),
      animations: [idleClip, runnerClip],
      dispose() {},
    }),
  };

  const random = () => 0.5;

  const { CrownedGhostRunnerEntity } = await import('../crowned-ghost-runner.js');

  StubAnimationController.instances.length = 0;

  const entity = new CrownedGhostRunnerEntity({
    THREE,
    assetLoader: fakeLoader,
    animationControllerClass: StubAnimationController,
    random,
    behavior: {
      walkDurationRange: [0.5, 0.5],
      idleDurationRange: [0.2, 0.2],
      walkSpeed: 2,
      observeDurationRange: [0.4, 0.4],
      postObserveWalkChance: 1,
      postObserveWalkDurationRange: [1.2, 1.2],
      lingerDurationRange: [0.3, 0.3],
      lingerResumeWalkChance: 1,
    },
  });

  entity.onSpawn();
  await entity.assetLoadPromise;

  const controller = StubAnimationController.instances[0];
  let elapsed = 0;
  const step = (dt) => {
    elapsed += dt;
    entity.update({ delta: dt, elapsedTime: elapsed });
  };

  const inspectIntent = {
    type: 'inspect-poi',
    target: { position: { x: 4, y: 0, z: 8 } },
    duration: 0.4,
  };
  entity.aiCore.emit('ambient:intent', inspectIntent, { context: entity.aiCore.context });

  assert.equal(entity.currentMovementState, 'observe', 'inspect intent should switch to observe state');
  assert.equal(entity.behaviorTimer.state, 'observe', 'behavior timer should track the observe state');
  assert.equal(
    controller.playCalls.at(-1)?.variantId,
    'idle',
    'observe state should request the idle animation variant',
  );

  const stationaryPosition = entity.root.position.clone();
  step(0.1);
  const expectedHeading = entity.computeHeadingForTarget(
    new THREE.Vector3(4, entity.root.position.y, 8),
  );
  let observeIterations = 0;
  while (
    Math.abs(entity.headingAngle) <= 1e-3 &&
    entity.currentMovementState === 'observe' &&
    observeIterations < 6
  ) {
    step(0.05);
    observeIterations += 1;
  }
  assert.equal(entity.currentMovementState, 'observe', 'observe state should persist during orientation');
  const rotationMagnitude = Math.abs(entity.headingAngle);
  assert.ok(rotationMagnitude > 1e-3, 'observe state should begin rotating toward the POI');
  assert.equal(
    Math.sign(entity.headingAngle) || 0,
    Math.sign(expectedHeading) || 0,
    'observe rotation should turn toward the POI heading',
  );
  assert.ok(
    entity.root.position.distanceTo(stationaryPosition) < 1e-5,
    'entity should remain stationary while observing',
  );

  for (let i = 0; i < 10 && entity.currentMovementState !== 'walk'; i += 1) {
    step(0.1);
  }
  assert.equal(entity.currentMovementState, 'walk', 'entity should resume walking after observation ends');
  assert.ok(
    Math.abs((entity.behaviorTimer.duration ?? 0) - 1.2) < 1e-6,
    'post-observation walk should use the queued extended duration',
  );

  const lingerIntent = { type: 'linger', duration: 0.3 };
  entity.aiCore.emit('ambient:intent', lingerIntent, { context: entity.aiCore.context });

  assert.equal(entity.currentMovementState, 'interact', 'linger intent should trigger the interact state');
  assert.equal(
    controller.playCalls.at(-1)?.variantId,
    'idle',
    'interact state should play the idle animation variant',
  );

  const interactPosition = entity.root.position.clone();
  step(0.05);
  assert.ok(
    entity.root.position.distanceTo(interactPosition) < 1e-5,
    'entity should stay in place during the linger interaction',
  );

  for (let i = 0; i < 10 && entity.currentMovementState !== 'walk'; i += 1) {
    step(0.1);
  }
  assert.equal(entity.currentMovementState, 'walk', 'entity should resume walking after lingering');
  assert.ok(
    Math.abs((entity.behaviorTimer.duration ?? 0) - 0.5) < 1e-6,
    'post-linger walk should revert to the baseline walk duration',
  );

  entity.dispose();
  assert.ok(controller.disposeCalled, 'dispose should still clean up after ambient state usage');
});

test('CrownedGhostRunnerEntity picks wander headings outside the minimum delta window', async () => {
  const { CrownedGhostRunnerEntity } = await import('../crowned-ghost-runner.js');

  const fakeLoader = {
    createVariantInstance: async () => ({
      scene: new THREE.Group(),
      animations: [],
      dispose() {},
    }),
  };

  StubAnimationController.instances.length = 0;

  const entity = new CrownedGhostRunnerEntity({
    THREE,
    assetLoader: fakeLoader,
    animationControllerClass: StubAnimationController,
    random: () => 0.5,
    behavior: {
      walkHeadingJitter: Math.PI,
      minHeadingDelta: THREE.MathUtils.degToRad(10),
      headingChangeBias: THREE.MathUtils.degToRad(170),
    },
  });

  const scriptedValues = [0.508, 0.98, 0.4];
  let randomIndex = 0;
  const deterministicRandom = () => {
    const value = scriptedValues[randomIndex] ?? scriptedValues.at(-1) ?? 0.5;
    randomIndex += 1;
    return value;
  };
  entity.random = deterministicRandom;
  if (entity.aiCore?.dependencies) {
    entity.aiCore.dependencies.random = deterministicRandom;
  }

  entity.headingAngle = 0;
  entity.targetHeadingAngle = 0;
  entity.previousHeadingAngle = 0;

  const nextHeading = entity.chooseNextHeadingAngle();
  const minDelta = entity.minHeadingDelta;
  const deltaFromPrevious = Math.abs(entity.angleDifference(nextHeading, 0));

  assert.ok(
    deltaFromPrevious >= minDelta - 1e-6,
    'wander candidate should respect the configured minimum heading delta',
  );

  const bias = entity.headingChangeBias;
  const tolerance = THREE.MathUtils.degToRad(5);
  assert.ok(
    Math.abs(deltaFromPrevious - bias) <= tolerance,
    'wander candidate should align with the configured heading change bias',
  );

  entity.setHeadingAngle(nextHeading);
  assert.ok(
    Math.abs(entity.angleDifference(entity.targetHeadingAngle, 0)) >= minDelta - 1e-6,
    'heading assignment should preserve the biased wander heading',
  );

  entity.dispose();
});

test('CrownedGhostRunnerEntity retries runner animation once clips become available', async () => {
  let resolveInstance;
  const deferredInstance = new Promise((resolve) => {
    resolveInstance = resolve;
  });

  let receivedConfig;
  const fakeLoader = {
    createVariantInstance: async (config) => {
      receivedConfig = config;
      return deferredInstance;
    },
  };

  const { CrownedGhostRunnerEntity } = await import('../crowned-ghost-runner.js');

  StubAnimationController.instances.length = 0;

  const entity = new CrownedGhostRunnerEntity({
    THREE,
    assetLoader: fakeLoader,
    animationControllerClass: StubAnimationController,
  });

  entity.onSpawn();

  assert.equal(StubAnimationController.instances.length, 1, 'should create an animation controller');
  const controller = StubAnimationController.instances[0];

  entity.enterWalkState({});

  const initialRunnerCall = controller.playCalls.at(-1);
  assert.equal(initialRunnerCall?.variantId, 'runner', 'should request runner variant immediately');
  assert.equal(
    initialRunnerCall?.options?.fallbackToDefault,
    false,
    'should disable default fallback while awaiting runner clips',
  );

  const initialRunnerIndex = controller.playCalls.length - 1;
  const idleFallbackDuringPending = controller.playCalls.some(
    (call, index) => index > initialRunnerIndex && call.variantId === 'idle',
  );
  assert.equal(
    idleFallbackDuringPending,
    false,
    'should not fall back to idle while runner clips are still pending',
  );

  resolveInstance({
    scene: new THREE.Group(),
    animations: [
      new THREE.AnimationClip('Runner_Idle', -1, []),
      new THREE.AnimationClip('Runner', -1, []),
    ],
    dispose() {},
  });

  await entity.assetLoadPromise;

  assert.ok(receivedConfig, 'runner entity should capture a config for deferred loads');
  assert.match(
    receivedConfig.baseUrl ?? '',
    /entity_ghost_guy_1_runner\.glb$/i,
    'deferred load config should reference the runner GLB',
  );

  entity.update({ delta: 0.016, elapsedTime: 0.016 });

  const successfulRunnerCall = controller.playCalls.find(
    (call) => call.variantId === 'runner' && call.hasClips,
  );
  assert.ok(successfulRunnerCall, 'runner animation should begin once clips are available');
  assert.equal(
    controller.activeVariantId,
    'runner',
    'runner variant should be active after clips resolve',
  );
});

test('CrownedGhostRunnerEntity can play the runner clip from the real GLB asset', async () => {
  const { CrownedGhostRunnerEntity } = await import('../crowned-ghost-runner.js');

  StubAnimationController.instances.length = 0;

  const loader = new FileSystemEntityAssetLoader({ THREE });
  const entity = new CrownedGhostRunnerEntity({
    THREE,
    assetLoader: loader,
    animationControllerClass: StubAnimationController,
  });

  entity.onSpawn();
  const instance = await entity.assetLoadPromise;

  assert.ok(instance, 'runner entity should resolve the real GLB asset instance');
  assert.equal(
    StubAnimationController.instances.length,
    1,
    'real loader should still initialize the animation controller once',
  );

  const controller = StubAnimationController.instances[0];
  assert.ok(controller.variantClips.has('runner'), 'runner clip should be registered with controller');

  const action = entity.playAnimationVariant('runner', { loopMode: THREE.LoopRepeat });
  assert.ok(action, 'playAnimationVariant("runner") should return an action when runner clip is ready');
  assert.equal(controller.activeVariantId, 'runner', 'animation controller should play the runner variant');

  entity.dispose();
});
