import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EntityAssetLoader } from '../entity-asset-loader.js';

function createRig(boneNames, { collapseSkeleton = false } = {}) {
  const bones = boneNames.map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });

  for (let index = 1; index < bones.length; index += 1) {
    bones[index - 1].add(bones[index]);
  }

  const skeleton = new THREE.Skeleton(bones);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones[0]);
  mesh.bind(skeleton);

  if (collapseSkeleton) {
    skeleton.bones = [];
    skeleton.boneInverses = [];
    skeleton.boneMatrices = new Float32Array(0);
    skeleton.boneTexture = null;
  }

  const scene = new THREE.Group();
  scene.add(mesh);

  return { scene, skeleton };
}

function createQuaternionTrack(boneName) {
  const times = Float32Array.from([0, 0.5, 1]);
  const values = Float32Array.from([
    0, 0, 0, 1,
    0, 0, 0, 1,
    0, 0, 0, 1,
  ]);
  return new THREE.QuaternionKeyframeTrack(`.bones[${boneName}].quaternion`, times, values);
}

function createClip(name, boneNames) {
  const tracks = boneNames.map((boneName) => createQuaternionTrack(boneName));
  return new THREE.AnimationClip(name, -1, tracks);
}

function createSyntheticGLTF({ boneNames, clipBoneNames, collapseSkeleton = false }) {
  const { scene } = createRig(boneNames, { collapseSkeleton });
  const animations = clipBoneNames.length ? [createClip('Variant', clipBoneNames)] : [];
  return { scene, animations };
}

class SyntheticEntityAssetLoader extends EntityAssetLoader {
  constructor(assets) {
    super();
    this.assets = assets;
  }

  async loadGLTF(url) {
    const asset = this.assets[url];
    if (!asset) {
      throw new Error(`SyntheticEntityAssetLoader missing asset for url: ${url}`);
    }
    return asset;
  }
}

test('createVariantInstance retargets variant clips using sanitized bone mappings', async () => {
  const base = createSyntheticGLTF({
    boneNames: ['Hips', 'Spine', 'Head'],
    clipBoneNames: [],
  });

  const variant = createSyntheticGLTF({
    boneNames: ['Hips.001', 'Spine.001', 'Head.001'],
    clipBoneNames: ['Hips.001', 'Head.001'],
  });

  const loader = new SyntheticEntityAssetLoader({ base, variant });
  const { variants } = await loader.createVariantInstance({
    baseUrl: 'base',
    variantUrls: { mismatched: 'variant' },
  });

  const clips = variants.mismatched;
  assert.ok(Array.isArray(clips), 'expected variant clip array');
  assert.equal(clips.length, 1, 'expected a single retargeted clip');

  const [clip] = clips;
  assert.ok(clip.tracks.length > 0, 'retargeted clip should contain animation tracks');

  const trackNames = clip.tracks.map((track) => track.name);
  trackNames.forEach((name) => {
    assert.ok(!name.includes('.001'), `track ${name} should be sanitized`);
  });
  assert.ok(
    trackNames.some((name) => name.includes('Hips')) &&
      trackNames.some((name) => name.includes('Head')),
    'retargeted tracks should target the base rig bones',
  );
});

test('createVariantInstance falls back to rewritten clips when retargeting fails', async () => {
  const base = createSyntheticGLTF({
    boneNames: ['Hips', 'Spine', 'Head'],
    clipBoneNames: [],
  });

  const variant = createSyntheticGLTF({
    boneNames: ['Hips.001', 'Spine.001', 'Head.001'],
    clipBoneNames: ['Hips.001', 'Head.001'],
    collapseSkeleton: true,
  });

  const loader = new SyntheticEntityAssetLoader({ base, variant });
  const capturedWarnings = [];
  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = (...args) => {
    capturedWarnings.push(args.map((value) => String(value)).join(' '));
  };
  console.error = (...args) => {
    capturedWarnings.push(args.map((value) => String(value)).join(' '));
  };

  try {
    const { variants } = await loader.createVariantInstance({
      baseUrl: 'base',
      variantUrls: { fallback: 'variant' },
    });

    const clips = variants.fallback;
    assert.ok(Array.isArray(clips), 'expected variant clip array');
    assert.equal(clips.length, 1, 'expected a single fallback clip');

    const [clip] = clips;
    assert.equal(clip.tracks.length, 2, 'fallback clip should preserve the original track count');
    const trackNames = clip.tracks.map((track) => track.name);

    assert.deepEqual(trackNames, ['.bones[Hips].quaternion', '.bones[Head].quaternion']);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.ok(
    capturedWarnings.some((message) => message.includes('Falling back to source clips')),
    'expected fallback warning to be emitted',
  );
});
