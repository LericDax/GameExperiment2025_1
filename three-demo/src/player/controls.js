function blockKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

const POINTER_LOCK_ERROR_EVENTS = [
  'pointerlockerror',
  'mozpointerlockerror',
  'webkitpointerlockerror',
];

function isPointerLockSupported(doc) {
  if (!doc) {
    return false;
  }
  const hasPointerLockElement =
    'pointerLockElement' in doc ||
    'mozPointerLockElement' in doc ||
    'webkitPointerLockElement' in doc;
  const hasExitPointerLock =
    typeof doc.exitPointerLock === 'function' ||
    typeof doc.mozExitPointerLock === 'function' ||
    typeof doc.webkitExitPointerLock === 'function';
  return hasPointerLockElement && hasExitPointerLock;
}

export function createPlayerControls({
  THREE,
  PointerLockControls,
  scene,
  camera,
  renderer,
  overlay,
  worldConfig,
  terrainHeight,
  solidBlocks,
  waterColumns,
  onStateChange = () => {},
}) {
  if (!THREE) {
    throw new Error('createPlayerControls requires a THREE instance');
  }
  if (!PointerLockControls) {
    throw new Error('createPlayerControls requires PointerLockControls');
  }
  const controls = new PointerLockControls(camera, renderer.domElement);
  const controlObject =
    typeof controls.getObject === 'function'
      ? controls.getObject()
      : controls.object ?? null;

  if (!controlObject) {
    throw new Error('PointerLockControls did not expose a control object');
  }

  scene.add(controlObject);

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
  const pointerLockElement = renderer.domElement;
  const pointerLockDocument = pointerLockElement.ownerDocument;
  const pointerLockSupported = isPointerLockSupported(pointerLockDocument);
  const overlayStatus = overlay?.querySelector('#overlay-status');
  let lockAttemptTimer = null;

  function hideOverlay() {
    if (!overlay) {
      return;
    }
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showOverlay() {
    if (!overlay) {
      return;
    }
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
  }

  controlObject.position.set(
    0,
    worldConfig.waterLevel + playerEyeHeight + 1.5,
    0,
  );

  const playerState = {
    health: 100,
    oxygen: 12,
    maxOxygen: 12,
    isInWater: false,
    statusMessage: 'Click or tap the game view to look around. Use WASD to move.',
  };
  let statusTimer = Number.POSITIVE_INFINITY;
  let maxDownwardSpeed = 0;
  let stateDirty = true;

  function markStateDirty() {
    stateDirty = true;
  }

  function pushState() {
    if (!stateDirty) {
      return;
    }
    onStateChange({ ...playerState });
    stateDirty = false;
  }

  function setStatus(message, duration = 2.2) {
    if (message === playerState.statusMessage && statusTimer > 0) {
      statusTimer = duration;
      return;
    }
    playerState.statusMessage = message;
    statusTimer = duration;
    markStateDirty();
  }

  function clearStatus() {
    if (!playerState.statusMessage) {
      return;
    }
    playerState.statusMessage = '';
    markStateDirty();
  }

  function applyDamage(amount, message) {
    if (amount <= 0) {
      return;
    }
    const previousHealth = playerState.health;
    playerState.health = Math.max(0, previousHealth - amount);
    if (playerState.health !== previousHealth) {
      markStateDirty();
    }
    if (message) {
      setStatus(message, 2.4);
    }
  }

  function setOverlayStatus(message, { isError = false, showOverlay: shouldShow = false } = {}) {
    if (!overlayStatus) {
      return;
    }
    overlayStatus.textContent = message;
    overlayStatus.classList.toggle('visible', Boolean(message));
    overlayStatus.classList.toggle('error', Boolean(message) && isError);
    if (!overlay) {
      return;
    }
    if (shouldShow) {
      showOverlay();
    } else if (!message) {
      hideOverlay();
    }
  }

  function clearLockAttemptTimer() {
    if (lockAttemptTimer === null) {
      return;
    }
    window.clearTimeout(lockAttemptTimer);
    lockAttemptTimer = null;
  }

  function scheduleLockVerification() {
    clearLockAttemptTimer();
    lockAttemptTimer = window.setTimeout(() => {
      if (!controls.isLocked) {
        setOverlayStatus(
          'Pointer lock was blocked by the browser. Open the demo in a standalone tab or allow pointer lock in your browser preferences.',
          { isError: true, showOverlay: false }
        );
        setStatus(
          'Pointer lock was blocked. Open the demo in a standalone tab or enable pointer lock permissions.',
          6
        );
      }
    }, 250);
  }

  if (!pointerLockSupported) {
    setOverlayStatus(
      'Pointer Lock API is not available in this environment. Use a desktop browser tab to enable full mouse look.',
      { isError: true, showOverlay: false }
    );
    setStatus(
      'Pointer lock is unavailable here. Keyboard movement works, but mouse look requires a desktop browser tab.',
      Number.POSITIVE_INFINITY
    );
  }

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

  function attemptPointerLock() {
    if (!pointerLockSupported) {
      setOverlayStatus(
        'Pointer Lock is unavailable here. Try opening the experience in a standalone browser window.',
        { isError: true, showOverlay: false }
      );
      return;
    }

    setOverlayStatus('', { showOverlay: false });
    try {
      controls.lock();
      scheduleLockVerification();
    } catch (error) {
      console.error('Failed to initiate pointer lock:', error);
      setOverlayStatus(
        'Pointer lock request failed. Open the page in a new tab or allow pointer lock in your browser settings.',
        { isError: true, showOverlay: false }
      );
      setStatus(
        'Pointer lock request failed. Open the demo in a new tab or allow pointer lock in your browser settings.',
        6
      );
    }
  }

  const handleOverlayClick = () => attemptPointerLock();
  const handleLock = () => {
    clearLockAttemptTimer();
    hideOverlay();
    statusTimer = 0;
    clearStatus();
    pushState();
    setOverlayStatus('', { showOverlay: false });
    setStatus('Press Esc to release the pointer.', 3.5);
  };
  const handleUnlock = () => {
    if (!pointerLockSupported) {
      return;
    }
    setStatus('Click or tap the game view to resume mouse look.', Number.POSITIVE_INFINITY);
    setOverlayStatus('Click to resume control.', { showOverlay: false });
  };

  function handlePointerLockError(event) {
    clearLockAttemptTimer();
    console.error('Pointer lock error:', event);
    setOverlayStatus(
      'Pointer lock was blocked. Open the demo in a dedicated browser tab or enable pointer lock permissions and try again.',
      { isError: true, showOverlay: false }
    );
    setStatus(
      'Pointer lock was blocked. Open the demo in a dedicated browser tab or enable pointer lock permissions and try again.',
      6
    );
  }

  function handlePointerDown(event) {
    if (controls.isLocked) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    attemptPointerLock();
  }

  hideOverlay();
  overlay?.addEventListener('click', handleOverlayClick);
  controls.addEventListener('lock', handleLock);
  controls.addEventListener('unlock', handleUnlock);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  pointerLockElement.addEventListener('pointerdown', handlePointerDown);
  POINTER_LOCK_ERROR_EVENTS.forEach((eventName) =>
    pointerLockDocument.addEventListener(eventName, handlePointerLockError)
  );

  function sampleHeight(x, z) {
    return terrainHeight(Math.round(x), Math.round(z));
  }

  function collidesAt(position) {
    const playerFeet = position.y - playerEyeHeight;
    const capsulePadding = 0.1;

    const bottom = playerFeet + capsulePadding;
    const top = playerFeet + playerHeight - capsulePadding;
    const minY = Math.floor(bottom);
    const maxY = Math.floor(top);


    if (minY > maxY) {
      return false;
    }

    const playerMinX = position.x - playerRadius;
    const playerMaxX = position.x + playerRadius;
    const playerMinZ = position.z - playerRadius;
    const playerMaxZ = position.z + playerRadius;

    const minBlockX = Math.floor(playerMinX - 0.5);
    const maxBlockX = Math.floor(playerMaxX + 0.5);
    const minBlockZ = Math.floor(playerMinZ - 0.5);
    const maxBlockZ = Math.floor(playerMaxZ + 0.5);

    const epsilon = 1e-4;

    for (let x = minBlockX; x <= maxBlockX; x++) {
      for (let z = minBlockZ; z <= maxBlockZ; z++) {
        for (let y = minY - 1; y <= maxY + 1; y++) {
          if (!solidBlocks.has(blockKey(x, y, z))) {
            continue;
          }

          const blockMinX = x - 0.5;
          const blockMaxX = x + 0.5;
          const blockMinY = y - 0.5;
          const blockMaxY = y + 0.5;
          const blockMinZ = z - 0.5;
          const blockMaxZ = z + 0.5;

          const overlaps =
            playerMaxX > blockMinX + epsilon &&
            playerMinX < blockMaxX - epsilon &&
            top > blockMinY + epsilon &&
            bottom < blockMaxY - epsilon &&
            playerMaxZ > blockMinZ + epsilon &&
            playerMinZ < blockMaxZ - epsilon;

          if (overlaps) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function update(delta) {
    const { forward, backward, left, right, sprint } = moveState;
    const position = controlObject.position;

    const columnKey = `${Math.round(position.x)}|${Math.round(position.z)}`;
    const waterSurface = worldConfig.waterLevel + 0.5;
    const feetY = position.y - playerEyeHeight;
    const headY = position.y;
    const inWaterColumn = waterColumns.has(columnKey);
    const feetInWater = inWaterColumn && feetY < waterSurface;
    const headUnderwater = inWaterColumn && headY < waterSurface;

    if (playerState.isInWater !== feetInWater) {
      playerState.isInWater = feetInWater;
      markStateDirty();
    }

    const previousOxygen = playerState.oxygen;
    if (headUnderwater) {
      playerState.oxygen = Math.max(0, playerState.oxygen - delta);
      if (playerState.oxygen === 0) {
        applyDamage(15 * delta, 'You are drowning!');
      }
    } else {
      const recoveryRate = feetInWater ? 0.6 : 1.8;
      playerState.oxygen = Math.min(
        playerState.maxOxygen,
        playerState.oxygen + delta * recoveryRate
      );
    }
    if (Math.abs(playerState.oxygen - previousOxygen) > 0.001) {
      markStateDirty();
    }

    const direction = new THREE.Vector3();
    direction.z = Number(forward) - Number(backward);
    direction.x = Number(right) - Number(left);
    if (direction.lengthSq() > 0) {
      direction.normalize();
      const baseSpeed = 5.2;
      const sprintBonus = sprint && forward && !feetInWater ? 3.2 : 0;
      const mediumPenalty = feetInWater ? 0.42 : 1;
      const moveSpeed = (baseSpeed + sprintBonus) * mediumPenalty;
      const moveX = direction.x * moveSpeed * delta;
      const moveZ = direction.z * moveSpeed * delta;

      const yaw = controlObject.rotation.y;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const worldX = moveX * cos - moveZ * sin;
      const worldZ = moveZ * cos + moveX * sin;

      const currentPosition = controlObject.position;
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

    const terrainY = sampleHeight(position.x, position.z);
    const groundLevel = terrainY + 0.5;
    const waterTarget =
      worldConfig.waterLevel + 0.5 + playerEyeHeight - 0.2;
    let targetY = groundLevel + playerEyeHeight;
    if (!feetInWater && inWaterColumn) {
      targetY = Math.max(targetY, waterTarget);
    }

    if (jumpRequested) {
      if (isGrounded) {
        verticalVelocity = jumpVelocity;
        isGrounded = false;
      } else if (feetInWater) {
        verticalVelocity = Math.max(verticalVelocity, 3.5);
      }
    }
    jumpRequested = false;

    const effectiveGravity = feetInWater ? gravity * 0.35 : gravity;
    verticalVelocity -= effectiveGravity * delta;
    if (feetInWater) {
      const submersion = THREE.MathUtils.clamp(waterSurface - feetY, 0, 6);
      const buoyancy = submersion * 2.4;
      verticalVelocity += buoyancy * delta;
      verticalVelocity *= 0.82;
      if (sprint && !isGrounded) {
        verticalVelocity -= 4.2 * delta;
      }
    }

    const previousY = position.y;
    position.y += verticalVelocity * delta;

    if (collidesAt(position) && verticalVelocity > 0) {
      position.y = previousY;
      verticalVelocity = 0;
    }

    if (verticalVelocity < maxDownwardSpeed) {
      maxDownwardSpeed = verticalVelocity;
    }

    if (position.y <= targetY) {
      if (!feetInWater && maxDownwardSpeed < -12) {
        const impact = Math.abs(maxDownwardSpeed) - 10;
        applyDamage(impact * 4.5, 'You hit the ground hard.');
      }
      position.y = targetY;
      verticalVelocity = 0;
      maxDownwardSpeed = 0;
      isGrounded = true;
    } else {
      isGrounded = false;
    }

    if (statusTimer > 0) {
      statusTimer -= delta;
      if (statusTimer <= 0) {
        statusTimer = 0;
        clearStatus();
      }
    }

    pushState();
  }

  function dispose() {
    scene.remove(controlObject);
    overlay?.removeEventListener('click', handleOverlayClick);
    controls.removeEventListener('lock', handleLock);
    controls.removeEventListener('unlock', handleUnlock);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    pointerLockElement.removeEventListener('pointerdown', handlePointerDown);
    POINTER_LOCK_ERROR_EVENTS.forEach((eventName) =>
      pointerLockDocument.removeEventListener(eventName, handlePointerLockError)
    );
    clearLockAttemptTimer();
  }

  function getPosition() {
    return controlObject.position;
  }

  function getState() {
    return { ...playerState };
  }

  return { controls, moveState, collidesAt, update, dispose, getPosition, getState };
}
