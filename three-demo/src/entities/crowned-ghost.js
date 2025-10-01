import { BaseEntity } from './entity-base.js';
import { getSharedEntityAssetLoader } from './entity-asset-loader.js';
import { EntityAnimationController } from './entity-animation-controller.js';

const MODEL_CONFIG = {
  baseUrl: new URL(
    '../models/entity_ghost_guy_1/entity_ghost_guy_1_base.glb',
    import.meta.url,
  ).href,
  variantUrls: {
    runner: new URL(
      '../models/entity_ghost_guy_1/entity_ghost_guy_1_runner.glb',
      import.meta.url,
    ).href,
    walker: new URL(
      '../models/entity_ghost_guy_1/entity_ghost_guy_1_walker.glb',
      import.meta.url,
    ).href,
  },
};

const DEFAULT_ANIMATION_VARIANT = 'idle';
const FALLBACK_VARIANT_PREFERENCE = ['walker', 'runner'];

function chooseFallbackVariant(availableVariants = [], desiredVariant = DEFAULT_ANIMATION_VARIANT) {
  if (!Array.isArray(availableVariants) || availableVariants.length === 0) {
    return null;
  }

  const normalizedDesired = typeof desiredVariant === 'string' ? desiredVariant : null;
  const preferredOrder = [];
  if (normalizedDesired && normalizedDesired !== DEFAULT_ANIMATION_VARIANT) {
    preferredOrder.push(DEFAULT_ANIMATION_VARIANT);
  }
  preferredOrder.push(...FALLBACK_VARIANT_PREFERENCE);

  for (const preferred of preferredOrder) {
    if (
      preferred &&
      preferred !== normalizedDesired &&
      availableVariants.includes(preferred)
    ) {
      return preferred;
    }
  }

  for (const candidate of availableVariants) {
    if (candidate && candidate !== normalizedDesired) {
      return candidate;
    }
  }

  return null;
}

const DESIRED_HEIGHT = 1.6;

export class CrownedGhostEntity extends BaseEntity {
  constructor(params = {}) {
    super(params);

    this.assetLoader = params.assetLoader ?? getSharedEntityAssetLoader({ THREE: this.THREE });
    this.visualRoot = new this.THREE.Group();
    this.visualRoot.name = 'CrownedGhost.VisualRoot';
    this.root.add(this.visualRoot);

    this.animationController = null;
    this.variantClipMap = new Map();
    this.variantAliasMap = new Map();
    this.assetInstance = null;
    this.assetLoadPromise = null;
    this.isSpawned = false;
    this.desiredAnimationVariant = this.normalizeAnimationVariantId(
      params.options?.initialAnimation ?? params.initialAnimation ?? DEFAULT_ANIMATION_VARIANT,
    );

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
      .createVariantInstance(MODEL_CONFIG)
      .then((instance) => {
        if (this.isDisposed) {
          instance.dispose?.();
          return null;
        }
        this.assetInstance = instance;
        this.updateAnimationVariantsFromAsset();
        this.tryAttachAsset();
        return instance;
      })
      .catch((error) => {
        console.error('Failed to load Crowned Ghost model:', error);
        return null;
      });
  }

