import { SURFACE_ROLES } from './fluid-geometry.js';

const SERUM_SETTINGS = Object.freeze({
  baseOpacity: 0.92,
  emissiveBase: 0.22,
  shimmerStrength: 0.18,
  distortionScale: 0.15,
  distortionSpeed: 0.6,
});

export function createAbyssalSerumMaterial({ THREE }) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1b0d2a'),
    emissive: new THREE.Color('#3c1647'),
    emissiveIntensity: SERUM_SETTINGS.emissiveBase,
    roughness: 0.46,
    metalness: 0.28,
    transparent: true,
    opacity: SERUM_SETTINGS.baseOpacity,
    vertexColors: true,
  });

  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  const uniforms = {
    uTime: { value: 0 },
    uDistortionScale: { value: SERUM_SETTINGS.distortionScale },
    uDistortionSpeed: { value: SERUM_SETTINGS.distortionSpeed },
    uShimmerStrength: { value: SERUM_SETTINGS.shimmerStrength },
  };

  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDistortionScale = uniforms.uDistortionScale;
    shader.uniforms.uDistortionSpeed = uniforms.uDistortionSpeed;
    shader.uniforms.uShimmerStrength = uniforms.uShimmerStrength;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float surfaceType;\nattribute float surfaceRole;\nattribute vec2 flowDirection;\nattribute float flowStrength;\nattribute float depth;\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nvarying vec2 vFlowDirection;\nvarying float vFlowStrength;\nvarying float vDepth;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvSurfaceType = surfaceType;\n\tvSurfaceRole = surfaceRole;\n\tvFlowDirection = flowDirection;\n\tvFlowStrength = flowStrength;\n\tvDepth = depth;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nvarying vec2 vFlowDirection;\nvarying float vFlowStrength;\nvarying float vDepth;\nuniform float uTime;\nuniform float uDistortionScale;\nuniform float uDistortionSpeed;\nuniform float uShimmerStrength;`,
    );

    const EDGE_TOP_MIN = (SURFACE_ROLES.EDGE_TOP - 0.5).toFixed(1);
    const EDGE_TOP_MAX = (SURFACE_ROLES.EDGE_TOP + 0.5).toFixed(1);
    const EDGE_BOTTOM_MIN = (SURFACE_ROLES.EDGE_BOTTOM - 0.5).toFixed(1);
    const EDGE_BOTTOM_MAX = (SURFACE_ROLES.EDGE_BOTTOM + 0.5).toFixed(1);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\nfloat edgeMask = smoothstep(${EDGE_TOP_MIN}, ${EDGE_TOP_MAX}, vSurfaceRole);\nedgeMask += smoothstep(${EDGE_BOTTOM_MIN}, ${EDGE_BOTTOM_MAX}, vSurfaceRole);\nfloat flowPhase = dot(vFlowDirection, vec2(12.0, -12.0)) * uDistortionScale + uTime * (uDistortionSpeed + vFlowStrength * 0.8);\nfloat viscosity = sin(flowPhase + vSurfaceType * 1.2);\nfloat shimmer = max(0.0, viscosity) * uShimmerStrength;\ntotalEmissiveRadiance += vec3(shimmer + edgeMask * 0.12);`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, clamp(vFlowStrength * 0.7, 0.0, 1.0));\ndiffuseColor.a = clamp(diffuseColor.a * (0.75 + vDepth * 0.12) + edgeMask * 0.08, 0.0, 1.0);\n#include <output_fragment>`,
    );
  };

  material.customProgramCacheKey = () =>
    `abyssal-serum-fluid-${SERUM_SETTINGS.distortionScale}-${SERUM_SETTINGS.shimmerStrength}`;

  const phaseOffsets = new WeakMap();
  let elapsed = 0;

  const ensureOffset = (mesh) => {
    if (phaseOffsets.has(mesh)) {
      return phaseOffsets.get(mesh);
    }
    const offset = Math.random() * Math.PI * 2;
    phaseOffsets.set(mesh, offset);
    return offset;
  };

  const update = (delta, surfaces) => {
    if (!delta || delta <= 0) {
      return;
    }
    elapsed += delta;
    uniforms.uTime.value = elapsed;

    if (!surfaces || surfaces.size === 0) {
      uniforms.uDistortionScale.value = SERUM_SETTINGS.distortionScale;
      uniforms.uShimmerStrength.value = SERUM_SETTINGS.shimmerStrength;
      return;
    }

    let wobbleTotal = 0;
    let shimmerTotal = 0;
    surfaces.forEach((mesh) => {
      const offset = ensureOffset(mesh);
      wobbleTotal += 1 + Math.sin(elapsed * 0.5 + offset) * 0.05;
      shimmerTotal += 0.9 + Math.cos(elapsed * 0.7 + offset) * 0.1;
    });
    const wobbleAverage = wobbleTotal / surfaces.size;
    const shimmerAverage = shimmerTotal / surfaces.size;
    uniforms.uDistortionScale.value =
      SERUM_SETTINGS.distortionScale * wobbleAverage;
    uniforms.uShimmerStrength.value =
      SERUM_SETTINGS.shimmerStrength * shimmerAverage;
  };

  const onSurfaceDisposed = (mesh) => {
    phaseOffsets.delete(mesh);
  };

  return {
    material,
    update,
    onSurfaceDisposed,
  };
}

export default createAbyssalSerumMaterial;
