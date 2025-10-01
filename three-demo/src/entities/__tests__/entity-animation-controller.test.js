import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityAnimationController } from '../entity-animation-controller.js';

function createFakeThree() {
  let actionId = 0;

  class FakeAction {
    constructor({ clip }) {
      this.clip = clip;
      this.id = ++actionId;
      this.enabled = false;
      this.clampWhenFinished = false;
      this.setEffectiveWeightCalls = [];
      this.timeScaleCalls = [];
      this.loopSettings = [];
      this.resetCalls = 0;
      this.playCalls = [];
      this.stopCalls = [];
      this.crossFadeCalls = [];
      this.fadeOutCalls = [];
      this.timeScale = 1;
    }

    setEffectiveWeight(weight) {
      this.setEffectiveWeightCalls.push(weight);
    }

    setEffectiveTimeScale(multiplier) {
      this.timeScaleCalls.push(multiplier);
      this.timeScale = multiplier;
    }

    setLoop(mode, repetitions) {
      this.loopSettings.push({ mode, repetitions });
    }

    reset() {
      this.resetCalls += 1;
    }

    play() {
      this.playCalls.push({});
    }

    stop() {
      this.stopCalls.push({});
    }

    crossFadeTo(target, duration, warp) {
      this.crossFadeCalls.push({ target, duration, warp });
    }

    fadeOut(duration) {
      this.fadeOutCalls.push(duration);
    }
  }

  class FakeMixer {
    constructor(root) {
      this.root = root;
      this.actionsByClip = new Map();
      this.clipActionCalls = [];
    }

    clipAction(clip) {
      this.clipActionCalls.push(clip);
      if (!this.actionsByClip.has(clip)) {
        const action = new FakeAction({ clip });
        this.actionsByClip.set(clip, action);
      }
      return this.actionsByClip.get(clip);
    }
  }

  return {
    AnimationMixer: FakeMixer,
    LoopRepeat: 0,
    LoopOnce: 1,
    LoopPingPong: 2,
  };
}

let rootId = 0;
function createRoot() {
  rootId += 1;
  return { isObject3D: true, uuid: `root-${rootId}` };
}

function createClip(name) {
  return { name };
}

test('playVariant caches actions per variant and crossfades when switching', () => {
  const THREE = createFakeThree();
  const controller = new EntityAnimationController({
    THREE,
    root: createRoot(),
    variantClips: {
      idle: [createClip('Idle')],
      run: [createClip('Run')],
    },
  });

  const idleActionFirst = controller.playVariant('idle', { fadeDuration: 0 });
  assert.ok(idleActionFirst, 'expected idle action to be created');
  assert.equal(controller.actions.size, 1, 'idle action should be cached');

  const idleActionSecond = controller.playVariant('idle', { fadeDuration: 0 });
  assert.strictEqual(
    idleActionFirst,
    idleActionSecond,
    'playing the same variant should reuse the cached action',
  );
  assert.equal(controller.actions.size, 1, 'no additional actions should be cached');
  assert.equal(
    controller.mixer.clipActionCalls.length,
    1,
    'the mixer should only create a single action for the repeated variant',
  );

  const runAction = controller.playVariant('run', { fadeDuration: 0.5 });
  assert.ok(runAction, 'expected run action to be created');
  assert.equal(controller.actions.size, 2, 'run action should be cached separately');
  assert.equal(idleActionFirst.crossFadeCalls.length, 1, 'idle action should cross fade once');
  assert.deepEqual(idleActionFirst.crossFadeCalls[0], {
    target: runAction,
    duration: 0.5,
    warp: false,
  });
  assert.equal(runAction.playCalls.length, 1, 'run action should be played during cross fade');
  assert.strictEqual(controller.activeAction, runAction);
  assert.equal(controller.activeVariantId, 'run');
});

