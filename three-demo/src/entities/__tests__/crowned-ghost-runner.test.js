import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const SENTINEL_ACTION = { id: 'ghost-runner-action' };

class StubAnimationController {
  static instances = [];

  constructor({ variantClips } = {}) {
    this.variantClips = variantClips ?? new Map();
    this.playCalls = [];
    this.setVariantClipCalls = [];
    this.activeVariantId = null;
    this.disposeCalled = false;
    StubAnimationController.instances.push(this);
  }

  setVariantClips(next) {
    this.variantClips = next;
    this.setVariantClipCalls.push(next);
  }

  playVariant(variantId) {
    this.playCalls.push(variantId);
    this.activeVariantId = variantId;
    return SENTINEL_ACTION;
  }

  dispose() {
    this.disposeCalled = true;
  }
}

test('CrownedGhostRunnerEntity alternates between idle and walk states with animation swaps', async () => {
  const fakeLoader = {
    createVariantInstance: async () => ({
      scene: new THREE.Group(),
      animations: [new THREE.AnimationClip('Idle', -1, [])],
      variants: {
        runner: [new THREE.AnimationClip('Runner', -1, [])],
      },
      dispose() {},
    }),
  };

  const randomValues = [0.25, 0.35, 0.8, 0.6, 0.4];
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

  assert.equal(StubAnimationController.instances.length, 1, 'should create one animation controller');
  const controller = StubAnimationController.instances[0];

  assert.equal(entity.behaviorState, 'idle', 'entity should begin in idle state');
  assert.ok(controller.playCalls.includes('idle'), 'idle animation should play on spawn');

  let elapsed = 0;
  const step = (dt) => {
    elapsed += dt;
    entity.update({ delta: dt, elapsedTime: elapsed });
  };

  const initialYaw = entity.root.rotation.y;
  step(0.1);
  assert.ok(
    Math.abs(entity.root.rotation.y - initialYaw) > 1e-5,
    'idle update should adjust yaw over time',
  );

  step(0.12);
  assert.equal(entity.behaviorState, 'walk', 'entity should transition to walk after idle timer');
  assert.ok(controller.playCalls.includes('runner'), 'runner animation should play during walk');
  assert.ok(
    Math.abs(entity.angleDifference(entity.headingAngle, entity.previousHeadingAngle)) > 0.05,
    'walk state should select a new heading angle',
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
    entity.root.position.distanceTo(walkStart) > 0.05,
    'walk update should move the entity forward',
  );

  const preCollisionPlayCount = controller.playCalls.length;
  step(0.1);
  assert.equal(entity.behaviorState, 'idle', 'collision should force an early return to idle');
  assert.ok(
    controller.playCalls.length > preCollisionPlayCount && controller.playCalls.at(-1) === 'idle',
    'idle animation should resume after collision stop',
  );

  entity.dispose();
  assert.ok(controller.disposeCalled, 'dispose should propagate to the animation controller');
});