  onSpawn(spawnContext, options = {}) {
    this.isSpawned = true;
    if (options?.initialAnimation) {
      this.desiredAnimationVariant = this.normalizeAnimationVariantId(
        options.initialAnimation,
      );
    }
    this.ensureAnimationController();
    this.applyDesiredAnimation();
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
    this.ensureAnimationController();
    this.applyDesiredAnimation();
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

  ensureAnimationController() {
    if (this.animationController || !this.visualRoot || !this.isSpawned) {
      return;
    }
    this.animationController = new EntityAnimationController({
      THREE: this.THREE,
      manager: this.manager ?? null,
      entityId: this.id ?? null,
      root: this.visualRoot,
      variantClips: this.variantClipMap,
    });
  }

  updateAnimationVariantsFromAsset() {
    if (!this.assetInstance) {
      return;
    }
    const nextMap = this.buildVariantClipMapFromInstance(this.assetInstance);
    this.variantClipMap = nextMap;
    if (this.animationController) {
      this.animationController.setVariantClips(nextMap);
    }
    if (this.isSpawned) {
      this.applyDesiredAnimation();
    }
  }

  buildVariantClipMapFromInstance(instance) {
    this.variantAliasMap = new Map();
    const variantMap = new Map();
    if (!instance) {
      return variantMap;
    }

    const baseAnimations = Array.isArray(instance.animations)
      ? instance.animations.filter(Boolean)
      : [];
    const idleClip = this.selectClipByName(baseAnimations, ['idle', 'base', 'default']);
    if (idleClip) {
      variantMap.set(DEFAULT_ANIMATION_VARIANT, [idleClip]);
    }

    if (instance.variants && typeof instance.variants === 'object') {
      Object.entries(instance.variants).forEach(([variantId, clips]) => {
        if (!variantId) {
          return;
        }
        const clipArray = Array.isArray(clips) ? clips.filter(Boolean) : [];
        if (clipArray.length === 0) {
          return;
        }
        variantMap.set(String(variantId), clipArray);
      });
    }

    const declaredVariants = Object.keys(MODEL_CONFIG.variantUrls ?? {});
    declaredVariants.forEach((variantId) => {
      if (!variantMap.has(variantId)) {
        console.warn(
          `CrownedGhostEntity: Missing animation variant "${variantId}" from loaded assets.`,
        );
      }
    });

    if (!variantMap.has(DEFAULT_ANIMATION_VARIANT)) {
      const availableVariants = Array.from(variantMap.keys());
      const fallbackVariant = chooseFallbackVariant(
        availableVariants,
        DEFAULT_ANIMATION_VARIANT,
      );
      if (fallbackVariant) {
        variantMap.set(DEFAULT_ANIMATION_VARIANT, variantMap.get(fallbackVariant));
        this.variantAliasMap.set(DEFAULT_ANIMATION_VARIANT, fallbackVariant);
        console.warn(
          `CrownedGhostEntity: Missing default animation variant "${DEFAULT_ANIMATION_VARIANT}"; aliasing to "${fallbackVariant}".`,
        );
      }
    }

    return variantMap;
  }

  selectClipByName(clips, preferredNames = []) {
    if (!Array.isArray(clips) || clips.length === 0) {
      return null;
    }
    const normalizedNames = preferredNames
      .map((name) => (typeof name === 'string' ? name.toLowerCase() : null))
      .filter(Boolean);
    if (normalizedNames.length > 0) {
      const matchingClip = clips.find((clip) => {
        const clipName = typeof clip?.name === 'string' ? clip.name.toLowerCase() : '';
        return normalizedNames.some((target) => clipName.includes(target));
      });
      if (matchingClip) {
        return matchingClip;
      }
    }
    return clips[0] ?? null;
  }

  applyDesiredAnimation() {
    if (!this.animationController || this.variantClipMap.size === 0) {
      return;
    }
    const initialDesired = this.desiredAnimationVariant ?? DEFAULT_ANIMATION_VARIANT;
    const resolvedDesired = this.variantAliasMap.get(initialDesired) ?? initialDesired;
    let action = this.animationController.playVariant(resolvedDesired);
    if (action) {
      if (this.desiredAnimationVariant !== resolvedDesired) {
        this.desiredAnimationVariant = resolvedDesired;
      }
      return;
    }

    const availableVariants = Array.from(this.variantClipMap.keys());
    const fallbackVariant = chooseFallbackVariant(availableVariants, resolvedDesired);
    if (!fallbackVariant) {
      console.warn(
        `CrownedGhostEntity: Failed to play animation variant "${resolvedDesired}". Available variants: ${availableVariants.join(', ') || 'none'}.`,
      );
      return;
    }

    console.warn(
      `CrownedGhostEntity: Failed to play animation variant "${resolvedDesired}". Falling back to "${fallbackVariant}". Available variants: ${availableVariants.join(', ') || 'none'}.`,
    );
    action = this.animationController.playVariant(fallbackVariant);
    if (action) {
      this.desiredAnimationVariant = fallbackVariant;
    }
  }

  playAnimationVariant(variantId, options = {}) {
    const normalized = this.normalizeAnimationVariantId(variantId);
    const resolvedVariant = this.variantAliasMap.get(normalized) ?? normalized;
    this.desiredAnimationVariant = resolvedVariant;
    this.ensureAnimationController();
    if (!this.animationController) {
      return null;
    }
    const action = this.animationController.playVariant(resolvedVariant, options);
    if (
      !action &&
      resolvedVariant !== DEFAULT_ANIMATION_VARIANT &&
      options?.fallbackToDefault !== false
    ) {
      const resolvedDefault =
        this.variantAliasMap.get(DEFAULT_ANIMATION_VARIANT) ?? DEFAULT_ANIMATION_VARIANT;
      if (this.variantClipMap.has(resolvedDefault)) {
        const fallback = this.animationController.playVariant(resolvedDefault, options);
        if (fallback) {
          this.desiredAnimationVariant = resolvedDefault;
          return fallback;
        }
      }
    }
    return action;
  }

  setAnimationVariant(variantId, options = {}) {
    return this.playAnimationVariant(variantId, options);
  }

  normalizeAnimationVariantId(variantId) {
    if (typeof variantId !== 'string') {
      return DEFAULT_ANIMATION_VARIANT;
    }
    const trimmed = variantId.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_ANIMATION_VARIANT;
  }

  releaseVariantClips() {
    if (!this.variantClipMap) {
      return;
    }
    this.variantClipMap.clear();
    this.variantAliasMap.clear();
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

    if (this.animationController) {
      try {
        this.animationController.dispose();
      } catch (error) {
        console.warn('Failed to dispose Crowned Ghost animation controller.', error);
      }
    }
    this.animationController = null;
    this.releaseVariantClips();
    this.variantClipMap = new Map();
    this.desiredAnimationVariant = DEFAULT_ANIMATION_VARIANT;

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