test('playVariant stops the previous action immediately when fade duration is zero', () => {
  const THREE = createFakeThree();
  const controller = new EntityAnimationController({
    THREE,
    root: createRoot(),
    variantClips: {
      idle: [createClip('Idle')],
      run: [createClip('Run')],
    },
  });

  const idleAction = controller.playVariant('idle', { fadeDuration: 0 });
  assert.equal(
    idleAction.stopCalls.length,
    0,
    'first play should not stop anything yet',
  );

  const runAction = controller.playVariant('run', { fadeDuration: 0 });
  assert.ok(runAction, 'expected run action to be created for zero fade switch');
  assert.equal(
    idleAction.crossFadeCalls.length,
    0,
    'crossFade should not be invoked when fade duration is zero',
  );
  assert.equal(
    idleAction.stopCalls.length,
    1,
    'previous action should be stopped immediately when fading is disabled',
  );
  assert.equal(runAction.playCalls.length, 1, 'new action should still play');
  assert.strictEqual(controller.activeAction, runAction);
  assert.equal(controller.activeVariantId, 'run');
});

test('stop uses fadeOut when available and stop otherwise', () => {
  const THREEWithFade = createFakeThree();
  const controllerWithFade = new EntityAnimationController({
    THREE: THREEWithFade,
    root: createRoot(),
    variantClips: {
      idle: [createClip('Idle')],
    },
  });

  const fadeAction = controllerWithFade.playVariant('idle');
  controllerWithFade.stop({ fadeDuration: 0.75 });
  assert.deepEqual(fadeAction.fadeOutCalls, [0.75], 'fadeOut should be called with the configured duration');
  assert.equal(fadeAction.stopCalls.length, 0, 'stop should not be called when fadeOut is used');

  const THREEWithoutFade = createFakeThree();
  const controllerWithoutFade = new EntityAnimationController({
    THREE: THREEWithoutFade,
    root: createRoot(),
    variantClips: {
      idle: [createClip('Idle')],
    },
  });

  const stopFallbackAction = controllerWithoutFade.playVariant('idle');
  stopFallbackAction.fadeOut = undefined;
  controllerWithoutFade.stop({ fadeDuration: 0.5 });
  assert.equal(
    stopFallbackAction.stopCalls.length,
    1,
    'stop should be called when fadeOut is unavailable',
  );
  assert.equal(
    stopFallbackAction.fadeOutCalls.length,
    0,
    'fadeOut should not be recorded when the method is missing',
  );

  const THREEInstant = createFakeThree();
  const controllerInstant = new EntityAnimationController({
    THREE: THREEInstant,
    root: createRoot(),
    variantClips: {
      idle: [createClip('Idle')],
    },
  });

  const instantAction = controllerInstant.playVariant('idle');
  controllerInstant.stop({ fadeDuration: 0 });
  assert.equal(
    instantAction.stopCalls.length,
    1,
    'stop should be called immediately when fade duration is zero',
  );
  assert.equal(
    instantAction.fadeOutCalls.length,
    0,
    'fadeOut should not run when fade duration is zero',
  );
});

test('setSpeed updates the multiplier on every cached action', () => {
  const THREE = createFakeThree();
  const controller = new EntityAnimationController({
    THREE,
    root: createRoot(),
    variantClips: {
      idle: [createClip('Idle')],
      walk: [createClip('Walk')],
    },
  });

  const idleAction = controller.playVariant('idle');
  const walkAction = controller.playVariant('walk', { fadeDuration: 0 });
  assert.equal(controller.actions.size, 2, 'both actions should be cached before adjusting speed');

  delete walkAction.setEffectiveTimeScale;

  controller.setSpeed(2.5);

  const lastIdleMultiplier = idleAction.timeScaleCalls[idleAction.timeScaleCalls.length - 1];
  assert.equal(controller.speed, 2.5, 'controller speed should track the latest multiplier');
  assert.equal(
    lastIdleMultiplier,
    2.5,
    'idle action should receive the new speed multiplier via setEffectiveTimeScale',
  );
  assert.equal(
    walkAction.timeScale,
    2.5,
    'actions without setEffectiveTimeScale should receive the new multiplier via timeScale property',
  );
});
