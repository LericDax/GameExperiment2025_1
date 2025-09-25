import { setBiomeCausticsConfig } from '../../rendering/biome-tint-material.js';


const WATER_VERTEX_SHADER = `
#include <fog_pars_vertex>

attribute float surfaceType;
attribute vec2 flowDirection;
attribute float flowStrength;
attribute float depth;
attribute float shoreline;
attribute float edgeFoam;

#ifdef USE_COLOR
attribute vec3 color;
#endif


uniform float uTime;
uniform float uPrimaryScale;
uniform float uSecondaryScale;
uniform float uWaveAmplitude;
uniform float uChoppiness;
uniform float uFlowRipple;
uniform float uDepthFade;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vDepth;
varying float vSurfaceMask;
varying float vShoreline;
varying float vFoamEdge;
varying vec3 vVertexColor;
varying vec2 vFlowVector;

float sampleWave(vec2 uv) {
  float wave = sin(dot(uv, vec2(0.86, 0.52)) + uTime * 0.85);
  wave += sin(dot(uv, vec2(-0.64, 1.12)) - uTime * 1.1) * 0.7;
  wave += sin(dot(uv * 2.3, vec2(0.34, -1.78)) + uTime * 1.6) * 0.35;
  wave += sin(dot(uv * 3.7, vec2(-1.52, 0.58)) - uTime * 2.2) * 0.2;
  return wave;
}

vec3 computeNormal(vec2 uv) {
  float eps = 0.08;
  float center = sampleWave(uv);
  float offsetX = sampleWave(uv + vec2(eps, 0.0));
  float offsetZ = sampleWave(uv + vec2(0.0, eps));
  vec3 bent = vec3((center - offsetX) / eps, 1.0, (center - offsetZ) / eps);
  bent.xz *= uChoppiness;
  return normalize(bent);

}
`;

const WATER_FRAGMENT_SHADER = `
precision highp float;

#include <fog_pars_fragment>

uniform vec3 shallowColor;
uniform vec3 deepColor;
uniform vec3 surfaceColor;
uniform vec3 foamColor;
uniform float opacity;
uniform vec3 lightDirection;
uniform float specularStrength;
uniform float fresnelStrength;
uniform float fresnelPower;
uniform float time;
uniform sampler2D causticsMap;
uniform vec2 causticsScale;
uniform vec2 causticsOffset;
uniform vec2 causticsHeight;
uniform float causticsIntensity;


void main() {
  vec3 transformed = position;
  vec3 baseNormal = normal;
#ifdef USE_COLOR
  vVertexColor = color;
#else
  vVertexColor = vec3(1.0);
#endif

  float mask = clamp(1.0 - surfaceType, 0.0, 1.0);
  float depthFactor = clamp(depth / max(uDepthFade, 0.0001), 0.1, 1.4);
  vec2 uv = position.xz * uPrimaryScale;
  vec2 flow = flowDirection * (flowStrength * uFlowRipple + 0.08);
  vec2 advectedUv = uv + flow * uTime * 0.35;
  float primary = sampleWave(advectedUv);
  float secondary = sampleWave(position.xz * uSecondaryScale + flow * (uTime * 0.5 + 2.1));
  float displacement = (primary * 0.7 + secondary * 0.3) * uWaveAmplitude * depthFactor;
  transformed.y += displacement * mask;
  transformed.xz += flowDirection * (flowStrength * 0.12) * sin(uTime * 0.6 + primary) * mask;

  vec3 bentNormal = mix(baseNormal, computeNormal(advectedUv), mask);
  vec3 worldNormal = normalize(normalMatrix * bentNormal);

  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);

  vWorldPosition = worldPosition.xyz;
  vNormal = worldNormal;
  vDepth = depth;
  vSurfaceMask = mask;
  vShoreline = shoreline;
  vFoamEdge = edgeFoam;
  vFlowVector = flowDirection * flowStrength;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT_SHADER = `
precision highp float;

#include <fog_pars_fragment>

uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSurfaceColor;
uniform vec3 uUnderwaterColor;
uniform vec3 uFoamColor;
uniform float uOpacity;
uniform float uFresnelStrength;
uniform float uFoamThreshold;
uniform float uFoamIntensity;
uniform float uDepthFade;
uniform float uTime;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vDepth;
varying float vSurfaceMask;
varying float vShoreline;
varying float vFoamEdge;
varying vec3 vVertexColor;
varying vec2 vFlowVector;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float foamNoise(vec2 uv) {
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float depthMix = clamp(vDepth / max(uDepthFade, 0.0001), 0.0, 1.0);
  vec3 depthColor = mix(uShallowColor, uDeepColor, depthMix);
  depthColor = mix(depthColor, vVertexColor, 0.25 * vSurfaceMask);
  depthColor = mix(depthColor, uUnderwaterColor, 0.18 * depthMix);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);
  vec3 fresnelColor = mix(depthColor, uSurfaceColor, fresnel * uFresnelStrength * vSurfaceMask);

  vec2 foamUv = vWorldPosition.xz * 0.35 + vFlowVector * (uTime * 0.5);
  float foamBase = smoothstep(uFoamThreshold, 1.0, vFoamEdge + vShoreline * 0.6);
  float foamDetail = foamNoise(foamUv * 2.4 + uTime * 0.25) * 0.6 +
    foamNoise(foamUv * 4.2 - uTime * 0.18) * 0.4;
  float foamMask = clamp(foamBase * 0.6 + foamDetail * 0.5, 0.0, 1.0) * vSurfaceMask;
  vec3 foamColor = uFoamColor * foamMask * uFoamIntensity;

  vec3 color = fresnelColor + foamColor;
  float alpha = mix(1.0, uOpacity * mix(0.45, 1.0, 1.0 - depthMix), vSurfaceMask);
  gl_FragColor = vec4(color, clamp(alpha, 0.2, 1.0));
  if (gl_FragColor.a <= 0.01) {
    discard;
  }
  #include <fog_fragment>
}
`;

export function createHydraWaterMaterial({ THREE }) {
  if (!THREE) {
    throw new Error('createHydraWaterMaterial requires a THREE instance');
  }

  const uniforms = {
    uTime: { value: 0 },
    uPrimaryScale: { value: 0.18 },
    uSecondaryScale: { value: 0.42 },
    uWaveAmplitude: { value: 0.32 },
    uChoppiness: { value: 0.85 },
    uFlowRipple: { value: 0.45 },
    uDepthFade: { value: 8.0 },
    uShallowColor: { value: new THREE.Color('#55d6ff') },
    uDeepColor: { value: new THREE.Color('#082c5a') },
    uSurfaceColor: { value: new THREE.Color('#7fe6ff') },
    uUnderwaterColor: { value: new THREE.Color('#0b1d37') },
    uFoamColor: { value: new THREE.Color('#e6f8ff') },
    uOpacity: { value: 0.78 },
    uFresnelStrength: { value: 0.55 },
    uFoamThreshold: { value: 0.32 },
    uFoamIntensity: { value: 1.1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    name: 'ThreeJsInspiredWaterMaterial',
  });

  setBiomeCausticsConfig({
    texture: null,
    intensity: 0,
    color: null,
    scale: null,
    offset: null,
    height: null,
  });

  const update = (delta) => {
    uniforms.uTime.value += delta;
    if (uniforms.uTime.value > 1e6) {
      uniforms.uTime.value = 0;

    }

    this.elapsed += delta;
    this.waterUniforms.time.value = this.elapsed;

    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= this.simulationStep && steps < 8) {
      this.stepSimulation();
      this.accumulator -= this.simulationStep;
      steps++;
      this.dropTimer += this.simulationStep;
      if (this.dropTimer >= this.dropInterval) {
        this.addRandomDrop();
        this.dropTimer = 0;
      }
    }

    this.generateCaustics();
    this.waterUniforms.heightTexture.value = this.getHeightTexture();

    this.causticsOffset.x += delta * 0.07;
    this.causticsOffset.y += delta * 0.045;
    this.waterUniforms.causticsOffset.value.copy(this.causticsOffset);

    this.updateWaterHeight(surfaces);
    this.waterUniforms.causticsHeight.value.set(this.waterHeight, this.causticsFade);

    const causticsIntensity = 0.8;
    this.updateBiomeCausticsState(causticsIntensity);
  }
}

let hydraWaterInstance = null;

export function createHydraWaterMaterial({ THREE }) {
  if (!THREE) {
    throw new Error('createHydraWaterMaterial requires a THREE instance');
  }
  if (!hydraWaterInstance) {
    hydraWaterInstance = new HydraWaterCausticsManager({ THREE });
  }
  return {
    material: hydraWaterInstance.materialInstance,
    update: (delta, surfaces, context) => {
      hydraWaterInstance.update({ delta, surfaces, context });
    },
  };

}
