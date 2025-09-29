import { SURFACE_ROLES } from './fluid-geometry.js';

const LUMEN_SETTINGS = Object.freeze({
  baseEmissiveIntensity: 1.1,
  edgeGlow: 0.7,
  pulseStrength: 0.65,
  opacity: 0.78,
  pulseSpeed: 1.9,
});

export function createLumenBloomMaterial({ THREE }) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4ef0ff'),
    emissive: new THREE.Color('#b0f7ff'),
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
    uAuroraHighlight: { value: 0 },
    uRibbonOrientation: { value: new THREE.Vector2(0, 1) },
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
    shader.uniforms.uAuroraHighlight = uniforms.uAuroraHighlight;
    shader.uniforms.uRibbonOrientation = uniforms.uRibbonOrientation;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float surfaceType;\nattribute float surfaceRole;\nattribute vec2 flowDirection;\nattribute float flowStrength;\nattribute vec2 ribbonVector;\nattribute float auroraGlow;\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nvarying vec2 vFlowDirection;\nvarying float vFlowStrength;\nvarying vec2 vRibbonVector;\nvarying float vAuroraGlow;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvSurfaceType = surfaceType;\n\tvSurfaceRole = surfaceRole;\n\tvFlowDirection = flowDirection;\n\tvFlowStrength = flowStrength;\n\tvRibbonVector = ribbonVector;\n\tvAuroraGlow = auroraGlow;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nvarying vec2 vFlowDirection;\nvarying float vFlowStrength;\nvarying vec2 vRibbonVector;\nvarying float vAuroraGlow;\nuniform float uTime;\nuniform float uEdgeGlow;\nuniform float uPulseStrength;\nuniform float uPulseSpeed;\nuniform vec2 uRibbonOrientation;\nuniform float uAuroraHighlight;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n\nvec2 ribbonDir = vRibbonVector;\nif (length(ribbonDir) < 0.001) {\n  ribbonDir = uRibbonOrientation;\n}\nif (length(ribbonDir) < 0.001) {\n  ribbonDir = vec2(0.0, 1.0);\n}\nribbonDir = normalize(ribbonDir);\nvec2 flowDir = vFlowDirection;\nif (length(flowDir) < 0.001) {\n  flowDir = ribbonDir;\n} else {\n  flowDir = normalize(flowDir);\n}\nfloat surfaceBand = smoothstep(0.5, 1.5, vSurfaceType);\nfloat roleBand = smoothstep(${EDGE_TOP_MIN}, ${EDGE_TOP_MAX}, vSurfaceRole);\nroleBand += smoothstep(${EDGE_BOTTOM_MIN}, ${EDGE_BOTTOM_MAX}, vSurfaceRole);\nfloat edgeGlow = clamp(surfaceBand + roleBand, 0.0, 2.0);\nfloat auroraEnergy = clamp(vAuroraGlow + uAuroraHighlight, 0.0, 2.0);\nauroraEnergy += clamp(vFlowStrength, 0.0, 1.0) * 0.25;\nfloat ribbonPhase = dot(flowDir, ribbonDir);\nfloat ribbonWave = sin(uTime * (uPulseSpeed + auroraEnergy * 1.2) + ribbonPhase * 6.0);\nfloat softPulse = sin(uTime * uPulseSpeed + vSurfaceType * 1.35);\nfloat auroraPulse = max(0.0, ribbonWave) * (0.5 + auroraEnergy * 0.7);\nfloat luminance = max(0.0, softPulse) * (uPulseStrength + auroraEnergy * 0.35) + edgeGlow * uEdgeGlow + auroraPulse;\nvec3 auroraTintA = vec3(0.28, 0.84, 1.05);\nvec3 auroraTintB = vec3(1.05, 0.52, 1.18);\nfloat tintBlend = clamp(0.5 + ribbonPhase * 0.45, 0.0, 1.0);\nvec3 auroraTint = mix(auroraTintA, auroraTintB, tintBlend);\ntotalEmissiveRadiance += auroraTint * luminance;\nfloat colorBlend = clamp(auroraEnergy * 0.55, 0.0, 1.0);\ndiffuseColor.rgb = mix(diffuseColor.rgb, auroraTint, colorBlend);\ndiffuseColor.a = clamp(diffuseColor.a + edgeGlow * 0.12 + colorBlend * 0.1, 0.0, 1.0);`,
    );
  };

  material.customProgramCacheKey = () =>
    `lumen-bloom-fluid-${LUMEN_SETTINGS.edgeGlow}-${LUMEN_SETTINGS.pulseStrength}`;

  const surfacePulseOffsets = new WeakMap();
  let elapsed = 0;
  const clamp = THREE.MathUtils?.clamp
    ? (value, min, max) => THREE.MathUtils.clamp(value, min, max)
    : (value, min, max) => Math.min(max, Math.max(min, value));

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
      uniforms.uAuroraHighlight.value = clamp(
        uniforms.uAuroraHighlight.value - delta * 0.4,
        0,
        2,
      );
      uniforms.uRibbonOrientation.value.set(0, 1);
      return;
    }

    let biasTotal = 0;
    let highlightTotal = 0;
    let orientationX = 0;
    let orientationY = 0;
    let orientationSamples = 0;
    surfaces.forEach((mesh) => {
      const offset = ensureOffset(mesh);
      const auroraIntensity = Number.isFinite(mesh.userData?.auroraIntensity)
        ? mesh.userData.auroraIntensity
        : 0;
      const auroraWeight = 1 + clamp(auroraIntensity / 3, 0, 1) * 0.4;
      biasTotal +=
        (0.85 + Math.sin(elapsed * 0.3 + offset) * 0.08) * auroraWeight;
      highlightTotal += auroraIntensity;
      const ribbonOrientation = mesh.userData?.ribbonOrientation;
      if (Number.isFinite(ribbonOrientation)) {
        orientationX += Math.cos(ribbonOrientation);
        orientationY += Math.sin(ribbonOrientation);
        orientationSamples += 1;
      }
    });
    const averageBias = biasTotal / surfaces.size;
    material.emissiveIntensity =
      LUMEN_SETTINGS.baseEmissiveIntensity * averageBias;

    const orientationUniform = uniforms.uRibbonOrientation.value;
    if (orientationSamples > 0) {
      orientationUniform.set(
        orientationX / orientationSamples,
        orientationY / orientationSamples,
      );
      if (orientationUniform.lengthSq() > 0.0001) {
        orientationUniform.normalize();
      } else {
        orientationUniform.set(0, 1);
      }
    } else {
      orientationUniform.set(0, 1);
    }

    const averageHighlight = highlightTotal / surfaces.size;
    const targetHighlight = clamp(averageHighlight / 3, 0, 1.5);
    uniforms.uAuroraHighlight.value = clamp(
      uniforms.uAuroraHighlight.value + (targetHighlight - uniforms.uAuroraHighlight.value) * 0.2,
      0,
      2,
    );
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
