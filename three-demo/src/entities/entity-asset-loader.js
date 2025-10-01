import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton, retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';

function ensureArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function sanitizeBoneName(name) {
  if (!name) {
    return '';
  }
  let sanitized = String(name);
  sanitized = sanitized.replace(/\.\d+$/g, '').replace(/(?:_Clone)+$/g, '');

  if (/[\:|/]/.test(sanitized)) {
    const segments = sanitized.split(/[:|/]+/).filter(Boolean);
    if (segments.length) {
      sanitized = segments[segments.length - 1];
    }
  }

  if (sanitized.includes('__')) {
    const segments = sanitized.split(/__+/).filter(Boolean);
    if (segments.length) {
      sanitized = segments[segments.length - 1];
    }
  }

  return sanitized;
}

function extractTrackBoneName(trackName) {
  const value = typeof trackName === 'string' ? trackName : '';
  if (!value) {
    return null;
  }
  const match = value.match(/\.?bones\[([^\]]+)\]/);
  if (match) {
    return match[1];
  }
  const trimmed = value.startsWith('.') ? value.slice(1) : value;
  const [firstSegment] = trimmed.split('.');
  return firstSegment || null;
}

function rewriteTrackName(trackName, targetBoneName) {
  const value = typeof trackName === 'string' ? trackName : '';
  if (!value) {
    return value;
  }
  if (value.includes('bones[')) {
    return value.replace(/bones\[[^\]]+\]/, `bones[${targetBoneName}]`);
  }
  const leadingDot = value.startsWith('.');
  const trimmed = leadingDot ? value.slice(1) : value;
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) {
    return `${leadingDot ? '.' : ''}${targetBoneName}`;
  }
  return `${leadingDot ? '.' : ''}${targetBoneName}${trimmed.slice(dotIndex)}`;
}

function createBoneRetargetMapping(targetSkeleton, sourceSkeleton) {
  const targetBones = targetSkeleton?.bones ?? [];
  const sourceBones = sourceSkeleton?.bones ?? [];
  const targetBoneNames = new Set();
  const targetToSource = new Map();
  const sourceToTarget = new Map();
  const sourceSanitizedToTarget = new Map();
  const sourceExactNames = new Map();
  const sourceSanitizedNames = new Map();

  sourceBones.forEach((bone) => {
    const name = bone?.name;
    if (!name) {
      return;
    }
    if (!sourceExactNames.has(name)) {
      sourceExactNames.set(name, name);
    }
    const sanitized = sanitizeBoneName(name);
    if (sanitized && !sourceSanitizedNames.has(sanitized)) {
      sourceSanitizedNames.set(sanitized, name);
    }
  });

  targetBones.forEach((bone) => {
    const name = bone?.name;
    if (!name) {
      return;
    }

    targetBoneNames.add(name);

    const sanitizedTargetName = sanitizeBoneName(name);
    let matchedSource = sourceExactNames.get(name) ?? null;
    if (!matchedSource && sanitizedTargetName) {
      matchedSource =
        sourceExactNames.get(sanitizedTargetName) ?? sourceSanitizedNames.get(sanitizedTargetName) ?? null;
    }

    if (matchedSource) {
      targetToSource.set(name, matchedSource);
      if (!sourceToTarget.has(matchedSource)) {
        sourceToTarget.set(matchedSource, name);
      }
      const sanitizedMatch = sanitizeBoneName(matchedSource);
      if (sanitizedMatch) {
        if (!sourceToTarget.has(sanitizedMatch)) {
          sourceToTarget.set(sanitizedMatch, name);
        }
        if (!sourceSanitizedToTarget.has(sanitizedMatch)) {
          sourceSanitizedToTarget.set(sanitizedMatch, name);
        }
      }
    }
  });

  const targetToSourceNames = {};
  targetToSource.forEach((sourceName, targetName) => {
    if (typeof targetName === 'string' && typeof sourceName === 'string') {
      targetToSourceNames[targetName] = sourceName;
    }
  });

  const getSourceBoneName = (bone) => {
    const boneName = bone?.name ?? (typeof bone === 'string' ? bone : null);
    if (!boneName) {
      return boneName;
    }
    const mappedName = targetToSource.get(boneName);
    if (mappedName) {
      return mappedName;
    }
    const sanitized = sanitizeBoneName(boneName);
    if (sanitized && targetToSource.has(sanitized)) {
      return targetToSource.get(sanitized);
    }
    return boneName;
  };

  const resolveTargetBoneName = (sourceBoneName) => {
    if (!sourceBoneName) {
      return null;
    }
    if (targetBoneNames.has(sourceBoneName)) {
      return sourceBoneName;
    }
    if (sourceToTarget.has(sourceBoneName)) {
      return sourceToTarget.get(sourceBoneName);
    }
    const sanitized = sanitizeBoneName(sourceBoneName);
    if (sanitized) {
      if (targetBoneNames.has(sanitized)) {
        return sanitized;
      }
      if (sourceToTarget.has(sanitized)) {
        return sourceToTarget.get(sanitized);
      }
      if (sourceSanitizedToTarget.has(sanitized)) {
        return sourceSanitizedToTarget.get(sanitized);
      }
    }
    return null;
  };

  return { targetBoneNames, getSourceBoneName, resolveTargetBoneName, targetToSourceNames };
}

