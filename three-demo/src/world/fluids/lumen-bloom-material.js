import { SURFACE_ROLES } from './fluid-geometry.js';

const auroraRibbonUrl = new URL(
  '../../textures/nonprocedural/texture_aurora_1.png',
  import.meta.url,
).href;

const LUMEN_SETTINGS = Object.freeze({
  baseEmissiveIntensity: 1.1,
  edgeGlow: 0.7,
  pulseStrength: 0.65,
  opacity: 0.78,
  pulseSpeed: 1.9,
  ribbonWaveAmplitude: 0.32,
  ribbonWaveFrequency: 1.45,
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
    uNoisePhase: { value: 0 },
    uViewAngleBias: { value: 0.75 },
    uColorRampA: { value: new THREE.Color('#3ac8ff') },
    uColorRampB: { value: new THREE.Color('#ff77d8') },
    uColorRampC: { value: new THREE.Color('#ffe066') },
    uRibbonWaveAmplitude: { value: LUMEN_SETTINGS.ribbonWaveAmplitude },
    uRibbonWaveFrequency: { value: LUMEN_SETTINGS.ribbonWaveFrequency },
    uRibbonWavePhase: { value: 0 },
    uAuroraMap: { value: null },
  };

  if (THREE.TextureLoader) {
    const textureLoader = new THREE.TextureLoader();
    const auroraRibbonTexture = textureLoader.load(auroraRibbonUrl);
    auroraRibbonTexture.wrapS = THREE.MirroredRepeatWrapping;
    auroraRibbonTexture.wrapT = THREE.ClampToEdgeWrapping;
    if ('SRGBColorSpace' in THREE) {
      auroraRibbonTexture.colorSpace = THREE.SRGBColorSpace;
    } else if ('sRGBEncoding' in THREE) {
      auroraRibbonTexture.encoding = THREE.sRGBEncoding;
    }
    uniforms.uAuroraMap.value = auroraRibbonTexture;
  }

  if (!uniforms.uAuroraMap.value) {
    uniforms.uAuroraMap.value = new THREE.Texture();
  }

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
    shader.uniforms.uNoisePhase = uniforms.uNoisePhase;
    shader.uniforms.uViewAngleBias = uniforms.uViewAngleBias;
    shader.uniforms.uColorRampA = uniforms.uColorRampA;
    shader.uniforms.uColorRampB = uniforms.uColorRampB;
    shader.uniforms.uColorRampC = uniforms.uColorRampC;
    shader.uniforms.uRibbonWaveAmplitude = uniforms.uRibbonWaveAmplitude;
    shader.uniforms.uRibbonWaveFrequency = uniforms.uRibbonWaveFrequency;
    shader.uniforms.uRibbonWavePhase = uniforms.uRibbonWavePhase;
    shader.uniforms.uAuroraMap = uniforms.uAuroraMap;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float surfaceType;\nattribute float surfaceRole;\nattribute vec2 flowDirection;\nattribute float flowStrength;\nattribute vec2 ribbonVector;\nattribute float auroraGlow;\nattribute float ribbonHeightFraction;\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nvarying vec2 vFlowDirection;\nvarying float vFlowStrength;\nvarying vec2 vRibbonVector;\nvarying float vAuroraGlow;\nvarying float vRibbonHeight;\nvarying vec2 vUv;\nuniform float uTime;\nuniform vec2 uRibbonOrientation;\nuniform float uRibbonWaveAmplitude;\nuniform float uRibbonWaveFrequency;\nuniform float uRibbonWavePhase;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvSurfaceType = surfaceType;\n\tvSurfaceRole = surfaceRole;\n\tvFlowDirection = flowDirection;\n\tvFlowStrength = flowStrength;\n\tvRibbonVector = ribbonVector;\n\tvAuroraGlow = auroraGlow;\n\tvRibbonHeight = ribbonHeightFraction;\n\tvUv = uv;\n\tvec2 swayVector = ribbonVector;\n\tif (length(swayVector) < 0.001) {\n\t  swayVector = uRibbonOrientation;\n\t}\n\tvec3 swayDirection = vec3(0.0);\n\tif (length(swayVector) > 0.001) {\n\t  swayDirection = normalize(vec3(swayVector.x, 0.0, swayVector.y));\n\t}\n\tif (length(swayDirection) < 0.001) {\n\t  swayDirection = normalize(normal);\n\t}\n\tfloat heightPhase = ribbonHeightFraction * 6.28318;\n\tfloat ribbonSway = sin(uRibbonWavePhase + uTime * uRibbonWaveFrequency + heightPhase) * uRibbonWaveAmplitude;\n\ttransformed += swayDirection * ribbonSway;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vSurfaceType;\nvarying float vSurfaceRole;\nvarying vec2 vFlowDirection;\nvarying float vFlowStrength;\nvarying vec2 vRibbonVector;\nvarying float vAuroraGlow;\nvarying float vRibbonHeight;\nvarying vec2 vUv;\nuniform float uTime;\nuniform float uEdgeGlow;\nuniform float uPulseStrength;\nuniform float uPulseSpeed;\nuniform vec2 uRibbonOrientation;\nuniform float uAuroraHighlight;\nuniform float uNoisePhase;\nuniform float uViewAngleBias;\nuniform vec3 uColorRampA;\nuniform vec3 uColorRampB;\nuniform vec3 uColorRampC;\nuniform sampler2D uAuroraMap;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n\nvec2 ribbonDir = vRibbonVector;\nif (length(ribbonDir) < 0.001) {\n  ribbonDir = uRibbonOrientation;\n}\nif (length(ribbonDir) < 0.001) {\n  ribbonDir = vec2(0.0, 1.0);\n}\nribbonDir = normalize(ribbonDir);\nvec2 flowDir = vFlowDirection;\nif (length(flowDir) < 0.001) {\n  flowDir = ribbonDir;\n} else {\n  flowDir = normalize(flowDir);\n}\nfloat surfaceBand = smoothstep(0.5, 1.5, vSurfaceType);\nfloat roleBand = smoothstep(${EDGE_TOP_MIN}, ${EDGE_TOP_MAX}, vSurfaceRole);\nroleBand += smoothstep(${EDGE_BOTTOM_MIN}, ${EDGE_BOTTOM_MAX}, vSurfaceRole);\nfloat edgeGlow = clamp(surfaceBand + roleBand, 0.0, 2.0);\nfloat auroraEnergy = clamp(vAuroraGlow + uAuroraHighlight, 0.0, 2.0);\nauroraEnergy += clamp(vFlowStrength, 0.0, 1.0) * 0.25;\nvec3 viewDir = normalize(-vViewPosition);\nvec3 viewNormal = normalize(normal);\nfloat viewAlignment = clamp(dot(viewDir, viewNormal), -1.0, 1.0);\nfloat grazing = pow(1.0 - max(viewAlignment, 0.0), 2.0);\nfloat biasStrength = mix(0.35, 1.25, clamp(uViewAngleBias, 0.0, 1.0));\nfloat grazingBias = clamp(grazing * biasStrength, 0.0, 1.0);\nfloat ribbonPhase = dot(flowDir, ribbonDir);\nfloat ribbonWave = sin(uTime * (uPulseSpeed + auroraEnergy * 1.2) + ribbonPhase * 6.0);\nfloat softPulse = sin(uTime * uPulseSpeed + vSurfaceType * 1.35);\nfloat auroraPulse = max(0.0, ribbonWave) * (0.5 + auroraEnergy * 0.7);\nfloat luminance = max(0.0, softPulse) * (uPulseStrength + auroraEnergy * 0.35) + edgeGlow * uEdgeGlow + auroraPulse;\nfloat noiseTrail = sin(uNoisePhase + ribbonPhase * 4.0 + viewDir.y * 3.0 + vSurfaceType * 0.9);\nfloat swirl = sin(uNoisePhase * 0.7 + viewDir.x * 2.5 + flowDir.y * 3.5);\nfloat hueAB = clamp(grazingBias * 0.8 + (noiseTrail * 0.5 + 0.5) * (1.0 - grazingBias * 0.3), 0.0, 1.0);\nfloat hueBC = clamp((1.0 - hueAB) * 0.55 + (swirl * 0.5 + 0.5) * 0.45 + auroraEnergy * 0.2, 0.0, 1.0);\nfloat hueCA = clamp(1.0 - hueAB - hueBC, 0.0, 1.0);\nfloat weightSum = hueAB + hueBC + hueCA + 1e-5;\nvec3 oilColor = (uColorRampA * hueAB + uColorRampB * hueBC + uColorRampC * hueCA) / weightSum;\nfloat spectralBlend = clamp(auroraEnergy * 0.35 + grazingBias * 0.25, 0.0, 1.0);\nvec3 auroraTint = mix(oilColor, uColorRampB, spectralBlend);\nvec2 auroraUv = vec2(fract(vUv.x), clamp(vRibbonHeight, 0.0, 1.0));\nvec4 auroraSample = texture2D(uAuroraMap, auroraUv);\nfloat ribbonMask = clamp(auroraSample.a * 1.1, 0.0, 1.0);\nvec3 ribbonColor = mix(oilColor, auroraSample.rgb, ribbonMask);\nfloat ribbonEnergy = clamp(dot(auroraSample.rgb, vec3(0.299, 0.587, 0.114)) * 1.4, 0.0, 1.5);\nvec3 texturedAurora = mix(auroraTint, ribbonColor, ribbonMask);\nfloat luminanceBoost = mix(1.0, 1.35 + ribbonEnergy * 0.35, ribbonMask);\nluminance *= luminanceBoost;\ntotalEmissiveRadiance += texturedAurora * luminance;\nfloat colorBlend = clamp(auroraEnergy * 0.45 + grazingBias * 0.4 + ribbonMask * 0.35, 0.0, 1.0);\ndiffuseColor.rgb = mix(diffuseColor.rgb, mix(oilColor, texturedAurora, ribbonMask * 0.8), colorBlend);\ndiffuseColor.a = clamp(diffuseColor.a + edgeGlow * 0.12 + colorBlend * 0.1 + ribbonMask * 0.25, 0.0, 1.0);`,
    );
  };

  material.customProgramCacheKey = () => {
    const auroraMap = uniforms.uAuroraMap.value;
    return `lumen-bloom-fluid-${LUMEN_SETTINGS.edgeGlow}-${LUMEN_SETTINGS.pulseStrength}-${LUMEN_SETTINGS.ribbonWaveAmplitude}-${LUMEN_SETTINGS.ribbonWaveFrequency}-${auroraMap ? auroraMap.uuid : 'no-map'}`;
  };

  const surfacePulseOffsets = new WeakMap();
  let elapsed = 0;
  const clamp = THREE.MathUtils?.clamp
    ? (value, min, max) => THREE.MathUtils.clamp(value, min, max)
    : (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = THREE.MathUtils?.lerp
    ? (start, end, alpha) => THREE.MathUtils.lerp(start, end, alpha)
    : (start, end, alpha) => start + (end - start) * alpha;

  const wrapHue = (value) => {
    const modulo = value % 1;
    return modulo < 0 ? modulo + 1 : modulo;
  };

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
    uniforms.uNoisePhase.value = elapsed * 0.65;

    const amplitudeUniform = uniforms.uRibbonWaveAmplitude;
    const frequencyUniform = uniforms.uRibbonWaveFrequency;

    const animatedBias = 0.65 + Math.sin(elapsed * 0.45) * 0.35;
    uniforms.uViewAngleBias.value = clamp(animatedBias, 0, 1);

    const baseHue = wrapHue(0.58 + Math.sin(elapsed * 0.21) * 0.07);
    const rampA = uniforms.uColorRampA.value;
    const rampB = uniforms.uColorRampB.value;
    const rampC = uniforms.uColorRampC.value;
    rampA.setHSL(baseHue, 0.82, 0.55);
    rampB.setHSL(wrapHue(baseHue + 0.32 + Math.sin(elapsed * 0.13) * 0.03), 0.78, 0.58);
    rampC.setHSL(wrapHue(baseHue + 0.58 + Math.cos(elapsed * 0.29) * 0.04), 0.65, 0.6);

    if (!surfaces || surfaces.size === 0) {
      material.emissiveIntensity = LUMEN_SETTINGS.baseEmissiveIntensity;
      uniforms.uAuroraHighlight.value = clamp(
        uniforms.uAuroraHighlight.value - delta * 0.4,
        0,
        2,
      );
      uniforms.uRibbonOrientation.value.set(0, 1);
      uniforms.uRibbonWavePhase.value = elapsed * 0.45;
      amplitudeUniform.value = lerp(
        amplitudeUniform.value,
        LUMEN_SETTINGS.ribbonWaveAmplitude * 0.25,
        clamp(delta * 1.8, 0, 1),
      );
      frequencyUniform.value = lerp(
        frequencyUniform.value,
        LUMEN_SETTINGS.ribbonWaveFrequency,
        clamp(delta * 1.2, 0, 1),
      );
      return;
    }

    let biasTotal = 0;
    let highlightTotal = 0;
    let orientationX = 0;
    let orientationY = 0;
    let orientationSamples = 0;
    let phaseOffsetTotal = 0;
    let phaseSamples = 0;
    surfaces.forEach((mesh) => {
      const offset = ensureOffset(mesh);
      const auroraIntensity = Number.isFinite(mesh.userData?.auroraIntensity)
        ? mesh.userData.auroraIntensity
        : 0;
      const auroraWeight = 1 + clamp(auroraIntensity / 3, 0, 1) * 0.4;
      biasTotal +=
        (0.85 + Math.sin(elapsed * 0.3 + offset) * 0.08) * auroraWeight;
      highlightTotal += auroraIntensity;
      phaseOffsetTotal += offset;
      phaseSamples += 1;
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

    const averagePhaseOffset = phaseSamples > 0 ? phaseOffsetTotal / phaseSamples : 0;
    uniforms.uRibbonWavePhase.value = averagePhaseOffset + elapsed * 0.45;

    const amplitudeTarget = clamp(
      LUMEN_SETTINGS.ribbonWaveAmplitude * (0.6 + targetHighlight * 0.45 + clamp(averageBias - 1, -0.5, 0.75) * 0.3),
      0.05,
      1.2,
    );
    amplitudeUniform.value = lerp(
      amplitudeUniform.value,
      amplitudeTarget,
      clamp(delta * 2.4, 0, 1),
    );

    const frequencyPulse = 1 + Math.sin(elapsed * 0.18 + averagePhaseOffset * 0.25) * 0.1;
    const frequencyTarget = clamp(
      LUMEN_SETTINGS.ribbonWaveFrequency * (frequencyPulse + targetHighlight * 0.25),
      0.2,
      5,
    );
    frequencyUniform.value = lerp(
      frequencyUniform.value,
      frequencyTarget,
      clamp(delta * 1.6, 0, 1),
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
