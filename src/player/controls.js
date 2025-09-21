import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

function blockKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

function createCollisionOffsets(radius) {
  return [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
    [radius, radius],
    [radius, -radius],
    [-radius, radius],
    [-radius, -radius],
  ];
}

export function createPlayerControls({
  scene,
  camera,
  renderer,
  overlay,
  worldConfig,
  terrainHeight,
  solidBlocks,
  waterColumns,
}) {
  const controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());

  const moveState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  };

  let jumpRequested = false;
  let verticalVelocity = 0;
  let isGrounded = false;
  const playerEyeHeight = 1.7;
  const playerHeight = 1.8;
  const playerRadius = 0.35;
  const gravity = 18;
  const jumpVelocity = 7.8;
  const halfSize = worldConfig.chunkSize / 2;
  const collisionOffsets = createCollisionOffsets(playerRadius);

  controls.getObject().position.set(0, worldConfig.waterLevel + playerEyeHeight + 1, 0);

  const onKeyDown = (event) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        moveState.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        moveState.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        moveState.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        moveState.right = true;
        break;
      case 'Space':
        jumpRequested = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        moveState.sprint = true;
        break;
      default:
        break;
    }
  };

  const onKeyUp = (event) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        moveState.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        moveState.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        moveState.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        moveState.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        moveState.sprint = false;
        break;
      default:
        break;
    }
  };

  overlay.addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => overlay.classList.add('hidden'));
  controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  function clampToWorld(position) {
    const min = -halfSize + 1;
    const max = halfSize - 1;
    position.x = THREE.MathUtils.clamp(position.x, min, max);
    position.z = THREE.MathUtils.clamp(position.z, min, max);
  }

  function sampleHeight(x, z) {
    return terrainHeight(Math.round(x), Math.round(z));
  }

  function collidesAt(position) {
    const playerFeet = position.y - playerEyeHeight;
    const minY = Math.floor(playerFeet + 0.6);
    const maxY = Math.floor(playerFeet + playerHeight);
    if (minY > maxY) {
      return false;
    }

    for (const [dx, dz] of collisionOffsets) {
      const sampleX = position.x + dx;
      const sampleZ = position.z + dz;
      const blockX = Math.round(sampleX);
      const blockZ = Math.round(sampleZ);
      for (let y = minY; y <= maxY; y++) {
        if (solidBlocks.has(blockKey(blockX, y, blockZ))) {
          return true;
        }
      }
    }

    return false;
  }

  function update(delta) {
    const { forward, backward, left, right, sprint } = moveState;
    const direction = new THREE.Vector3();
    direction.z = Number(forward) - Number(backward);
    direction.x = Number(right) - Number(left);
    if (direction.lengthSq() > 0) {
      direction.normalize();
      const baseSpeed = 5.2;
      const sprintBonus = sprint && forward ? 3.2 : 0;
      const moveSpeed = baseSpeed + sprintBonus;
      const moveX = direction.x * moveSpeed * delta;
      const moveZ = direction.z * moveSpeed * delta;

      const yaw = controls.getObject().rotation.y;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const worldX = moveX * cos - moveZ * sin;
      const worldZ = moveZ * cos + moveX * sin;

      const currentPosition = controls.getObject().position;
      const attemptPosition = currentPosition.clone();
      attemptPosition.x += worldX;
      attemptPosition.z += worldZ;

      if (!collidesAt(attemptPosition)) {
        currentPosition.copy(attemptPosition);
      } else {
        const attemptX = currentPosition.clone();
        attemptX.x += worldX;
        if (!collidesAt(attemptX)) {
          currentPosition.x = attemptX.x;
        }

        const attemptZ = currentPosition.clone();
        attemptZ.z += worldZ;
        if (!collidesAt(attemptZ)) {
          currentPosition.z = attemptZ.z;
        }
      }
    }

    clampToWorld(controls.getObject().position);

    const position = controls.getObject().position;
    const terrainY = sampleHeight(position.x, position.z);
    let targetY = terrainY + playerEyeHeight;
    const columnKey = `${Math.round(position.x)}|${Math.round(position.z)}`;
    if (waterColumns.has(columnKey)) {
      targetY = Math.max(targetY, worldConfig.waterLevel + playerEyeHeight);
    }
    if (jumpRequested && isGrounded) {
      verticalVelocity = jumpVelocity;
      isGrounded = false;
    }
    jumpRequested = false;

    verticalVelocity -= gravity * delta;
    const previousY = position.y;
    position.y += verticalVelocity * delta;

    if (collidesAt(position) && verticalVelocity > 0) {
      position.y = previousY;
      verticalVelocity = 0;
    }

    if (position.y <= targetY) {
      position.y = targetY;
      verticalVelocity = 0;
      isGrounded = true;
    } else {
      isGrounded = false;
    }
  }

  return { controls, moveState, collidesAt, update };
}
