import * as THREE from 'three';

export class BaseEntity {
  constructor({
    id = null,
    typeId = null,
    manager = null,
    THREE: injectedTHREE = THREE,
    scene = null,
    chunkManager = null,
    terrainHeight = null,
    spawnContext = null,
  } = {}) {
    if (!injectedTHREE) {
      throw new Error('BaseEntity requires a valid THREE instance.');
    }

    this.THREE = injectedTHREE;
    this.id = id;
    this.typeId = typeId;
    this.manager = manager;
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.terrainHeight = typeof terrainHeight === 'function' ? terrainHeight : null;
    this.spawnContext = spawnContext;

    this.root = new this.THREE.Group();
    this.root.name = `Entity(${this.typeId ?? 'unknown'}:${this.id ?? 'unnamed'})`;

    this.velocity = new this.THREE.Vector3();
    this.acceleration = new this.THREE.Vector3();
    this.state = new Map();

    this.collisionRadius = 0.6;
    this.collisionHalfHeight = 0.9;

    this._bounds = new this.THREE.Box3();
    this._boundsDirty = true;
    this._scratchPosition = new this.THREE.Vector3();
    this._scratchSamples = [
      new this.THREE.Vector3(),
      new this.THREE.Vector3(),
      new this.THREE.Vector3(),
      new this.THREE.Vector3(),
      new this.THREE.Vector3(),
    ];

    this.isDisposed = false;
  }

  getPosition() {
    return this.root.position;
  }

  setPosition(position) {
    if (!position) {
      return this.root.position;
    }
    this.root.position.copy(position);
    this._boundsDirty = true;
    return this.root.position;
  }

  translate(delta) {
    if (!delta) {
      return this.root.position;
    }
    this.root.position.add(delta);
    this._boundsDirty = true;
    return this.root.position;
  }

  getVelocity() {
    return this.velocity;
  }

  setVelocity(velocity) {
    if (!velocity) {
      this.velocity.set(0, 0, 0);
      return this.velocity;
    }
    this.velocity.copy(velocity);
    return this.velocity;
  }

  addVelocity(delta) {
    if (!delta) {
      return this.velocity;
    }
    this.velocity.add(delta);
    return this.velocity;
  }

  applyAcceleration(delta) {
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    if (this.acceleration.lengthSq() > 0) {
      this.velocity.addScaledVector(this.acceleration, delta);
    }
  }

  applyVelocity(delta) {
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    if (this.velocity.lengthSq() === 0) {
      return;
    }
    this.root.position.addScaledVector(this.velocity, delta);
    this._boundsDirty = true;
  }

  integrateForces(delta) {
    this.applyAcceleration(delta);
    this.applyVelocity(delta);
  }

  applyDamping(factor, delta) {
    if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) {
      return;
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    const damping = 1 - Math.pow(1 - factor, delta * 60);
    this.velocity.multiplyScalar(1 - damping);
  }

  markBoundsDirty() {
    this._boundsDirty = true;
  }

  getCollisionBounds() {
    if (this._boundsDirty) {
      this._bounds.setFromObject(this.root);
      this._boundsDirty = false;
    }
    return this._bounds;
  }

  getSolidBlockKeyAt(position) {
    if (!position) {
      return null;
    }
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    return `${x}|${y}|${z}`;
  }

  isSolidAtWorld(position) {
    if (!position || !this.chunkManager?.solidBlocks) {
      return false;
    }
    const key = this.getSolidBlockKeyAt(position);
    return key ? this.chunkManager.solidBlocks.has(key) : false;
  }

  gatherCollisionSamples() {
    if (!this.chunkManager?.solidBlocks) {
      return [];
    }
    const samples = [];
    const radius = Math.max(0.1, this.collisionRadius);
    const halfHeight = Math.max(0.1, this.collisionHalfHeight);
    const base = this._scratchPosition.copy(this.root.position);

    const offsets = [
      { label: 'center', x: 0, y: -halfHeight, z: 0 },
      { label: 'forward', x: 0, y: -halfHeight, z: radius },
      { label: 'back', x: 0, y: -halfHeight, z: -radius },
      { label: 'right', x: radius, y: -halfHeight, z: 0 },
      { label: 'left', x: -radius, y: -halfHeight, z: 0 },
    ];

    offsets.forEach((offset, index) => {
      const sample = this._scratchSamples[index % this._scratchSamples.length];
      sample.set(base.x + offset.x, base.y + offset.y, base.z + offset.z);
      const key = this.getSolidBlockKeyAt(sample);
      const solid = key ? this.chunkManager.solidBlocks.has(key) : false;
      samples.push({
        label: offset.label,
        position: sample.clone(),
        blockKey: key,
        isSolid: solid,
      });
    });

    return samples;
  }

  resolveTerrainCollision() {
    if (typeof this.terrainHeight !== 'function') {
      return;
    }
    const groundHeight = this.terrainHeight(
      this.root.position.x,
      this.root.position.z,
    );
    if (!Number.isFinite(groundHeight)) {
      return;
    }
    const minimumY = groundHeight + this.collisionHalfHeight;
    if (this.root.position.y < minimumY) {
      this.root.position.y = minimumY;
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
      this.markBoundsDirty();
    }
  }

  onSpawn() {}

  update({ delta = 0 } = {}) {
    this.integrateForces(delta);
    this.resolveTerrainCollision();
  }

  dispose() {
    this.isDisposed = true;
  }
}