function cloneMeshResources(object) {
  const clonedMaterials = new WeakMap();
  const clonedGeometries = new WeakMap();

  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }
    if (child.material) {
      const materials = ensureArray(child.material);
      const nextMaterials = materials.map((material) => {
        if (!material || typeof material.clone !== 'function') {
          return material;
        }
        if (clonedMaterials.has(material)) {
          return clonedMaterials.get(material);
        }
        const cloned = material.clone();
        clonedMaterials.set(material, cloned);
        return cloned;
      });
      child.material = Array.isArray(child.material)
        ? nextMaterials
        : nextMaterials[0] ?? child.material;
    }
    if (child.geometry && typeof child.geometry.clone === 'function') {
      if (clonedGeometries.has(child.geometry)) {
        child.geometry = clonedGeometries.get(child.geometry);
      } else {
        const clonedGeometry = child.geometry.clone();
        clonedGeometries.set(child.geometry, clonedGeometry);
        child.geometry = clonedGeometry;
      }
    }
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

function disposeMeshResources(object) {
  const disposedMaterials = new WeakSet();
  const disposedGeometries = new WeakSet();

  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }
    if (child.geometry && !disposedGeometries.has(child.geometry)) {
      disposedGeometries.add(child.geometry);
      child.geometry.dispose?.();
    }
    const materials = ensureArray(child.material);
    materials.forEach((material) => {
      if (material && !disposedMaterials.has(material)) {
        disposedMaterials.add(material);
        material.dispose?.();
      }
    });
  });
}

function findFirstSkinnedMesh(object) {
  let skinned = null;
  object.traverse((child) => {
    if (!skinned && child.isSkinnedMesh && child.skeleton) {
      skinned = child;
    }
  });
  return skinned;
}

