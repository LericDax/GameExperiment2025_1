export function createHydraWaterMaterial({ THREE }) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2c8fd7'),
    roughness: 0.34,
    metalness: 0.08,
    transparent: true,
    opacity: 0.92,
    vertexColors: true,
  });

  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.envMapIntensity = 0.65;

  const uniforms = {
    uTime: { value: 0 },
    uWaveScale: { value: 0.32 },
    uDetailScale: { value: 0.55 },
    uChoppiness: { value: 1.25 },
    uFlowPush: { value: 0.42 },
    uRippleFrequency: { value: 2.1 },
    uDepthFade: { value: 0.18 },
    uShallowColor: { value: new THREE.Color('#63dcff') },
    uDeepColor: { value: new THREE.Color('#0a2a55') },
    uFoamColor: { value: new THREE.Color('#d1f7ff') },
    uSkyReflection: { value: new THREE.Color('#9bd9ff') },
    uShoreTint: { value: new THREE.Color('#b2f3ff') },
    uSurfaceOpacity: { value: 0.85 },
    uDepthOpacity: { value: 0.55 },
    uFoamThreshold: { value: 0.35 },
    uFresnelStrength: { value: 0.6 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWaveScale = uniforms.uWaveScale;
    shader.uniforms.uDetailScale = uniforms.uDetailScale;
    shader.uniforms.uChoppiness = uniforms.uChoppiness;
    shader.uniforms.uFlowPush = uniforms.uFlowPush;
    shader.uniforms.uRippleFrequency = uniforms.uRippleFrequency;
    shader.uniforms.uDepthFade = uniforms.uDepthFade;
    shader.uniforms.uShallowColor = uniforms.uShallowColor;
    shader.uniforms.uDeepColor = uniforms.uDeepColor;
    shader.uniforms.uFoamColor = uniforms.uFoamColor;
    shader.uniforms.uSkyReflection = uniforms.uSkyReflection;
    shader.uniforms.uShoreTint = uniforms.uShoreTint;
    shader.uniforms.uSurfaceOpacity = uniforms.uSurfaceOpacity;
    shader.uniforms.uDepthOpacity = uniforms.uDepthOpacity;
    shader.uniforms.uFoamThreshold = uniforms.uFoamThreshold;
    shader.uniforms.uFresnelStrength = uniforms.uFresnelStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float surfaceType;
attribute vec2 flowDirection;
attribute float flowStrength;
attribute float edgeFoam;
attribute float depth;
attribute float shoreline;

uniform float uTime;
uniform float uWaveScale;
uniform float uDetailScale;
uniform float uChoppiness;
uniform float uFlowPush;
uniform float uRippleFrequency;

varying float vSurfaceMask;
varying vec2 vFlow;
varying float vFoamEdge;
varying float vDepthValue;
varying float vShoreline;
varying vec3 vWorldPosition;

float hydraWave(vec2 uv, vec2 flow, float time) {
  float base = sin((uv.x + uv.y) * 0.75 + time * 0.85);
  float cross = sin((uv.x * 0.6 - uv.y * 1.2) * 0.7 - time * 1.35);
  float detail = sin((uv.x * 2.8 + uv.y * 3.1) * (0.8 + uDetailScale) + time * 2.4);
  float swirl = sin((uv.x * 1.9 - uv.y * 1.4) * 0.5 + time * 1.6);
  float band = sin(dot(flow, uv) * uRippleFrequency + time * 1.2);
  return base * 0.6 + cross * 0.4 + detail * 0.25 + swirl * 0.2 + band * 0.35;
}

vec2 hydraSlope(vec2 uv, vec2 flow, float time) {
  float eps = 0.12;
  float center = hydraWave(uv, flow, time);
  float dx = hydraWave(uv + vec2(eps, 0.0), flow, time);
  float dz = hydraWave(uv + vec2(0.0, eps), flow, time);
  return vec2(dx - center, dz - center) / eps;
}

        `,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
float hydraTime = uTime;
vec2 hydraFlow = flowDirection * (flowStrength * 0.85 + 0.12);
vec2 hydraGrad = hydraSlope(position.xz, hydraFlow, hydraTime);
vec3 bentNormal = normalize(vec3(-hydraGrad.x * uChoppiness, 1.0, -hydraGrad.y * uChoppiness));
objectNormal = bentNormal;

        `,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float hydraTime = uTime;
vec2 hydraFlow = flowDirection * (flowStrength * 0.85 + 0.12);
float mask = clamp(surfaceType, 0.0, 1.0);
float wave = hydraWave(position.xz, hydraFlow, hydraTime);
float ripple = sin((position.x * 3.5 + position.z * 2.1) + hydraTime * 3.1) * (uDetailScale * 0.18);
float shorelineBoost = clamp(shoreline, 0.0, 1.0);
float depthInfluence = clamp(depth * 0.15 + 0.45, 0.3, 1.6);
transformed.y += (wave * uWaveScale + ripple) * depthInfluence + shorelineBoost * 0.08;
transformed.xz += hydraFlow * (uFlowPush * 0.6 + shorelineBoost * 0.25) * sin(hydraTime * 0.45 + wave) * mask;
vSurfaceMask = mask;
vFlow = hydraFlow;
vFoamEdge = edgeFoam;
vDepthValue = depth;
vShoreline = shorelineBoost;
vec4 hydraWorld = modelMatrix * vec4(transformed, 1.0);
vWorldPosition = hydraWorld.xyz;

        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uFoamColor;
uniform vec3 uSkyReflection;
uniform vec3 uShoreTint;
uniform float uSurfaceOpacity;
uniform float uDepthOpacity;
uniform float uFoamThreshold;
uniform float uFresnelStrength;
uniform float uDepthFade;

varying float vSurfaceMask;
varying vec2 vFlow;
varying float vFoamEdge;
varying float vDepthValue;
varying float vShoreline;
varying vec3 vWorldPosition;

vec3 gHydraFoam;
float gHydraDepthMix;

        `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float depthMix = clamp(vDepthValue * uDepthFade, 0.0, 1.0);
gHydraDepthMix = depthMix;
vec3 baseTint = mix(uShallowColor, uDeepColor, depthMix);
baseTint = mix(baseTint, uShoreTint, clamp(vShoreline, 0.0, 1.0) * 0.6);
float flowFoam = smoothstep(uFoamThreshold, 1.0, vFoamEdge + length(vFlow) * 0.8 + clamp(vShoreline, 0.0, 1.0));
vec3 foam = uFoamColor * flowFoam;
gHydraFoam = foam;
diffuseColor.rgb = mix(diffuseColor.rgb, baseTint, 0.85);
diffuseColor.rgb += foam * 0.35;
diffuseColor.a = mix(uSurfaceOpacity, uDepthOpacity, depthMix) * clamp(vSurfaceMask * 0.85 + 0.3, 0.0, 1.0);

        `,
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
vec3 viewDir = normalize(-vViewPosition);
float fresnel = pow(1.0 - clamp(dot(normalize(normal), viewDir), 0.0, 1.0), 3.0);
outgoingLight = mix(outgoingLight, uSkyReflection, fresnel * uFresnelStrength);
outgoingLight += gHydraFoam * 0.45;
outgoingLight = mix(outgoingLight, uShoreTint, clamp(gHydraDepthMix * 0.25, 0.0, 1.0) * 0.2);

        `,
      );
  };

  material.customProgramCacheKey = () => 'HydraWaterMaterial_v2';

  const update = (delta) => {
    uniforms.uTime.value += delta;
    if (uniforms.uTime.value > 1000) {
      uniforms.uTime.value = 0;
    }
  };

  return { material, update };
}
