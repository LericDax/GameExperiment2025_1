import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';
import { TextureLoader } from 'three';

const originalGlobDescriptor = Object.getOwnPropertyDescriptor(import.meta, 'glob');
Reflect.deleteProperty(import.meta, 'glob');

const moduleUrl = new URL('../skyboxes/skybox-manager.js', import.meta.url);
moduleUrl.searchParams.set('fallbackTest', Math.random().toString(36).slice(2));

const skyboxModule = await import(moduleUrl.href);

const { applySkybox, listSkyboxes } = skyboxModule;

let restored = false;

function restoreGlob() {
  if (restored) {
    return;
  }
  restored = true;
  if (originalGlobDescriptor) {
    Object.defineProperty(import.meta, 'glob', originalGlobDescriptor);
  } else {
    Reflect.deleteProperty(import.meta, 'glob');
  }
}

test('skybox manager falls back to Node fs scan when import.meta.glob is unavailable', async (t) => {
  t.after(restoreGlob);

  assert.ok(
    listSkyboxes().includes('skybox-1'),
    'expected fallback registry to include the bundled skybox asset',
  );
  assert.ok(
    listSkyboxes().includes('skybox-1#invertY'),
    'expected fallback registry to register the invertY variant',
  );

  const originalLoadAsync = TextureLoader.prototype.loadAsync;
  const fakeTexture = new THREE.Texture();
  const callLog = [];

  TextureLoader.prototype.loadAsync = async function loadAsyncStub(url) {
    callLog.push(url);
    return fakeTexture;
  };

  t.after(() => {
    TextureLoader.prototype.loadAsync = originalLoadAsync;
  });

  const scene = new THREE.Scene();
  const result = await applySkybox({ THREE, scene, id: 'skybox-1' });

  assert.equal(result.id, 'skybox-1', 'fallback should resolve the requested skybox id');
  assert.equal(result.orientation, 'normal', 'fallback skybox should default to normal orientation');
  assert.equal(scene.background, fakeTexture, 'resolved texture should be applied to the scene');
  assert.equal(
    scene.environment,
    fakeTexture,
    'resolved texture should also populate the environment map',
  );
  assert.equal(callLog.length, 1, 'expected loader stub to be invoked exactly once');
  assert.ok(
    callLog[0].includes('/assets/skyboxes/skybox-1.jpg'),
    'normalized loader URL should target the public assets directory',
  );
});

test.after(restoreGlob);
