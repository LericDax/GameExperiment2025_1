import * as THREE from 'three';

const OVERLAY_DISTANCE = 0.65;
const MIN_INTENSITY = 0;
const MAX_INTENSITY = 3.6;
const DEFAULT_INTENSITY = 0.45;

const MIN_WIND_SPEED = -2.5;
const MAX_WIND_SPEED = 2.5;
const DEFAULT_WIND_SPEED = 0;

const MIN_STREAK_DENSITY = 0.45;
const MAX_STREAK_DENSITY = 2.8;
const DEFAULT_STREAK_DENSITY = 1.05;

const MIN_SPARKLE_GAIN = 0.25;
const MAX_SPARKLE_GAIN = 1.9;
const DEFAULT_SPARKLE_GAIN = 0.85;

const tempDirection = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampWindSpeed(value) {
  return clamp(value, MIN_WIND_SPEED, MAX_WIND_SPEED);
}

function clampStreakDensity(value) {
  return clamp(value, MIN_STREAK_DENSITY, MAX_STREAK_DENSITY);
}

function clampSparkleGain(value) {
  return clamp(value, MIN_SPARKLE_GAIN, MAX_SPARKLE_GAIN);
}

function createOverlayMaterial({
  intensity = DEFAULT_INTENSITY,
  windSpeed = DEFAULT_WIND_SPEED,
  streakDensity = DEFAULT_STREAK_DENSITY,
  sparkleGain = DEFAULT_SPARKLE_GAIN,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: clamp(intensity, MIN_INTENSITY, MAX_INTENSITY) },
      uWindSpeed: { value: clampWindSpeed(windSpeed) },
      uStreakDensity: { value: clampStreakDensity(streakDensity) },
      uSparkleGain: { value: clampSparkleGain(sparkleGain) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uWindSpeed;
      uniform float uStreakDensity;
      uniform float uSparkleGain;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float saturate(float value) {
        return clamp(value, 0.0, 1.0);
      }

      float streakLayer(vec2 uv, float scale, float speed, float seed) {
        float density = max(0.3, uStreakDensity * scale);
        vec2 tilting = vec2(uWindSpeed * 0.22 * scale, 0.0);
        vec2 flow = uv * vec2(1.0, mix(1.15, 1.4, saturate(scale * 0.4)));
        flow.xy += tilting * (flow.y + seed);
        float phase = uTime * speed + seed * 1.7;
        flow.y += phase;
        vec2 grid = floor(flow * vec2(density * 0.95, density * 3.6));
        vec2 local = fract(flow * vec2(density * 0.95, density * 3.6));
        float jitter = hash(grid + seed);
        float trail = smoothstep(0.98 - jitter * 0.2, 0.15 + jitter * 0.1, local.y);
        float spread = 0.42 + jitter * 0.1;
        float column = smoothstep(spread, 0.0, abs(local.x - 0.5));
        vec2 headCenter = vec2(0.5 + jitter * 0.08, 0.12 + jitter * 0.16);
        float head = smoothstep(0.24, 0.0, distance(local, headCenter));
        float sparklePulse = 0.5 + 0.5 * sin((phase * 2.2 + (local.y + jitter) * 6.28318));
        float sparkle = mix(1.0, sparklePulse * 1.35, saturate(uSparkleGain));
        return (trail * column * 0.65 + head * 0.45) * sparkle;
      }

      void main() {
        vec2 baseUv = vUv * vec2(1.0, 1.32);
        float layerA = streakLayer(baseUv + vec2(0.08, 0.02), 0.8, 0.35, 1.1);
        float layerB = streakLayer(baseUv * vec2(1.08, 1.05) + vec2(-0.12, 0.21), 1.0, 0.62, 2.7);
        float layerC = streakLayer(baseUv * vec2(1.22, 1.18) + vec2(0.18, -0.17), 1.35, 0.9, 4.3);
        float mask = clamp(layerA * 0.7 + layerB * 0.9 + layerC * 0.85, 0.0, 1.0);
        float opacity = mask * clamp(uIntensity, 0.0, ${MAX_INTENSITY.toFixed(1)}) * 0.58;
        if (opacity <= 0.001) {
          discard;
        }
        vec3 darkTint = vec3(0.46, 0.62, 0.78);
        vec3 lightTint = vec3(0.83, 0.9, 0.98);
        vec3 tint = mix(darkTint, lightTint, mask);
        gl_FragColor = vec4(tint, opacity);
      }
    `,
  });
}

export function createRaindropOverlay({
  intensity = DEFAULT_INTENSITY,
  windSpeed = DEFAULT_WIND_SPEED,
  streakDensity = DEFAULT_STREAK_DENSITY,
  sparkleGain = DEFAULT_SPARKLE_GAIN,
} = {}) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = createOverlayMaterial({
    intensity,
    windSpeed,
    streakDensity,
    sparkleGain,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'WeatherRaindropOverlay';
  mesh.renderOrder = 995;
  mesh.frustumCulled = false;

  let elapsed = 0;

  mesh.onBeforeRender = function onBeforeRender(renderer, scene, camera) {
    if (!camera) {
      return;
    }
    const targetDistance = OVERLAY_DISTANCE;
    const direction = camera.getWorldDirection(tempDirection.set(0, 0, -1));
    mesh.position.copy(camera.position).addScaledVector(direction, targetDistance);
    mesh.quaternion.copy(camera.quaternion).multiply(tempQuaternion);

    if (camera.isPerspectiveCamera) {
      const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * targetDistance * 2;
      mesh.scale.set(vertical * camera.aspect, vertical, 1);
    } else if (camera.isOrthographicCamera) {
      const width = Math.abs(camera.right - camera.left);
      const height = Math.abs(camera.top - camera.bottom);
      mesh.scale.set(width, height, 1);
    }
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  };

  const setIntensity = (value) => {
    const next = clamp(value, MIN_INTENSITY, MAX_INTENSITY);
    material.uniforms.uIntensity.value = next;
  };

  const getIntensity = () => material.uniforms.uIntensity.value;

  const setWindSpeed = (value) => {
    material.uniforms.uWindSpeed.value = clampWindSpeed(value);
  };

  const getWindSpeed = () => material.uniforms.uWindSpeed.value;

  const setStreakDensity = (value) => {
    material.uniforms.uStreakDensity.value = clampStreakDensity(value);
  };

  const getStreakDensity = () => material.uniforms.uStreakDensity.value;

  const setSparkleGain = (value) => {
    material.uniforms.uSparkleGain.value = clampSparkleGain(value);
  };

  const getSparkleGain = () => material.uniforms.uSparkleGain.value;

  function update({ delta = 0, elapsedTime } = {}) {
    if (Number.isFinite(elapsedTime)) {
      elapsed = elapsedTime;
    } else if (Number.isFinite(delta)) {
      elapsed += delta;
    }
    material.uniforms.uTime.value = elapsed;
  }

  function dispose() {
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    geometry.dispose();
    material.dispose();
  }

  return {
    mesh,
    setIntensity,
    getIntensity,
    setWindSpeed,
    getWindSpeed,
    setStreakDensity,
    getStreakDensity,
    setSparkleGain,
    getSparkleGain,
    update,
    dispose,
  };
}

export function clampRaindropOverlayIntensity(value) {
  return clamp(value, MIN_INTENSITY, MAX_INTENSITY);
}

export function clampRaindropOverlayWindSpeed(value) {
  return clampWindSpeed(Number.isFinite(value) ? value : DEFAULT_WIND_SPEED);
}

export function clampRaindropOverlayStreakDensity(value) {
  return clampStreakDensity(Number.isFinite(value) ? value : DEFAULT_STREAK_DENSITY);
}

export function clampRaindropOverlaySparkleGain(value) {
  return clampSparkleGain(Number.isFinite(value) ? value : DEFAULT_SPARKLE_GAIN);
}

export {
  DEFAULT_WIND_SPEED as DEFAULT_RAIN_OVERLAY_WIND_SPEED,
  DEFAULT_STREAK_DENSITY as DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
  DEFAULT_SPARKLE_GAIN as DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
};
