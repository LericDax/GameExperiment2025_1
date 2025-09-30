export class EntityAnimationController {
  constructor({
    THREE,
    manager = null,
    entityId,
    root,
    variantClips = null,
  } = {}) {
    if (!THREE) {
      throw new Error('EntityAnimationController requires a THREE reference.');
    }
    if (!root?.isObject3D) {
      throw new Error('EntityAnimationController requires a valid Object3D root.');
    }
    this.THREE = THREE;
    this.manager = manager;
    this.entityId = entityId ?? null;
    this.root = root;
    this.mixer = this.#createMixer();
    this.variantClips = this.#normalizeVariantClips(variantClips);
    this.actions = new Map();
    this.activeAction = null;
    this.activeVariantId = null;
    this.speed = 1;
    this.disposed = false;
  }

  setVariantClips(variantClips) {
    if (this.disposed) {
      return;
    }
    try {
      this.stop({ fadeDuration: 0 });
    } catch (error) {
      console.warn('Failed to stop active animation before updating variants.', error);
    }
    this.actions.forEach((action) => {
      try {
        action.stop?.();
        action.reset?.();
        action.enabled = false;
      } catch (error) {
        console.warn('Failed to reset animation action during variant update.', error);
      }
    });
    this.actions.clear();
    this.variantClips = this.#normalizeVariantClips(variantClips);
    this.activeVariantId = null;
  }

  #createMixer() {
    let mixer = null;
    if (this.manager?.registerMixerForEntity && this.entityId) {
      try {
        mixer = this.manager.registerMixerForEntity(this.entityId, this.root);
      } catch (error) {
        console.warn('Failed to register mixer with entity manager; falling back.', error);
      }
    }
    if (!mixer) {
      mixer = new this.THREE.AnimationMixer(this.root);
    }
    return mixer;
  }

  #normalizeVariantClips(variantClips) {
    const normalized = new Map();
    if (!variantClips) {
      return normalized;
    }
    if (variantClips instanceof Map) {
      variantClips.forEach((value, key) => {
        const clips = this.#toClipArray(value);
        if (clips.length > 0) {
          normalized.set(String(key), clips);
        }
      });
      return normalized;
    }
    if (Array.isArray(variantClips)) {
      variantClips.forEach((value, index) => {
        const clips = this.#toClipArray(value);
        if (clips.length > 0) {
          normalized.set(String(index), clips);
        }
      });
      return normalized;
    }
    if (typeof variantClips === 'object') {
      Object.entries(variantClips).forEach(([key, value]) => {
        const clips = this.#toClipArray(value);
        if (clips.length > 0) {
          normalized.set(String(key), clips);
        }
      });
    }
    return normalized;
  }

  #toClipArray(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.filter((clip) => !!clip);
    }
    return [value];
  }

  #getClipsForVariant(variantId) {
    if (!variantId) {
      return null;
    }
    return this.variantClips.get(String(variantId)) ?? null;
  }

  #getOrCreateAction(variantId) {
    if (this.actions.has(variantId)) {
      return this.actions.get(variantId);
    }
    const clips = this.#getClipsForVariant(variantId);
    if (!clips || clips.length === 0) {
      return null;
    }
    const clip = clips[0];
    if (!clip) {
      return null;
    }
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.clampWhenFinished = false;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(this.speed);
    this.actions.set(variantId, action);
    return action;
  }

  playVariant(variantId, { fadeDuration = 0.25, loopMode = this.THREE.LoopRepeat } = {}) {
    if (this.disposed) {
      return null;
    }
    const action = this.#getOrCreateAction(String(variantId));
    if (!action) {
      console.warn(`Unknown animation variant: ${variantId}`);
      return null;
    }

    const loopSetting = this.#resolveLoopMode(loopMode);
    action.setLoop(loopSetting.mode, loopSetting.repetitions);
    action.clampWhenFinished = loopSetting.mode === this.THREE.LoopOnce;
    action.setEffectiveTimeScale(this.speed);
    action.reset();

    if (this.activeAction && this.activeAction !== action) {
      if (fadeDuration > 0) {
        action.play();
        this.activeAction.crossFadeTo(action, fadeDuration, false);
      } else {
        this.activeAction.stop();
        action.play();
      }
    } else if (!this.activeAction) {
      action.play();
    } else {
      action.play();
    }

    this.activeAction = action;
    this.activeVariantId = String(variantId);
    return action;
  }

  stop({ fadeDuration = 0.2 } = {}) {
    if (!this.activeAction) {
      return;
    }
    if (fadeDuration > 0 && this.activeAction.fadeOut) {
      this.activeAction.fadeOut(fadeDuration);
    } else {
      try {
        this.activeAction.stop();
      } catch (error) {
        console.warn('Failed to stop animation action cleanly.', error);
      }
    }
    this.activeAction = null;
    this.activeVariantId = null;
  }

  setSpeed(speed = 1) {
    if (!Number.isFinite(speed) || speed <= 0) {
      return;
    }
    this.speed = speed;
    this.actions.forEach((action) => {
      if (typeof action.setEffectiveTimeScale === 'function') {
        action.setEffectiveTimeScale(speed);
      } else {
        action.timeScale = speed;
      }
    });
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    try {
      this.stop({ fadeDuration: 0 });
    } catch (error) {
      console.warn('Failed to stop active animation during dispose.', error);
    }

    this.actions.forEach((action) => {
      try {
        action.stop?.();
        action.reset?.();
        action.enabled = false;
      } catch (error) {
        console.warn('Failed to dispose animation action.', error);
      }
    });
    this.actions.clear();

    if (this.mixer) {
      try {
        this.mixer.stopAllAction?.();
        this.mixer.uncacheRoot?.(this.root);
      } catch (error) {
        console.warn('Failed to dispose animation mixer.', error);
      }
      if (this.manager?.releaseMixerForEntity && this.entityId) {
        try {
          this.manager.releaseMixerForEntity(this.entityId, this.mixer);
        } catch (error) {
          console.warn('Failed to release mixer registration.', error);
        }
      }
    }

    this.activeAction = null;
    this.mixer = null;
    this.root = null;
    this.manager = null;
    this.variantClips.clear();
  }

  #resolveLoopMode(loopMode) {
    if (typeof loopMode === 'number') {
      return { mode: loopMode, repetitions: Infinity };
    }
    if (typeof loopMode === 'object' && loopMode) {
      const mode = loopMode.mode ?? this.THREE.LoopRepeat;
      const repetitions =
        loopMode.repetitions ?? (mode === this.THREE.LoopOnce ? 1 : Infinity);
      return { mode, repetitions };
    }
    switch (loopMode) {
      case 'once':
        return { mode: this.THREE.LoopOnce, repetitions: 0 };
      case 'pingpong':
        return { mode: this.THREE.LoopPingPong, repetitions: Infinity };
      case 'repeat':
      default:
        return { mode: this.THREE.LoopRepeat, repetitions: Infinity };
    }
  }
}