function normalizeVariantEntries(variantUrls) {
  if (!variantUrls) {
    return [];
  }

  const entries = [];
  if (variantUrls instanceof Map) {
    variantUrls.forEach((value, key) => {
      const url = String(value ?? '');
      if (url) {
        entries.push({ name: String(key), url });
      }
    });
  } else if (Array.isArray(variantUrls)) {
    variantUrls.forEach((value, index) => {
      const url = String(value ?? '');
      if (url) {
        entries.push({ name: String(index), url });
      }
    });
  } else if (typeof variantUrls === 'object') {
    Object.entries(variantUrls).forEach(([key, value]) => {
      const url = String(value ?? '');
      if (url) {
        entries.push({ name: String(key), url });
      }
    });
  } else {
    const url = String(variantUrls ?? '');
    if (url) {
      entries.push({ name: 'default', url });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function normalizeAnimationMap(animationMap) {
  const normalized = new Map();
  if (!animationMap) {
    return normalized;
  }

  const sourceEntries =
    animationMap instanceof Map ? Array.from(animationMap.entries()) : Object.entries(animationMap);

  sourceEntries.forEach(([variantName, mapping]) => {
    if (!mapping) {
      normalized.set(String(variantName), new Map());
      return;
    }

    const renameMap = new Map();
    if (mapping instanceof Map) {
      mapping.forEach((targetName, sourceName) => {
        renameMap.set(String(sourceName), String(targetName));
      });
    } else if (Array.isArray(mapping)) {
      mapping.forEach((entry) => {
        if (Array.isArray(entry) && entry.length >= 2) {
          renameMap.set(String(entry[0]), String(entry[1]));
        } else if (entry && typeof entry === 'object') {
          if ('from' in entry && 'to' in entry) {
            renameMap.set(String(entry.from), String(entry.to));
          }
        }
      });
    } else if (typeof mapping === 'object') {
      Object.entries(mapping).forEach(([sourceName, targetName]) => {
        renameMap.set(String(sourceName), String(targetName));
      });
    } else if (typeof mapping === 'string') {
      renameMap.set('*', String(mapping));
    }

    normalized.set(String(variantName), renameMap);
  });

  return normalized;
}

function createVariantCacheKey(baseUrl, variantEntries, animationMap) {
  const variantData = variantEntries.map(({ name, url }) => [name, url]);
  const animationData = Array.from(animationMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([variantName, renameMap]) => {
      const renameEntries = Array.from(renameMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([sourceName, targetName]) => [sourceName, targetName]);
      return [variantName, renameEntries];
    });

  return JSON.stringify({ baseUrl, variants: variantData, animationMap: animationData });
}

export class EntityAssetLoader {
  constructor({ THREE: injectedTHREE = THREE } = {}) {
    this.THREE = injectedTHREE ?? THREE;
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.variantCache = new Map();
  }

  async loadGLTF(url) {
    const source = String(url);
    if (!source) {
      throw new Error('EntityAssetLoader.loadGLTF requires a URL.');
    }

    if (this.cache.has(source)) {
      const entry = this.cache.get(source);
      if (entry.asset) {
        return entry.asset;
      }
      return entry.promise;
    }

    const entry = {};
    const promise = this.loader.loadAsync(source).then((gltf) => {
      entry.asset = gltf;
      return gltf;
    });
    entry.promise = promise.catch((error) => {
      this.cache.delete(source);
      throw error;
    });
    this.cache.set(source, entry);
    return entry.promise;
  }

  async createInstance(url) {
    const gltf = await this.loadGLTF(url);
    const clonedScene = cloneSkeleton(gltf.scene);
    cloneMeshResources(clonedScene);
    return {
      scene: clonedScene,
      animations: gltf.animations ?? [],
      dispose: () => {
        disposeMeshResources(clonedScene);
      },
    };
  }

  async createVariantInstance({ baseUrl, variantUrls, animationMap } = {}) {
    const source = String(baseUrl ?? '');
    if (!source) {
      throw new Error('EntityAssetLoader.createVariantInstance requires a baseUrl.');
    }

    const baseGltf = await this.loadGLTF(source);
    const variantEntries = normalizeVariantEntries(variantUrls);
    const animationMapping = normalizeAnimationMap(animationMap);
    const cacheKey = createVariantCacheKey(source, variantEntries, animationMapping);

    let variantClips = null;
    if (this.variantCache.has(cacheKey)) {
      const entry = this.variantCache.get(cacheKey);
      variantClips = entry.asset ?? (await entry.promise);
    } else {
      const entry = { urls: new Set([source]) };
      variantEntries.forEach(({ url }) => {
        entry.urls.add(url);
      });
      const promise = this._buildVariantClipCache({
        baseScene: baseGltf.scene,
        variantEntries,
        animationMapping,
      }).then((result) => {
        entry.asset = result;
        return result;
      });
      entry.promise = promise.catch((error) => {
        this.variantCache.delete(cacheKey);
        throw error;
      });
      this.variantCache.set(cacheKey, entry);
      variantClips = await entry.promise;
    }

    const clonedScene = cloneSkeleton(baseGltf.scene);
    cloneMeshResources(clonedScene);

    const variants = {};
    variantEntries.forEach(({ name }) => {
      const clips = variantClips[name] ?? [];
      variants[name] = clips.slice();
    });

    return {
      scene: clonedScene,
      animations: baseGltf.animations ?? [],
      variants,
      dispose: () => {
        disposeMeshResources(clonedScene);
      },
    };
  }

  async _buildVariantClipCache({ baseScene, variantEntries, animationMapping }) {
    if (!variantEntries.length) {
      return {};
    }

    const results = {};
    for (const { name, url } of variantEntries) {
      const variantGltf = await this.loadGLTF(url);
      const renameMap = animationMapping.get(name) ?? new Map();
      const retargetedClips = [];
      const sourceClips = Array.isArray(variantGltf.animations)
        ? variantGltf.animations.filter((clip) => !!clip)
        : [];
      let retargetFailureReason = null;

      if (sourceClips.length > 0) {
        const targetRig = cloneSkeleton(baseScene);
        const sourceRig = cloneSkeleton(variantGltf.scene);
        targetRig.updateMatrixWorld(true);
        sourceRig.updateMatrixWorld(true);
        const target = findFirstSkinnedMesh(targetRig);
        const source = findFirstSkinnedMesh(sourceRig);
        const targetSkeleton = target?.skeleton ?? null;
        const sourceSkeleton = source?.skeleton ?? null;
        const targetRetargetRoot = target ?? null;
        const sourceRetargetRoot = source ?? null;
        const { targetBoneNames, getSourceBoneName, resolveTargetBoneName, targetToSourceNames } =
          createBoneRetargetMapping(targetSkeleton, sourceSkeleton);

        const applyRename = (clip, originalName) => {
          const directRename = renameMap.get(originalName ?? clip.name) ?? renameMap.get(clip.name);
          const wildcardRename = renameMap.get('*');
          if (directRename) {
            clip.name = directRename;
          } else if (wildcardRename) {
            clip.name = wildcardRename;
          }
          return clip;
        };

        let retargetWarningIssued = false;
        if (targetSkeleton && sourceSkeleton && targetRetargetRoot && sourceRetargetRoot) {
          let producedTracks = false;
          sourceClips.forEach((clip) => {
            const originalName = typeof clip?.name === 'string' ? clip.name : null;
            const clonedClip = clip.clone();
            let remappedClip = null;
            try {
              remappedClip = retargetClip(targetRetargetRoot, sourceRetargetRoot, clonedClip, {
                names: targetToSourceNames,
                getBoneName: (bone) => {
                  const resolvedName = getSourceBoneName(bone);
                  return resolvedName ?? bone?.name;
                },
              });
            } catch (error) {
              const clipLabel = originalName ?? clonedClip?.name ?? '(unnamed)';
              const errorMessage =
                error instanceof Error ? error.message : String(error ?? 'Unknown error');
              retargetFailureReason = `Retargeting clip "${clipLabel}" failed: ${errorMessage}.`;
              if (!retargetWarningIssued) {
                console.warn(
                  `EntityAssetLoader: Failed to retarget clip "${clipLabel}" for variant "${name}" from ${url}.`,
                  error,
                );
                retargetWarningIssued = true;
              }
              return;
            }
            if (!remappedClip) {
              return;
            }
            if (remappedClip.tracks?.length && targetBoneNames.size > 0) {
              const remappedTracks = remappedClip.tracks
                .map((track) => {
                  const boneName = extractTrackBoneName(track?.name);
                  if (!boneName) {
                    return null;
                  }
                  const targetBoneName = resolveTargetBoneName(boneName);
                  if (!targetBoneName || !targetBoneNames.has(targetBoneName)) {
                    return null;
                  }

                  if (targetBoneName === boneName) {
                    return track;
                  }
                  const nextTrack =
                    track && typeof track.clone === 'function' ? track.clone() : track;
                  if (nextTrack) {
                    nextTrack.name = rewriteTrackName(nextTrack.name, targetBoneName);
                  }
                  return nextTrack;

                })
                .filter(Boolean);
              remappedClip.tracks = remappedTracks;
            }
            if (!remappedClip.tracks?.length) {
              return;
            }
            producedTracks = true;
            retargetedClips.push(applyRename(remappedClip, originalName));
          });
          if (retargetedClips.length === 0) {
            retargetFailureReason =
              producedTracks
                ? 'Retargeting produced animation tracks that did not target the base rig.'
                : 'Retargeting produced no animation tracks despite variant clips being present.';
          }
        } else {
          retargetFailureReason =
            'Unable to locate compatible skinned meshes on the base or variant model for retargeting.';
        }

        if (retargetedClips.length === 0) {
          const fallbackClips = sourceClips
            .map((clip) => {
              if (!clip?.clone) {
                return null;
              }
              const clonedClip = clip.clone();
              if (clonedClip.tracks?.length && targetBoneNames.size > 0) {
                const remappedTracks = clonedClip.tracks
                  .map((track) => {
                    const boneName = extractTrackBoneName(track?.name);
                    if (!boneName) {
                      return track;
                    }
                    const targetBoneName = resolveTargetBoneName(boneName);
                    if (!targetBoneName || !targetBoneNames.has(targetBoneName)) {
                      return null;
                    }
                    if (targetBoneName === boneName) {
                      return track;
                    }
                    const nextTrack =
                      track && typeof track.clone === 'function' ? track.clone() : track;
                    if (nextTrack) {
                      nextTrack.name = rewriteTrackName(nextTrack.name, targetBoneName);
                    }
                    return nextTrack;
                  })
                  .filter(Boolean);
                clonedClip.tracks = remappedTracks;
              }
              if (!clonedClip.tracks?.length) {
                return null;
              }
              return applyRename(clonedClip, typeof clip.name === 'string' ? clip.name : null);
            })
            .filter(Boolean);

          if (fallbackClips.length > 0) {
            if (retargetFailureReason && !retargetWarningIssued) {
              console.warn(
                `EntityAssetLoader: ${retargetFailureReason} Falling back to source clips for variant "${name}" from ${url}.`,
              );
              retargetWarningIssued = true;
            }
            retargetedClips.push(...fallbackClips);
          } else {
            console.error(
              `EntityAssetLoader: Unable to clone fallback clips for variant "${name}" from ${url}.`,
            );
          }
        }
      }

      if (retargetedClips.length === 0 && sourceClips.length === 0) {
        console.warn(
          `EntityAssetLoader: Variant "${name}" at ${url} does not provide any animation clips.`,
        );
      }

      results[name] = retargetedClips;
    }

    return results;
  }

  evict(url) {
    const source = String(url ?? '');
    if (!source || !this.cache.has(source)) {
      return;
    }
    this.cache.delete(source);
    for (const [key, entry] of this.variantCache.entries()) {
      if (entry.urls?.has(source)) {
        this.variantCache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
    this.variantCache.clear();
  }
}

let sharedLoader = null;

export function getSharedEntityAssetLoader(options = {}) {
  if (!sharedLoader) {
    sharedLoader = new EntityAssetLoader(options);
  }
  return sharedLoader;
}

export function createEntityAssetLoader(options = {}) {
  return new EntityAssetLoader(options);
}
