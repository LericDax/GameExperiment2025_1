/**
 * Hydra is our high-fidelity water rendering pipeline. Historically the module exported a
 * function that returned a ShaderMaterial and a bare update loop. As the open world systems
 * matured we needed a place to keep environment metadata, validate incoming geometry, and tune
 * the wave model without duplicating logic across call sites. This file therefore now exposes
 * a small pipeline class that encapsulates shader creation, configuration, and diagnostics.
 */

const DEFAULT_WAVE_PROFILE = {
  primaryScale: 0.42,
  secondaryScale: 0.18,
  choppiness: 0.55,
  flowScale: 0.16,
  foamSpeed: 1.1,
  fadeDepth: 7.5,
  refractionStrength: 0.42,
  edgeFoamBoost: 1.35,
};

const DEFAULT_COLORS = {
  shallowTint: '#5ddfff',
  deepTint: '#0a2a63',
  foamColor: '#c4f4ff',
  horizonTint: '#7bd4ff',
  underwaterColor: '#052946',
  surfaceGlintColor: '#66e0ff',
  ambientColor: '#2a3f58',
  lightColor: '#ffffff',
};

function sanitizeNumber(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function sanitizePositiveNumber(value, fallback, { min = 0 } = {}) {
  const sanitized = sanitizeNumber(value, fallback);
  return Math.max(min, sanitized);
}

function createColor(THREE, value, fallback) {
  if (value instanceof THREE.Color) {
    return value.clone();
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    try {
      return new THREE.Color(value);
    } catch (error) {
      console.warn('[hydra] Failed to parse color value, using fallback.', value, error);
    }
  }
  if (typeof value === 'object' && value !== null) {
    const { r, g, b } = value;
    if ([r, g, b].every((component) => typeof component === 'number')) {
      return new THREE.Color(r, g, b);
    }
  }
  return new THREE.Color(fallback);
}

function normalizeWaveProfile(profile = {}) {
  return {
    primaryScale: sanitizePositiveNumber(profile.primaryScale, DEFAULT_WAVE_PROFILE.primaryScale, {
      min: 0.01,
    }),
    secondaryScale: sanitizePositiveNumber(
      profile.secondaryScale,
      DEFAULT_WAVE_PROFILE.secondaryScale,
      { min: 0 },
    ),
    choppiness: sanitizePositiveNumber(profile.choppiness, DEFAULT_WAVE_PROFILE.choppiness, {
      min: 0.01,
    }),
    flowScale: sanitizePositiveNumber(profile.flowScale, DEFAULT_WAVE_PROFILE.flowScale, {
      min: 0,
    }),
    foamSpeed: sanitizePositiveNumber(profile.foamSpeed, DEFAULT_WAVE_PROFILE.foamSpeed, {
      min: 0,
    }),
    fadeDepth: sanitizePositiveNumber(profile.fadeDepth, DEFAULT_WAVE_PROFILE.fadeDepth, {
      min: 0.01,
    }),
    refractionStrength: sanitizePositiveNumber(
      profile.refractionStrength,
      DEFAULT_WAVE_PROFILE.refractionStrength,
      { min: 0 },
    ),
    edgeFoamBoost: sanitizePositiveNumber(
      profile.edgeFoamBoost,
      DEFAULT_WAVE_PROFILE.edgeFoamBoost,
      { min: 0 },
    ),
  };
}

class HydraWaterPipeline {
  constructor({ THREE, definition = {} }) {
    this.THREE = THREE;
    this.timeScale = 1;
    this.diagnosticAccumulator = 0;
    this.diagnosticInterval = 1.5;
    this.lastValidationSignature = new WeakMap();

    this.uniforms = this.createUniforms(definition);
    this.vertexShader = this.createVertexShader();
    this.fragmentShader = this.createFragmentShader();
    this.material = new THREE.ShaderMaterial({
      name: 'HydraWaterMaterial',
      uniforms: this.uniforms,
      vertexShader: this.vertexShader,
      fragmentShader: this.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
  }

  createUniforms(definition) {
    const THREE = this.THREE;
    const lightDirection = new THREE.Vector3(-0.35, 1, 0.25).normalize();
    const waveProfile = normalizeWaveProfile(definition?.waveProfile ?? {});

    const uniforms = {
      uTime: { value: 0 },
      uPrimaryScale: { value: waveProfile.primaryScale },
      uSecondaryScale: { value: waveProfile.secondaryScale },
      uChoppiness: { value: waveProfile.choppiness },
      uFlowScale: { value: waveProfile.flowScale },
      uFoamSpeed: { value: waveProfile.foamSpeed },
      uFadeDepth: { value: waveProfile.fadeDepth },
      uRefractionStrength: { value: waveProfile.refractionStrength },
      uEdgeFoamBoost: { value: waveProfile.edgeFoamBoost },
      uShallowTint: {
        value: createColor(THREE, definition?.palette?.shallowTint, DEFAULT_COLORS.shallowTint),
      },
      uDeepTint: {
        value: createColor(THREE, definition?.palette?.deepTint, DEFAULT_COLORS.deepTint),
      },
      uFoamColor: {
        value: createColor(THREE, definition?.palette?.foamColor, DEFAULT_COLORS.foamColor),
      },
      uHorizonTint: {
        value: createColor(THREE, definition?.palette?.horizonTint, DEFAULT_COLORS.horizonTint),
      },
      uUnderwaterColor: {
        value: createColor(
          THREE,
          definition?.palette?.underwaterColor,
          DEFAULT_COLORS.underwaterColor,
        ),
      },
      uSurfaceGlintColor: {
        value: createColor(
          THREE,
          definition?.palette?.surfaceGlintColor,
          DEFAULT_COLORS.surfaceGlintColor,
        ),
      },
      uAmbientColor: {
        value: createColor(THREE, definition?.lighting?.ambientColor, DEFAULT_COLORS.ambientColor),
      },
      uLightColor: {
        value: createColor(THREE, definition?.lighting?.lightColor, DEFAULT_COLORS.lightColor),
      },
      uLightDirection: {
        value: (definition?.lighting?.direction instanceof THREE.Vector3
          ? definition.lighting.direction.clone()
          : lightDirection
        ).normalize(),
      },
    };
    return uniforms;
  }

  createVertexShader() {
    return `
    #include <common>
    #include <fog_pars_vertex>

    uniform float uTime;
    uniform float uPrimaryScale;
    uniform float uSecondaryScale;
    uniform float uChoppiness;
    uniform float uFlowScale;
    uniform float uFoamSpeed;
    uniform float uFadeDepth;

    attribute vec3 color;
    attribute float surfaceType;
    attribute vec2 flowDirection;
    attribute float flowStrength;
    attribute float edgeFoam;
    attribute float depth;
    attribute float shoreline;

    varying vec3 vColor;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec2 vFlow;
    varying float vFoamEdge;
    varying float vDepth;
    varying float vShore;
    varying float vSurfaceType;

    varying vec2 vWorldXZ;
    varying float vWaveHeight;
    varying float vCrest;

    vec2 getWaveDirection(int index) {
      if (index == 0) return normalize(vec2(0.85, 0.18));
      if (index == 1) return normalize(vec2(-0.52, 0.9));
      if (index == 2) return normalize(vec2(0.34, -0.94));
      return normalize(vec2(-0.92, -0.38));
    }

    float sampleWaveSet(vec2 uv, vec2 flowDir, float flowStrength) {
      float total = 0.0;
      float weight = 0.0;
      for (int i = 0; i < 4; i++) {
        float t = float(i) / 3.0;
        vec2 dir = getWaveDirection(i);
        float freq = mix(0.35, 1.7, t);
        float speed = mix(0.4, 1.3, t);
        float amplitude = mix(1.0, 0.4, t);
        vec2 advected = uv + flowDir * flowStrength * (0.3 + t * 0.3);
        float phase = dot(dir, advected) * (freq * 6.28318) + uTime * speed;
        total += sin(phase) * amplitude;
        weight += amplitude;
      }
      return total / max(weight, 0.0001);
    }

    float layeredWaves(vec2 uv, vec2 flowDir, float flowStrength) {
      float macro = sampleWaveSet(uv * 0.45, flowDir, flowStrength);
      float mid = sampleWaveSet(uv * 1.15, flowDir, flowStrength * 0.7);
      float detail = sampleWaveSet(uv * 2.4, flowDir, flowStrength * 0.5);
      return macro * 0.85 + mid * 0.55 + detail * 0.25;
    }

    void main() {
      vec3 localPosition = position;
      vec2 flowDir = flowStrength > 0.001 ? normalize(flowDirection) : vec2(0.0);
      float depthFactor = clamp(depth / max(uFadeDepth, 0.0001), 0.05, 1.5);
      vec2 uv = position.xz;

      float waveHeight = layeredWaves(uv, flowDir, flowStrength);
      float displacement = waveHeight * (uPrimaryScale + depthFactor * 0.45);
      displacement += shoreline * uSecondaryScale * 0.9;
      displacement += flowStrength * uSecondaryScale * 0.35;
      localPosition.y += displacement;
      localPosition.xz += flowDir * (flowStrength * uFlowScale) * (0.4 + shoreline * 0.5);

      float eps = 0.35;
      float heightX = layeredWaves(uv + vec2(eps, 0.0), flowDir, flowStrength);
      float heightZ = layeredWaves(uv + vec2(0.0, eps), flowDir, flowStrength);
      float slopeX = (heightX - waveHeight) / eps;
      float slopeZ = (heightZ - waveHeight) / eps;
      float choppy = uChoppiness + depthFactor * 0.3;
      vec3 bentNormal = normalize(vec3(-slopeX * choppy, 1.0, -slopeZ * choppy));
      vNormal = normalMatrix * bentNormal;
      vWaveHeight = waveHeight;
      vCrest = clamp(length(vec2(slopeX, slopeZ)) * 1.4, 0.0, 1.5);

      vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
      vWorldPosition = worldPosition.xyz;
      vColor = color;
      vFlow = flowDir * flowStrength;
      vFoamEdge = edgeFoam;
      vDepth = depth;
      vShore = shoreline;
      vSurfaceType = surfaceType;
      vWorldXZ = worldPosition.xz;

      vec4 mvPosition = viewMatrix * worldPosition;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `;
  }

  createFragmentShader() {
    return `
    #include <common>
    #include <fog_pars_fragment>
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    uniform float uTime;
    uniform float uFadeDepth;
    uniform float uRefractionStrength;
    uniform float uFoamSpeed;
    uniform float uEdgeFoamBoost;
    uniform vec3 uShallowTint;
    uniform vec3 uDeepTint;
    uniform vec3 uFoamColor;
    uniform vec3 uHorizonTint;
    uniform vec3 uUnderwaterColor;
    uniform vec3 uSurfaceGlintColor;
    uniform vec3 uAmbientColor;
    uniform vec3 uLightColor;
    uniform vec3 uLightDirection;

    varying vec3 vColor;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec2 vFlow;
    varying float vFoamEdge;
    varying float vDepth;
    varying float vShore;
    varying float vSurfaceType;
    varying vec2 vWorldXZ;
    varying float vWaveHeight;
    varying float vCrest;

    void main() {
      vec3 normal = normalize(vNormal);
      float depthMix = clamp(vDepth / max(uFadeDepth, 0.0001), 0.0, 1.0);
      float shoreMix = clamp(vShore, 0.0, 1.0);

      float waterfallMask = smoothstep(0.35, 1.0, clamp(vSurfaceType, 0.0, 1.0));

      vec3 shallowTint = mix(vColor, uShallowTint, 0.5);
      vec3 deepTint = mix(vColor, uDeepTint, 0.8);
      vec3 scatterTint = mix(shallowTint, deepTint, depthMix);
      scatterTint = mix(scatterTint, uUnderwaterColor, depthMix * 0.25);
      float horizonInfluence = (1.0 - depthMix) * 0.4;
      scatterTint = mix(scatterTint, uHorizonTint, horizonInfluence * 0.5);

      vec3 lightDir = normalize(uLightDirection);
      float lambert = max(dot(normal, lightDir), 0.0);
      vec3 lighting = uAmbientColor + uLightColor * lambert;

      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
      vec3 reflection = mix(uHorizonTint, uSurfaceGlintColor, clamp(fresnel * 1.2, 0.0, 1.0));
      vec3 base = mix(scatterTint, reflection, clamp(fresnel * 0.75 + 0.15, 0.0, 1.0));
      base *= lighting;

      vec2 foamUv = vWorldXZ * 1.2;
      float foamNoiseA = sin(dot(foamUv, vec2(0.82, 1.73)) + uTime * (uFoamSpeed * 0.8 + length(vFlow))) * 0.5 + 0.5;
      float foamNoiseB = sin(foamUv.x * 2.1 - foamUv.y * 2.4 + uTime * 1.1) * 0.5 + 0.5;
      float crestFoam = smoothstep(0.18, 0.85, vCrest * (1.1 + shoreMix * 0.5));
      float flowFoam = smoothstep(0.1, 0.8, length(vFlow) * 1.4 + vFoamEdge * uEdgeFoamBoost + shoreMix * 0.9);
      float foamMask = clamp(max(crestFoam, flowFoam), 0.0, 1.0);
      foamMask = mix(foamMask, foamMask * foamNoiseA, 0.55);
      foamMask = mix(foamMask, foamMask * foamNoiseB, 0.45);
      foamMask += waterfallMask * 0.35;
      foamMask = clamp(foamMask, 0.0, 1.2);

      vec3 foamColor = uFoamColor * foamMask;

      float waveHighlight = smoothstep(-0.6, 0.9, vWaveHeight);
      base = mix(base, mix(uFoamColor, uHorizonTint, 0.5), waveHighlight * (1.0 - depthMix) * 0.25);
      base = mix(base, uShallowTint, (1.0 - depthMix) * 0.15 + shoreMix * 0.2);
      base += foamColor;
      base += uFoamColor * fresnel * (0.08 + shoreMix * 0.2);

      float alphaBase = clamp(0.6 + depthMix * 0.25, 0.0, 1.0);
      float alpha = clamp(alphaBase + foamMask * 0.25 + waterfallMask * 0.15, 0.0, 1.0);
      gl_FragColor = vec4(base, alpha);

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `;
  }

  applyWaveProfile(profile) {
    const normalized = normalizeWaveProfile(profile);
    this.uniforms.uPrimaryScale.value = normalized.primaryScale;
    this.uniforms.uSecondaryScale.value = normalized.secondaryScale;
    this.uniforms.uChoppiness.value = normalized.choppiness;
    this.uniforms.uFlowScale.value = normalized.flowScale;
    this.uniforms.uFoamSpeed.value = normalized.foamSpeed;
    this.uniforms.uFadeDepth.value = normalized.fadeDepth;
    this.uniforms.uRefractionStrength.value = normalized.refractionStrength;
    this.uniforms.uEdgeFoamBoost.value = normalized.edgeFoamBoost;
  }

  applyEnvironment(environment = {}) {
    const { THREE } = this;
    if (environment.lightDirection) {
      const next = environment.lightDirection instanceof THREE.Vector3
        ? environment.lightDirection.clone()
        : new THREE.Vector3().fromArray(environment.lightDirection);
      if (next.lengthSq() > 0.0001) {
        this.uniforms.uLightDirection.value.copy(next.normalize());
      }
    }
    if (environment.lightColor) {
      this.uniforms.uLightColor.value.copy(
        createColor(THREE, environment.lightColor, DEFAULT_COLORS.lightColor),
      );
    }
    if (environment.ambientColor) {
      this.uniforms.uAmbientColor.value.copy(
        createColor(THREE, environment.ambientColor, DEFAULT_COLORS.ambientColor),
      );
    }
    if (environment.horizonTint) {
      this.uniforms.uHorizonTint.value.copy(
        createColor(THREE, environment.horizonTint, DEFAULT_COLORS.horizonTint),
      );
    }
  }

  applyPalette(palette = {}) {
    const { THREE } = this;
    const applyColor = (uniformKey, value, fallbackKey) => {
      if (value === undefined) {
        return;
      }
      this.uniforms[uniformKey].value.copy(createColor(THREE, value, DEFAULT_COLORS[fallbackKey]));
    };
    applyColor('uShallowTint', palette.shallowTint, 'shallowTint');
    applyColor('uDeepTint', palette.deepTint, 'deepTint');
    applyColor('uFoamColor', palette.foamColor, 'foamColor');
    applyColor('uHorizonTint', palette.horizonTint, 'horizonTint');
    applyColor('uUnderwaterColor', palette.underwaterColor, 'underwaterColor');
    applyColor('uSurfaceGlintColor', palette.surfaceGlintColor, 'surfaceGlintColor');
  }

  setTimeScale(scale) {
    if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0.001) {
      this.timeScale = scale;
    } else {
      console.warn('[hydra] Ignoring invalid time scale value.', scale);
    }
  }

  update(delta, surfaces = new Set()) {
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta <= 0) {
      return;
    }
    const scaledDelta = delta * this.timeScale;
    this.uniforms.uTime.value += scaledDelta;
    if (this.uniforms.uTime.value > 10000) {
      this.uniforms.uTime.value = 0;
    }

    this.diagnosticAccumulator += scaledDelta;
    if (this.diagnosticAccumulator >= this.diagnosticInterval) {
      this.diagnosticAccumulator = 0;
      this.validateSurfaces(surfaces);
    }
  }

  validateSurfaces(surfaces) {
    if (!surfaces || surfaces.size === 0) {
      return;
    }
    surfaces.forEach((mesh) => {
      if (!mesh || !mesh.geometry) {
        return;
      }
      const geometry = mesh.geometry;
      const lastSignature = this.lastValidationSignature.get(geometry);
      const signature = geometry.uuid;
      if (lastSignature === signature) {
        return;
      }
      const requiredAttributes = [
        'position',
        'normal',
        'uv',
        'color',
        'surfaceType',
        'flowDirection',
        'flowStrength',
        'edgeFoam',
        'depth',
        'shoreline',
      ];
      const missing = requiredAttributes.filter((name) => !geometry.getAttribute(name));
      if (missing.length > 0) {
        console.warn(
          '[hydra] Fluid geometry is missing expected attributes. Falling back to debug render.',
          missing,
          mesh,
        );
        return;
      }
      const positionAttribute = geometry.getAttribute('position');
      if (positionAttribute.count === 0) {
        console.warn('[hydra] Fluid geometry contains zero vertices.', mesh);
        return;
      }
      this.lastValidationSignature.set(geometry, signature);
    });
  }
}

export function createHydraWaterMaterial({ THREE, definition }) {
  const pipeline = new HydraWaterPipeline({ THREE, definition });
  if (definition?.waveProfile?.timeScale !== undefined) {
    pipeline.setTimeScale(
      sanitizePositiveNumber(definition.waveProfile.timeScale, 1, { min: 0.001 }),
    );
  }
  if (definition?.palette) {
    pipeline.applyPalette(definition.palette);
  }
  if (definition?.lighting) {
    pipeline.applyEnvironment(definition.lighting);
  }
  return {
    material: pipeline.material,
    update: (delta, surfaces) => pipeline.update(delta, surfaces),
    pipeline,
  };
}
