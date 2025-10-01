import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CrownedGhostEntity } from '../crowned-ghost.js';

function createVariantOnlyInstance() {
  return {
    scene: new THREE.Group(),
    animations: [],
    variants: {
      walker: [new THREE.AnimationClip('Walker', -1, [])],
    },
    dispose() {},
  };
}

test('CrownedGhostEntity falls back to first available variant when idle is missing', async () => {
  const instance = createVariantOnlyInstance();
  let loaderCalls = 0;
  const assetLoader = {
    createVariantInstance: async () => {
      loaderCalls += 1;
      return instance;
    },
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };

  try {
    const entity = new CrownedGhostEntity({ assetLoader, THREE });
    entity.onSpawn();

    await entity.assetLoadPromise;
    await Promise.resolve();

    assert.equal(loaderCalls, 1, 'asset loader should be invoked once');
    assert.ok(entity.animationController, 'animation controller should be created after spawn');
    assert.equal(
      entity.desiredAnimationVariant,
      'walker',
      'desired animation should update to the fallback variant',
    );
    assert.equal(
      entity.animationController.activeVariantId,
      'walker',
      'active animation should resolve to the fallback variant',
    );
    assert.strictEqual(
      entity.variantClipMap.get('walker'),
      entity.variantClipMap.get('idle'),
      'idle variant should alias to the fallback clip list',
    );
    assert.equal(
      entity.variantAliasMap.get('idle'),
      'walker',
      'idle should record the fallback alias for later playback',
    );
    assert.ok(
      warnings.some((message) => message.includes('aliasing to "walker"')),
      'aliasing warning should be emitted when falling back from idle',
    );

    entity.dispose();
  } finally {
    console.warn = originalWarn;
  }
});
