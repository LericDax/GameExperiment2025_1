import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const SENTINEL_ACTION = { id: 'sentinel-action' };

class StubAnimationController {
  static instances = [];

  constructor({ variantClips } = {}) {
    this.variantClips = variantClips ?? new Map();
    this.playCalls = [];
    this.setVariantClipCalls = [];
    this.activeVariantId = null;
    StubAnimationController.instances.push(this);
  }

  setVariantClips(nextClips) {
    this.variantClips = nextClips;
    this.setVariantClipCalls.push(nextClips);
  }

  playVariant(variantId) {
    this.playCalls.push(variantId);
    this.activeVariantId = variantId;
    return SENTINEL_ACTION;
  }

  dispose() {}
}

test('CrownedGhostEntity aliases idle to walker when only walker clips are present', async (t) => {
  const fakeLoader = {
    createVariantInstance: async () => ({
      scene: new THREE.Group(),
      animations: [],
      variants: {
        walker: [new THREE.AnimationClip('Walker', -1, [])],
      },
      dispose() {},
    }),
  };

  const { CrownedGhostEntity } = await import('../crowned-ghost.js');

  StubAnimationController.instances.length = 0;

  const entity = new CrownedGhostEntity({
    THREE,
    assetLoader: fakeLoader,
    animationControllerClass: StubAnimationController,
  });
  entity.onSpawn();
  await entity.assetLoadPromise;
  entity.applyDesiredAnimation();

  assert.equal(StubAnimationController.instances.length, 1, 'animation controller should be created once');
  const controller = StubAnimationController.instances[0];

  assert.ok(controller.playCalls.includes('walker'), 'controller should request the walker variant');
  assert.equal(controller.activeVariantId, 'walker', 'walker should become the active variant');
  assert.equal(entity.desiredAnimationVariant, 'walker', 'entity desired variant should resolve to walker');
  assert.equal(
    entity.variantAliasMap.get('idle'),
    'walker',
    'idle should alias to walker when idle clips are missing',
  );
});
