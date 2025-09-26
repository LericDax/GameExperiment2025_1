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
  softBlocks,
  waterColumns,
  chunkManager,
  damageMaterials = [],
  onStateChange = () => {},
}) {
  if (!THREE) {
    throw new Error('createPlayerControls requires a THREE instance');
  }
  if (!PointerLockControls) {
    throw new Error('createPlayerControls requires PointerLockControls');
  }
  if (!chunkManager) {
    throw new Error('createPlayerControls requires a chunk manager for block interactions');
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

  const flyState = {
    ascend: false,
    descend: false,
  };

  let inputEnabled = true;

  const cheatState = {
    godMode: false,
    flightEnabled: false,
  };

  const cameraForward = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3(0, 1, 0);
  const movementStep = new THREE.Vector3();
  const attemptPosition = new THREE.Vector3();
  const axisAttempt = new THREE.Vector3();
  const manualPosition = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const yawPitchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  let jumpRequested = false;
  let verticalVelocity = 0;
  let isGrounded = false;
  const playerEyeHeight = 1.7;
  const playerHeight = 1.8;
  const playerRadius = 0.35;
  const gravity = 18;
  const jumpVelocity = 10.2;
  const nearGroundThreshold = 0.18;
  const spawnDropHeight = 6;
  const minSpawnHeight = worldConfig.maxHeight + playerEyeHeight + 8;
  const maxRescueHeight = worldConfig.maxHeight + playerEyeHeight + 60;
  const spawnSearchRadius = 30;
  const spawnSearchStep = 6;
  const fallbackSpawnPosition = new THREE.Vector3(0, minSpawnHeight, 0);
  const pointerLockElement = renderer.domElement;
  const pointerLockDocument = pointerLockElement.ownerDocument;
  const pointerLockSupported = isPointerLockSupported(pointerLockDocument);
  const overlayStatus = overlay?.querySelector('#overlay-status');
  let lockAttemptTimer = null;
  const attackRay = new THREE.Raycaster();
  attackRay.far = 6.2;
  const aimVector = new THREE.Vector2(0, 0);
  const blockDurability = new Map([
    ['grass', 0.8],
    ['dirt', 1.2],
    ['sand', 0.65],
    ['stone', 2.4],
    ['log', 1.8],
    ['leaf', 0.5],
  ]);
  const overlayMaterials = Array.isArray(damageMaterials) && damageMaterials.length > 0
    ? damageMaterials
    : [
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      ];
  const overlayGeometry = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  const damageOverlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterials[0]);
  damageOverlayMesh.visible = false;
  damageOverlayMesh.renderOrder = 10;
  damageOverlayMesh.frustumCulled = false;
  scene.add(damageOverlayMesh);
  let currentOverlayMaterialIndex = 0;

  const attackState = {
    swinging: false,
    target: null,
    progress: 0,
  };

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
  const defaultStatusMessage = playerState.statusMessage;
  let collisionRescueFailureMessage = null;
  let collisionRescueFailureNotified = false;

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
    if (cheatState.godMode) {
      return;
    }
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

  function preloadChunksAround(position) {
    if (!chunkManager) {
      return false;
    }
    try {
      if (typeof chunkManager.preloadAround === 'function') {
        const preferredRadius =
          typeof chunkManager.getRetentionDistance === 'function'
            ? chunkManager.getRetentionDistance()
            : undefined;
        chunkManager.preloadAround(position, preferredRadius);
      } else if (typeof chunkManager.update === 'function') {
        const preferredRadius =
          typeof chunkManager.getRetentionDistance === 'function'
            ? chunkManager.getRetentionDistance()
            : undefined;
        if (preferredRadius !== undefined) {
          chunkManager.update(position, {
            loadRadius: preferredRadius,
            skipUnload: true,
            force: true,
          });
        } else {
          chunkManager.update(position);
        }
      }
      return true;
    } catch (error) {
      console.error('Failed to update chunks near position:', position, error);
      return false;
    }
  }

  function highestSolidAt(x, z) {
    if (!solidBlocks || typeof solidBlocks.has !== 'function') {
      return null;
    }
    const ceiling = Math.max(Math.ceil(minSpawnHeight) + 8, worldConfig.maxHeight + 32);
    for (let y = ceiling; y >= -32; y--) {
      if (solidBlocks.has(blockKey(x, y, z))) {
        return y;
      }
    }
    return null;
  }

  function evaluateSpawnColumn(x, z) {
    let surfaceY = null;
    const topSolid = highestSolidAt(x, z);
    if (Number.isFinite(topSolid)) {
      surfaceY = topSolid + 0.5;
    } else if (typeof terrainHeight === 'function') {
      try {
        const terrainValue = terrainHeight(x, z);
        if (Number.isFinite(terrainValue)) {
          surfaceY = terrainValue + 0.5;
        }
      } catch (error) {
        console.error('Failed to sample terrain height for spawn column', x, z, error);
      }
    }

    if (!Number.isFinite(surfaceY)) {
      return null;
    }

    const columnKey = `${x}|${z}`;
    const hasWaterColumn = Boolean(waterColumns?.has?.(columnKey));
    const isSubmerged = hasWaterColumn && surfaceY <= worldConfig.waterLevel + 0.5;
    const spawnY = Math.max(surfaceY + playerEyeHeight + spawnDropHeight, minSpawnHeight);

    return {
      x,
      z,
      surfaceY,
      spawnY,
      hasWaterColumn,
      isSubmerged,
    };
  }

  function selectSpawnPosition() {
    const candidates = [];
    for (let x = -spawnSearchRadius; x <= spawnSearchRadius; x += spawnSearchStep) {
      for (let z = -spawnSearchRadius; z <= spawnSearchRadius; z += spawnSearchStep) {
        const distance = Math.hypot(x, z);
        candidates.push({ x, z, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const info = evaluateSpawnColumn(candidate.x, candidate.z);
      if (!info) {
        continue;
      }

      const drynessBonus = info.isSubmerged ? -800 : info.hasWaterColumn ? -300 : 400;
      const score = info.surfaceY + drynessBonus - candidate.distance * 0.35;
      if (!best || score > bestScore) {
        best = { info, score };
        bestScore = score;
      }
    }

    if (!best) {
      return {
        position: fallbackSpawnPosition.clone(),
        usedFallback: true,
        columnHasWater: false,
        columnIsSubmerged: false,
      };
    }

    return {
      position: new THREE.Vector3(best.info.x, best.info.spawnY, best.info.z),
      usedFallback: false,
      columnHasWater: best.info.hasWaterColumn,
      columnIsSubmerged: best.info.isSubmerged,
    };
  }

  function initializeSpawn() {
    controlObject.position.copy(fallbackSpawnPosition);
    preloadChunksAround(controlObject.position);

    const selection = selectSpawnPosition();
    controlObject.position.copy(selection.position);
    preloadChunksAround(controlObject.position);

    if (!attemptCollisionRescue('spawn')) {
      console.error('Unable to resolve spawn collisions. Player may remain stuck.');
    }

    if (selection.usedFallback) {
      console.warn('Using fallback spawn height because no suitable terrain column was found nearby.');
    } else if (selection.columnIsSubmerged) {
      console.info('Spawning above a water column. Player will descend into water before reaching land.');
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

  initializeSpawn();

  const onKeyDown = (event) => {
    if (!inputEnabled) {
      return;
    }
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
        if (cheatState.flightEnabled) {
          flyState.ascend = true;
        } else {
          jumpRequested = true;
        }
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        if (cheatState.flightEnabled) {
          flyState.descend = true;
        } else {
          moveState.sprint = true;
        }
        break;
      case 'ControlLeft':
      case 'ControlRight':
        if (cheatState.flightEnabled) {
          flyState.descend = true;
        }
        break;
      default:
        break;
    }
  };

  const onKeyUp = (event) => {
    if (!inputEnabled) {
      return;
    }
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
      case 'Space':
        if (cheatState.flightEnabled) {
          flyState.ascend = false;
        }
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        if (cheatState.flightEnabled) {
          flyState.descend = false;
        } else {
          moveState.sprint = false;
        }
        break;
      case 'ControlLeft':
      case 'ControlRight':
        if (cheatState.flightEnabled) {
          flyState.descend = false;
        }
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
    stopAttack();
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

  function stopAttack() {
    attackState.swinging = false;
  }

  function handlePointerDown(event) {
    if (!inputEnabled) {
      return;
    }
    if (controls.isLocked) {
      if (event.button === 0) {
        attackState.swinging = true;
      }
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    attemptPointerLock();
  }

  function handlePointerUp(event) {
    if (event.button === 0) {
      stopAttack();
    }
  }

  hideOverlay();
  overlay?.addEventListener('click', handleOverlayClick);
  controls.addEventListener('lock', handleLock);
  controls.addEventListener('unlock', handleUnlock);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  pointerLockElement.addEventListener('pointerdown', handlePointerDown);
  pointerLockElement.addEventListener('pointerup', handlePointerUp);
  document.addEventListener('pointerup', handlePointerUp);
  POINTER_LOCK_ERROR_EVENTS.forEach((eventName) =>
    pointerLockDocument.addEventListener(eventName, handlePointerLockError)
  );

  function attemptCollisionRescue(reason = 'update') {
    const currentPosition = controlObject.position;
    if (!collidesAt(currentPosition)) {
      if (
        collisionRescueFailureMessage &&
        playerState.statusMessage === collisionRescueFailureMessage
      ) {
        setStatus(defaultStatusMessage, Number.POSITIVE_INFINITY);
      }
      collisionRescueFailureMessage = null;
      collisionRescueFailureNotified = false;
      return true;
    }

    const workingPosition = currentPosition.clone();
    let attempts = 0;
    let resolved = false;

    while (attempts < 24 && workingPosition.y <= maxRescueHeight) {
      workingPosition.y += 0.75;
      attempts += 1;
      if (!collidesAt(workingPosition)) {
        resolved = true;
        break;
      }
    }

    if (resolved) {
      currentPosition.copy(workingPosition);
      verticalVelocity = Math.min(verticalVelocity, 0);
      maxDownwardSpeed = Math.min(maxDownwardSpeed, 0);
      isGrounded = false;
      if (
        collisionRescueFailureMessage &&
        playerState.statusMessage === collisionRescueFailureMessage
      ) {
        setStatus(defaultStatusMessage, Number.POSITIVE_INFINITY);
      }
      collisionRescueFailureMessage = null;
      collisionRescueFailureNotified = false;
      return true;
    }

    if (!collisionRescueFailureNotified) {
      const message =
        reason === 'spawn'
          ? 'We could not locate a safe place to spawn you. Press Esc to exit pointer lock and reload the demo.'
          : 'We could not move you to a safe spot. Press Esc to exit pointer lock and reload the demo.';
      collisionRescueFailureMessage = message;
      setStatus(message, Number.POSITIVE_INFINITY);
      collisionRescueFailureNotified = true;
    }

    return false;
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

  function copyVectorLike(source, target) {
    if (!source || !target) {
      throw new Error('copyVectorLike requires valid source and target objects.');
    }
    if (typeof source.x === 'number' && typeof source.y === 'number' && typeof source.z === 'number') {
      target.set(source.x, source.y, source.z);
      return;
    }
    if (typeof source.isVector3 === 'boolean' && source.isVector3) {
      target.copy(source);
      return;
    }
    throw new Error('Position must provide numeric x, y, z properties.');
  }

  function setPosition(nextPosition) {
    copyVectorLike(nextPosition, manualPosition);
    if (
      !Number.isFinite(manualPosition.x) ||
      !Number.isFinite(manualPosition.y) ||
      !Number.isFinite(manualPosition.z)
    ) {
      throw new Error('Position components must be finite numbers.');
    }

    previousPosition.copy(controlObject.position);
    controlObject.position.copy(manualPosition);

    if (!collidesAt(controlObject.position)) {
      return true;
    }

    const resolved = attemptCollisionRescue('teleport');
    if (!resolved) {
      controlObject.position.copy(previousPosition);
    }
    return resolved;
  }

  function getYawPitch() {
    yawPitchEuler.setFromQuaternion(controlObject.quaternion, 'YXZ');
    return {
      yaw: yawPitchEuler.y,
      pitch: yawPitchEuler.x,
    };
  }

  function resolveYawPitchArgs(yaw, pitch) {
    if (typeof yaw === 'object' && yaw !== null) {
      return { yaw: yaw.yaw, pitch: yaw.pitch };
    }
    return { yaw, pitch };
  }

  function setYawPitch(yaw, pitch) {
    const resolved = resolveYawPitchArgs(yaw, pitch);
    if (!Number.isFinite(resolved.yaw) || !Number.isFinite(resolved.pitch)) {
      throw new Error('Yaw and pitch must be finite numbers.');
    }

    const halfPi = Math.PI / 2;
    const minPitch = halfPi - (typeof controls.maxPolarAngle === 'number' ? controls.maxPolarAngle : Math.PI);
    const maxPitch = halfPi - (typeof controls.minPolarAngle === 'number' ? controls.minPolarAngle : 0);
    const clampedPitch = THREE.MathUtils.clamp(resolved.pitch, minPitch, maxPitch);

    yawPitchEuler.set(clampedPitch, resolved.yaw, 0, 'YXZ');
    controlObject.quaternion.setFromEuler(yawPitchEuler);
    controlObject.rotation.setFromQuaternion(controlObject.quaternion, controlObject.rotation.order);
    controls.dispatchEvent({ type: 'change' });
    return getYawPitch();
  }

  function isInSoftMedium(position) {
    if (!softBlocks || softBlocks.size === 0) {
      return false;
    }

    const playerFeet = position.y - playerEyeHeight;
    const playerHead = position.y;
    const minBlockX = Math.floor(position.x - playerRadius - 0.5);
    const maxBlockX = Math.floor(position.x + playerRadius + 0.5);
    const minBlockZ = Math.floor(position.z - playerRadius - 0.5);
    const maxBlockZ = Math.floor(position.z + playerRadius + 0.5);
    const minBlockY = Math.floor(playerFeet - 0.5);
    const maxBlockY = Math.floor(playerHead + 0.5);
    const epsilon = 1e-4;

    for (let x = minBlockX; x <= maxBlockX; x++) {
      for (let z = minBlockZ; z <= maxBlockZ; z++) {
        for (let y = minBlockY; y <= maxBlockY; y++) {
          if (!softBlocks.has(blockKey(x, y, z))) {
            continue;
          }

          const blockMinX = x - 0.5;
          const blockMaxX = x + 0.5;
          const blockMinY = y - 0.5;
          const blockMaxY = y + 0.5;
          const blockMinZ = z - 0.5;
          const blockMaxZ = z + 0.5;

          const overlaps =
            position.x + playerRadius > blockMinX + epsilon &&
            position.x - playerRadius < blockMaxX - epsilon &&
            playerHead > blockMinY + epsilon &&
            playerFeet < blockMaxY - epsilon &&
            position.z + playerRadius > blockMinZ + epsilon &&
            position.z - playerRadius < blockMaxZ - epsilon;

          if (overlaps) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function findStandingSurface(position, tolerance = 0.75) {
    const playerFeet = position.y - playerEyeHeight;
    const playerMinX = position.x - playerRadius;
    const playerMaxX = position.x + playerRadius;
    const playerMinZ = position.z - playerRadius;
    const playerMaxZ = position.z + playerRadius;

    const minBlockX = Math.floor(playerMinX - 0.5);
    const maxBlockX = Math.floor(playerMaxX + 0.5);
    const minBlockZ = Math.floor(playerMinZ - 0.5);
    const maxBlockZ = Math.floor(playerMaxZ + 0.5);

    const searchTop = Math.min(
      worldConfig.maxHeight + 2,
      Math.floor(playerFeet + tolerance),
    );
    const searchBottom = Math.max(-8, Math.floor(playerFeet - 6));
    const epsilon = 1e-4;
    let bestSurface = null;

    for (let x = minBlockX; x <= maxBlockX; x++) {
      for (let z = minBlockZ; z <= maxBlockZ; z++) {
        for (let y = searchTop; y >= searchBottom; y--) {
          if (!solidBlocks.has(blockKey(x, y, z))) {
            continue;
          }

          const blockMinX = x - 0.5;
          const blockMaxX = x + 0.5;
          const blockMinZ = z - 0.5;
          const blockMaxZ = z + 0.5;

          const horizontalOverlap =
            playerMaxX > blockMinX + epsilon &&
            playerMinX < blockMaxX - epsilon &&
            playerMaxZ > blockMinZ + epsilon &&
            playerMinZ < blockMaxZ - epsilon;

          if (!horizontalOverlap) {
            continue;
          }

          const blockTop = y + 0.5;
          if (blockTop > playerFeet + tolerance) {
            continue;
          }

          if (!bestSurface || blockTop > bestSurface.height) {
            bestSurface = { height: blockTop };
          }
        }
      }
    }

    return bestSurface;
  }

  function update(delta) {
    const { forward, backward, left, right, sprint } = moveState;
    const position = controlObject.position;

    const resolved = attemptCollisionRescue('update');
    if (!resolved && collidesAt(position)) {
      pushState();
      return;
    }

    const columnKey = `${Math.round(position.x)}|${Math.round(position.z)}`;
    const waterSurface = worldConfig.waterLevel + 0.5;
    const feetY = position.y - playerEyeHeight;
    const headY = position.y;
    const inWaterColumn = waterColumns.has(columnKey);
    const feetInWater = inWaterColumn && feetY < waterSurface;
    const headUnderwater = inWaterColumn && headY < waterSurface;
    const inSoftMedium = !feetInWater && isInSoftMedium(position);

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

      controls.getDirection(cameraForward);
      cameraForward.y = 0;
      if (cameraForward.lengthSq() === 0) {
        cameraForward.set(0, 0, -1);
      } else {
        cameraForward.normalize();
      }

      cameraRight.crossVectors(cameraForward, cameraUp);
      if (cameraRight.lengthSq() === 0) {
        cameraRight.set(1, 0, 0);
      } else {
        cameraRight.normalize();
      }

      movementStep
        .copy(cameraForward)
        .multiplyScalar(direction.z)
        .addScaledVector(cameraRight, direction.x);

      if (movementStep.lengthSq() > 0) {
        movementStep.normalize();
      }

      const flightActive = cheatState.flightEnabled;

      const baseSpeed = flightActive ? 14 : 5.2;

      const sprintBonus =
        !flightActive && sprint && forward && !feetInWater ? 3.2 : 0;
      const mediumPenalty = flightActive
        ? 1
        : feetInWater
        ? 0.42
        : inSoftMedium
        ? 0.7
        : 1;
      const moveSpeed = (baseSpeed + sprintBonus) * mediumPenalty;
      movementStep.multiplyScalar(moveSpeed * delta);

      const currentPosition = controlObject.position;
      const worldX = movementStep.x;
      const worldZ = movementStep.z;

      attemptPosition.copy(currentPosition);
      attemptPosition.x += worldX;
      attemptPosition.z += worldZ;

      if (!collidesAt(attemptPosition)) {
        currentPosition.copy(attemptPosition);
      } else {
        axisAttempt.copy(currentPosition);
        axisAttempt.x += worldX;
        if (!collidesAt(axisAttempt)) {
          currentPosition.x = axisAttempt.x;
        }

        axisAttempt.copy(currentPosition);
        axisAttempt.z += worldZ;
        if (!collidesAt(axisAttempt)) {
          currentPosition.z = axisAttempt.z;
        }
      }
    }

    if (cheatState.flightEnabled) {
      const verticalDirection =
        Number(flyState.ascend) - Number(flyState.descend);
      if (verticalDirection !== 0) {
        attemptPosition.copy(position);

        attemptPosition.y += verticalDirection * 18 * delta;

        if (!collidesAt(attemptPosition)) {
          position.copy(attemptPosition);
        }
      }
      verticalVelocity = 0;
      maxDownwardSpeed = Math.min(maxDownwardSpeed, 0);
      isGrounded = false;
      jumpRequested = false;
    } else {
      const standingSurface = findStandingSurface(position);
      const supportTargetY = standingSurface
        ? standingSurface.height + playerEyeHeight
        : Number.NEGATIVE_INFINITY;
      const waterTarget =
        worldConfig.waterLevel + 0.5 + playerEyeHeight - 0.2;
      let targetY = supportTargetY;
      if (!feetInWater && inWaterColumn) {
        targetY = Math.max(targetY, waterTarget);
      }

      if (jumpRequested) {
        const nearGround =
          Number.isFinite(supportTargetY) &&
          position.y <= supportTargetY + nearGroundThreshold;

        if (isGrounded || nearGround) {
          verticalVelocity = jumpVelocity;
          isGrounded = false;
        } else if (feetInWater) {
          verticalVelocity = Math.max(verticalVelocity, 4.6);
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

      if (Number.isFinite(targetY) && position.y <= targetY) {
        const landedOnSupport =
          Number.isFinite(supportTargetY) &&
          position.y <= supportTargetY + 1e-3;
        if (
          landedOnSupport &&
          !feetInWater &&
          maxDownwardSpeed < -12
        ) {
          const impact = Math.abs(maxDownwardSpeed) - 10;
          applyDamage(impact * 4.5, 'You hit the ground hard.');
        }
        position.y = landedOnSupport ? supportTargetY : targetY;
        verticalVelocity = 0;
        maxDownwardSpeed = 0;
        isGrounded = landedOnSupport;
      } else {
        isGrounded = false;
      }
    }

    if (statusTimer > 0) {
      statusTimer -= delta;
      if (statusTimer <= 0) {
        statusTimer = 0;
        clearStatus();
      }
    }

    updateAttack(delta);
    pushState();
  }

  function updateAttack(delta) {
    if (!controls.isLocked) {
      resetAttackProgress();
      return;
    }

    attackRay.setFromCamera(aimVector, camera);
    const intersections = attackRay.intersectObjects(scene.children, true);
    let blockInfo = null;
    for (const intersection of intersections) {
      if (!intersection.object?.isInstancedMesh) {
        continue;
      }
      const info = chunkManager.getBlockFromIntersection(intersection);
      if (!info?.entry?.destructible) {
        continue;
      }
      blockInfo = info;
      break;
    }

    if (!blockInfo) {
      decayAttack(delta);
      return;
    }

    if (!attackState.target || attackState.target.entry.key !== blockInfo.entry.key) {
      attackState.target = blockInfo;
      attackState.progress = 0;
    }

    if (attackState.swinging) {
      const type = attackState.target.entry.type;
      const durability = blockDurability.get(type) ?? 1.2;
      attackState.progress += delta / Math.max(durability, 0.1);
      if (attackState.progress >= 1) {
        chunkManager.removeBlockInstance({
          chunk: attackState.target.chunk,
          type: attackState.target.type,
          instanceId: attackState.target.instanceId,
        });
        resetAttackProgress();
        return;
      }
    } else {
      attackState.progress = Math.max(0, attackState.progress - delta * 1.5);
    }

    if (attackState.target && attackState.progress > 0) {
      showDamageOverlay(attackState.target.entry.position, attackState.progress);
    } else {
      hideDamageOverlay();
    }
  }

  function decayAttack(delta) {
    attackState.target = null;
    attackState.progress = Math.max(0, attackState.progress - delta * 2.5);
    if (attackState.progress <= 0) {
      hideDamageOverlay();
    }
  }

  function resetAttackProgress() {
    attackState.target = null;
    attackState.progress = 0;
    hideDamageOverlay();
  }

  function hideDamageOverlay() {
    if (!damageOverlayMesh.visible) {
      return;
    }
    damageOverlayMesh.visible = false;
  }

  function showDamageOverlay(position, progress) {
    if (!position) {
      hideDamageOverlay();
      return;
    }
    const stageCount = overlayMaterials.length;
    const stageIndex = Math.min(
      stageCount - 1,
      Math.floor(progress * stageCount)
    );
    if (stageIndex !== currentOverlayMaterialIndex) {
      damageOverlayMesh.material = overlayMaterials[stageIndex];
      currentOverlayMaterialIndex = stageIndex;
    }
    damageOverlayMesh.position.copy(position);
    if (!damageOverlayMesh.visible) {
      damageOverlayMesh.visible = true;
    }
  }

  function setInputEnabled(enabled) {
    const next = Boolean(enabled);
    if (inputEnabled === next) {
      return;
    }
    inputEnabled = next;
    if (!inputEnabled) {
      moveState.forward = false;
      moveState.backward = false;
      moveState.left = false;
      moveState.right = false;
      moveState.sprint = false;
      flyState.ascend = false;
      flyState.descend = false;
      jumpRequested = false;
      stopAttack();
    }
  }

  function setGodModeEnabled(enabled) {
    cheatState.godMode = Boolean(enabled);
    return cheatState.godMode;
  }

  function isGodModeEnabled() {
    return cheatState.godMode;
  }

  function setFlightEnabled(enabled) {
    const next = Boolean(enabled);
    if (cheatState.flightEnabled === next) {
      return cheatState.flightEnabled;
    }
    cheatState.flightEnabled = next;
    if (next) {
      jumpRequested = false;
      moveState.sprint = false;
      verticalVelocity = 0;
      maxDownwardSpeed = Math.min(maxDownwardSpeed, 0);
    } else {
      flyState.ascend = false;
      flyState.descend = false;
    }
    return cheatState.flightEnabled;
  }

  function isFlightEnabled() {
    return cheatState.flightEnabled;
  }

  function unstuck() {
    return attemptCollisionRescue('command');
  }

  function setHealth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('Health value must be a finite number.');
    }
    const clamped = THREE.MathUtils.clamp(numeric, 0, 100);
    if (playerState.health !== clamped) {
      playerState.health = clamped;
      markStateDirty();
      pushState();
    }
    return playerState.health;
  }

  function setOxygen(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('Oxygen value must be a finite number.');
    }
    const clamped = THREE.MathUtils.clamp(numeric, 0, playerState.maxOxygen);
    if (playerState.oxygen !== clamped) {
      playerState.oxygen = clamped;
      markStateDirty();
      pushState();
    }
    return playerState.oxygen;
  }

  function getMaxOxygen() {
    return playerState.maxOxygen;
  }

  function setStatusMessage(message, duration = 2.2) {
    setStatus(message, duration);
  }

  function clearStatusMessage() {
    clearStatus();
  }

  function dispose() {
    scene.remove(controlObject);
    overlay?.removeEventListener('click', handleOverlayClick);
    controls.removeEventListener('lock', handleLock);
    controls.removeEventListener('unlock', handleUnlock);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    pointerLockElement.removeEventListener('pointerdown', handlePointerDown);
    pointerLockElement.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointerup', handlePointerUp);
    POINTER_LOCK_ERROR_EVENTS.forEach((eventName) =>
      pointerLockDocument.removeEventListener(eventName, handlePointerLockError)
    );
    clearLockAttemptTimer();
    scene.remove(damageOverlayMesh);
    damageOverlayMesh.geometry.dispose();
  }

  function getPosition() {
    return controlObject.position;
  }

  function getState() {
    return { ...playerState };
  }

  return {
    controls,
    moveState,
    collidesAt,
    update,
    dispose,
    getPosition,
    setPosition,
    getState,
    getYawPitch,
    setYawPitch,
    setInputEnabled,
    setGodModeEnabled,
    isGodModeEnabled,
    setFlightEnabled,
    isFlightEnabled,
    unstuck,
    setHealth,
    setOxygen,
    getMaxOxygen,
    setStatusMessage,
    clearStatusMessage,
  };
}
