import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EntityAssetLoader } from '../entity-asset-loader.js';

const BASE_BONE_NAMES = [
  'Root',
  'Hip',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'L_Clavicle',
  'L_UpperArm',
  'L_ForeArm',
  'L_Hand',
  'R_Clavicle',
  'R_UpperArm',
  'R_ForeArm',
  'R_Hand',
  'L_Thigh',
  'L_Shin',
  'L_Foot',
  'R_Thigh',
  'R_Shin',
  'R_Foot',
];

function createRig(boneNames) {
  const bones = boneNames.map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });

  bones.forEach((bone, index) => {
    if (index === 0) {
      return;
    }
    bones[index - 1].add(bone);
  });

  const skeleton = new THREE.Skeleton(bones);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.add(bones[0]);
  skinnedMesh.bind(skeleton);

  const scene = new THREE.Group();
  scene.add(skinnedMesh);

  return { scene, skeleton };
}

function createQuaternionTrack(boneName, suffix = 'quaternion') {
  const times = Float32Array.from([0, 0.5, 1]);
  const values = Float32Array.from([
    0, 0, 0, 1,
    0, 0, 0, 1,
    0, 0, 0, 1,
  ]);
  return new THREE.QuaternionKeyframeTrack(`.bones[${boneName}].${suffix}`, times, values);
}

function createClips(clipDefinitions) {
  return clipDefinitions.map(({ name, bones }) => {
    const tracks = bones.map((bone) => createQuaternionTrack(bone));
    return new THREE.AnimationClip(name, -1, tracks);
  });
}

function createSyntheticGLTF({ boneNames, clipDefinitions }) {
  const { scene } = createRig(boneNames);
  const animations = createClips(clipDefinitions);
  return { scene, animations };
}

class SyntheticEntityAssetLoader extends EntityAssetLoader {
  constructor(assets) {
    super();
    this.assets = assets;
  }

  async loadGLTF(url) {
    if (!(url in this.assets)) {
      throw new Error(`Missing synthetic asset for ${url}`);
    }
    return this.assets[url];
  }
}

function extractTrackBoneName(trackName) {
  const match = trackName.match(/\.bones\[([^\]]+)\]/);
  if (match) {
    return match[1];
  }
  const trimmed = trackName.startsWith('.') ? trackName.slice(1) : trackName;
  return trimmed.split('.')[0];
}

test('variant clips retarget to the base rig bone names', async () => {
  const baseRig = createSyntheticGLTF({
    boneNames: BASE_BONE_NAMES,
    clipDefinitions: [],
  });

  const runnerRig = createSyntheticGLTF({
    boneNames: BASE_BONE_NAMES.map((name) => `Runner::${name}`),
    clipDefinitions: [
      {
        name: 'Runner_Run',
        bones: ['Runner::Root', 'Runner::Hip', 'Runner::L_Thigh', 'Runner::R_Thigh'],
      },
      {
        name: 'Runner_Jump',
        bones: ['Runner::Root', 'Runner::Spine2', 'Runner::Head'],
      },
    ],
  });

  const walkerRig = createSyntheticGLTF({
    boneNames: BASE_BONE_NAMES.map((name) => `Walker::${name}`),
    clipDefinitions: [
      {
        name: 'Walker_Walk',
        bones: ['Walker::Root', 'Walker::Hip', 'Walker::L_Foot', 'Walker::R_Foot'],
      },
    ],
  });

  const loader = new SyntheticEntityAssetLoader({
    base: baseRig,
    runner: runnerRig,
    walker: walkerRig,
  });

  const instance = await loader.createVariantInstance({
    baseUrl: 'base',
    variantUrls: {
      runner: 'runner',
      walker: 'walker',
    },
  });

  const baseBoneSet = new Set(BASE_BONE_NAMES);

  ['runner', 'walker'].forEach((variantName) => {
    const clips = instance.variants[variantName];
    assert.ok(Array.isArray(clips) && clips.length > 0, `expected clips for variant ${variantName}`);
    clips.forEach((clip) => {
      assert.ok(clip.tracks.length > 0, `clip ${clip.name} should contain tracks`);
      clip.tracks.forEach((track) => {
        const boneName = extractTrackBoneName(track.name);
        assert.ok(
          baseBoneSet.has(boneName),
          `expected track ${track.name} in ${variantName} clip ${clip.name} to target base bone names`,
        );
      });
    });
  });
});
