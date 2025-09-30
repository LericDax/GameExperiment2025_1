import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

function ensureArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
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

export class EntityAssetLoader {
  constructor({ THREE: injectedTHREE = THREE } = {}) {
    this.THREE = injectedTHREE ?? THREE;
    this.loader = new GLTFLoader();
    this.cache = new Map();
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

  evict(url) {
    const source = String(url ?? '');
    if (!source || !this.cache.has(source)) {
      return;
    }
    this.cache.delete(source);
  }

  clear() {
    this.cache.clear();
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
