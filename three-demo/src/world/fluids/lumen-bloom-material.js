import { SURFACE_ROLES } from './fluid-geometry.js';

const LUMEN_SETTINGS = Object.freeze({
  baseEmissiveIntensity: 0.85,
  edgeGlow: 0.55,
  pulseStrength: 0.5,
  opacity: 0.82,
  pulseSpeed: 1.8,
});

export function createLumenBloomMaterial({ THREE }) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f7fbb4'),
    emissive: new THREE.Color('#f4ffd2'),
    emissiveIntensity: LUMEN_SETTINGS.baseEmissiveIntensity,
    roughness: 0.3,
    metalness: 0.08,
    transparent: true,
    opacity: LUMEN_SETTINGS.opacity,
    vertexColors: true,
  });

  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  const uniforms = {
    uTime: { value: 0 },
    uEdgeGlow: { value: LUMEN_SETTINGS.edgeGlow },
    uPulseStrength: { value: LUMEN_SETTINGS.pulseStrength },
    uPulseSpeed: { value: LUMEN_SETTINGS.pulseSpeed },
  };

  material.userData.uniforms = uniforms;

  const EDGE_TOP_MIN = (SURFACE_ROLES.EDGE_TOP - 0.5).toFixed(1);
  const EDGE_TOP_MAX = (SURFACE_ROLES.EDGE_TOP + 0.5).toFixed(1);
  const EDGE_BOTTOM_MIN = (SURFACE_ROLES.EDGE_BOTTOM - 0.5).toFixed(1);
  const EDGE_BOTTOM_MAX = (SURFACE_ROLES.EDGE_BOTTOM + 0.5).toFixed(1);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uEdgeGlow = uniforms.uEdgeGlow;
    shader.uniforms.uPulseStrength = uniforms.uPulseStrength;
    shader.uniforms.uPulseSpeed = uniforms.uPulseSpeed;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float surfaceType;\nattribute float surfaceRole;\nvarying float vSurfaceType;\nvarying float vSurfaceRole;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvSurfaceType = surfaceType;\n\tvSurfaceRole = surfaceRole;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nuniform float uTime;\nuniform float uEdgeGlow;\nuniform float uPulseStrength;\nuniform float uPulseSpeed;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n\nfloat surfaceBand = smoothstep(0.5, 1.5, vSurfaceType);\nfloat roleBand = smoothstep(${EDGE_TOP_MIN}, ${EDGE_TOP_MAX}, vSurfaceRole);\nroleBand += smoothstep(${EDGE_BOTTOM_MIN}, ${EDGE_BOTTOM_MAX}, vSurfaceRole);\nfloat edgeGlow = clamp(surfaceBand + roleBand, 0.0, 2.0);\nfloat pulse = sin(uTime * uPulseSpeed + vSurfaceType * 1.35);\nfloat luminance = max(0.0, pulse) * uPulseStrength + edgeGlow * uEdgeGlow;\ntotalEmissiveRadiance += vec3(luminance);\ndiffuseColor.a = clamp(diffuseColor.a + edgeGlow * 0.12, 0.0, 1.0);`,
    );
  };

  material.customProgramCacheKey = () =>
    `lumen-bloom-fluid-${LUMEN_SETTINGS.edgeGlow}-${LUMEN_SETTINGS.pulseStrength}`;

  const surfacePulseOffsets = new WeakMap();
  let elapsed = 0;

  const ensureOffset = (mesh) => {
    if (surfacePulseOffsets.has(mesh)) {
      return surfacePulseOffsets.get(mesh);
    }
    const offset = Math.random() * Math.PI * 2;
    surfacePulseOffsets.set(mesh, offset);
    return offset;
  };

  const update = (delta, surfaces) => {
    if (!delta || delta <= 0) {
      return;
    }
    elapsed += delta;
    uniforms.uTime.value = elapsed;

    if (!surfaces || surfaces.size === 0) {
      material.emissiveIntensity = LUMEN_SETTINGS.baseEmissiveIntensity;
      return;
    }

    let biasTotal = 0;
    surfaces.forEach((mesh) => {
      const offset = ensureOffset(mesh);
      biasTotal += 0.85 + Math.sin(elapsed * 0.3 + offset) * 0.08;
    });
    const averageBias = biasTotal / surfaces.size;
    material.emissiveIntensity =
      LUMEN_SETTINGS.baseEmissiveIntensity * averageBias;
  };

  const onSurfaceDisposed = (mesh) => {
    surfacePulseOffsets.delete(mesh);
  };

  return {
    material,
    update,
    onSurfaceDisposed,
  };
}

export default createLumenBloomMaterial;
