import * as THREE from 'three';

const OVERLAY_DISTANCE = 0.65;
const MIN_INTENSITY = 0;
const MAX_INTENSITY = 2.4;
const DEFAULT_INTENSITY = 0.45;

const tempDirection = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createOverlayMaterial(intensity = DEFAULT_INTENSITY) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: clamp(intensity, MIN_INTENSITY, MAX_INTENSITY) },
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

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float raindropMask(vec2 uv, float speed, float tilt) {
        vec2 flowUv = vec2(uv.x + tilt * uv.y, uv.y);
        flowUv.y = fract(flowUv.y + uTime * speed);
        vec2 grid = floor(flowUv * vec2(8.0, 5.0));
        vec2 local = fract(flowUv * vec2(8.0, 5.0));
        float seed = hash(grid);
        float trail = smoothstep(0.95, 0.1, local.y + seed * 0.4);
        float column = smoothstep(0.42, 0.0, abs(local.x - 0.5));
        float head = smoothstep(0.18, 0.0, length(local - vec2(0.5, 0.12 + seed * 0.12)));
        float sparkle = smoothstep(0.75, 0.95, sin((local.y + seed) * 6.28318));
        return (trail * column * 0.65 + head * 0.45) * sparkle;
      }

      void main() {
        float base = raindropMask(vUv * vec2(1.0, 1.3), 0.08, -0.08);
        float offset = raindropMask(vUv * vec2(1.0, 1.6) + vec2(0.35, 0.0), 0.12, -0.05);
        float fine = raindropMask(vUv * vec2(1.0, 1.1) + vec2(-0.2, 0.1), 0.06, -0.1);
        float mask = clamp(base + offset * 0.8 + fine * 0.6, 0.0, 1.0);
        float opacity = mask * clamp(uIntensity, 0.0, ${MAX_INTENSITY.toFixed(1)}) * 0.55;
        if (opacity <= 0.001) {
          discard;
        }
        vec3 tint = mix(vec3(0.55, 0.66, 0.78), vec3(0.78, 0.86, 0.93), mask);
        gl_FragColor = vec4(tint, opacity);
      }
    `,
  });
}

export function createRaindropOverlay({ intensity = DEFAULT_INTENSITY } = {}) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = createOverlayMaterial(intensity);
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

  function setIntensity(value) {
    const next = clamp(value, MIN_INTENSITY, MAX_INTENSITY);
    material.uniforms.uIntensity.value = next;
  }

  function getIntensity() {
    return material.uniforms.uIntensity.value;
  }

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
    update,
    dispose,
  };
}

export function clampRaindropOverlayIntensity(value) {
  return clamp(value, MIN_INTENSITY, MAX_INTENSITY);
}
