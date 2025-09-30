import { BaseEntity } from './entity-base.js';
import { getSharedEntityAssetLoader } from './entity-asset-loader.js';

const MODEL_URL = new URL('../models/entity_ghost_guy_1_runner.glb', import.meta.url).href;
const DESIRED_HEIGHT = 1.6;

export class CrownedGhostEntity extends BaseEntity {
  constructor(params = {}) {
    super(params);

    this.assetLoader = params.assetLoader ?? getSharedEntityAssetLoader({ THREE: this.THREE });
    this.visualRoot = new this.THREE.Group();
    this.visualRoot.name = 'CrownedGhost.VisualRoot';
    this.root.add(this.visualRoot);

    this.mixer = null;
    this.activeAction = null;
    this.assetInstance = null;
    this.assetLoadPromise = null;
    this.isSpawned = false;

    this.hoverPhase = Math.random() * Math.PI * 2;
    this.hoverSpeed = 1.15 + Math.random() * 0.35;
    this.hoverAmplitude = 0.22;
    this.baseHoverOffset = 0.35;

    this.swayPhase = Math.random() * Math.PI * 2;
    this.swaySpeed = 0.6 + Math.random() * 0.25;
    this.swayAmplitude = 0.18;

    this.forwardBaseAngle = Math.random() * Math.PI * 2;
    this.forwardDriftAmplitude = 0.35;
    this.forwardDriftFrequency = 0.25 + Math.random() * 0.15;
    this.forwardSpeed = 0.35 + Math.random() * 0.25;
    this.forwardDirection = new this.THREE.Vector3(0, 0, 1);

    this.assetLoadPromise = this.assetLoader
      .createInstance(MODEL_URL)
      .then((instance) => {
        if (this.isDisposed) {
          instance.dispose?.();
          return null;
        }
        this.assetInstance = instance;
        this.tryAttachAsset();
        return instance;
      })
      .catch((error) => {
        console.error('Failed to load Crowned Ghost model:', error);
        return null;
      });
  }

  onSpawn() {
    this.isSpawned = true;
    this.tryAttachAsset();
  }

  tryAttachAsset() {
    if (!this.isSpawned || !this.assetInstance || this.visualRoot.children.length > 0) {
      return;
    }

    const scene = this.assetInstance.scene;
    scene.name = 'CrownedGhost.Scene';
    this.visualRoot.add(scene);

    this.normalizeScene(scene);
    this.enableShadows(scene);
    this.setupAnimation();
  }

  normalizeScene(scene) {
    if (!scene) {
      return;
    }
    scene.updateMatrixWorld(true);
    const box = new this.THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) {
      return;
    }
    const size = new this.THREE.Vector3();
    box.getSize(size);
    const height = size.y || 1;
    const scale = DESIRED_HEIGHT / height;
    scene.scale.setScalar(scale);

    scene.updateMatrixWorld(true);
    const scaledBox = new this.THREE.Box3().setFromObject(scene);
    const center = new this.THREE.Vector3();
    scaledBox.getCenter(center);
    scene.position.sub(center);
    scene.position.y -= scaledBox.min.y;
    scene.rotation.y = Math.PI;
  }

  enableShadows(scene) {
    scene.traverse((child) => {
      if (child.isLight) {
        return;
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  setupAnimation() {
    if (!this.assetInstance || !this.manager) {
      return;
    }
    const animations = this.assetInstance.animations ?? [];
    if (animations.length === 0) {
      return;
    }
    const runningClip =
      animations.find((clip) =>
        typeof clip?.name === 'string' && clip.name.toLowerCase().includes('run'),
      ) ?? animations[0];

    if (!runningClip) {
      return;
    }

    let mixer = null;
    try {
      mixer = this.manager.registerMixerForEntity?.(this.id, this.visualRoot);
    } catch (error) {
      console.warn('Failed to register mixer with manager; using local mixer.', error);
    }
    if (!mixer) {
      mixer = new this.THREE.AnimationMixer(this.visualRoot);
    }

    this.mixer = mixer;
    this.activeAction = mixer.clipAction(runningClip);
    this.activeAction.setLoop(this.THREE.LoopRepeat, Infinity);
    this.activeAction.clampWhenFinished = false;
    this.activeAction.enable = true;
    this.activeAction.play();
  }

  update({ delta = 0, elapsedTime = 0 } = {}) {
    if (!this.visualRoot) {
      return;
    }
    const hoverValue = Math.sin(elapsedTime * this.hoverSpeed + this.hoverPhase);
    this.visualRoot.position.y = this.baseHoverOffset + hoverValue * this.hoverAmplitude;

    const swayValue = Math.sin(elapsedTime * this.swaySpeed + this.swayPhase);
    this.visualRoot.position.x = swayValue * this.swayAmplitude;

    const driftAngle =
      this.forwardBaseAngle +
      Math.sin(elapsedTime * this.forwardDriftFrequency + this.hoverPhase) * this.forwardDriftAmplitude;
    this.forwardDirection.set(Math.sin(driftAngle), 0, Math.cos(driftAngle));

    const step = Math.max(0, delta) * this.forwardSpeed;
    if (step > 0) {
      this.root.position.addScaledVector(this.forwardDirection, step);
      this.root.rotation.y = Math.atan2(this.forwardDirection.x, this.forwardDirection.z);
      this.markBoundsDirty();
    }
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    if (this.activeAction) {
      try {
        this.activeAction.stop();
      } catch (error) {
        console.warn('Failed to stop Crowned Ghost animation action.', error);
      }
    }

    if (this.mixer) {
      try {
        this.mixer.stopAllAction?.();
        this.mixer.uncacheRoot?.(this.visualRoot);
      } catch (error) {
        console.warn('Failed to dispose Crowned Ghost mixer.', error);
      }
    }
    this.activeAction = null;
    this.mixer = null;

    if (this.visualRoot?.parent === this.root) {
      this.root.remove(this.visualRoot);
    }
    if (this.assetInstance) {
      if (this.assetInstance.scene?.parent) {
        this.assetInstance.scene.parent.remove(this.assetInstance.scene);
      }
      this.assetInstance.dispose?.();
      this.assetInstance = null;
    }
    this.visualRoot?.clear();
    this.assetLoadPromise = null;
    this.isSpawned = false;
  }
}
