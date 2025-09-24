export function createHydraWaterMaterial({ THREE }) {

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1c6dd9'),
    roughness: 0.08,
    metalness: 0.02,
    transmission: 0.68,
    thickness: 2.1,
    attenuationDistance: 2.75,
    attenuationColor: new THREE.Color('#2ca7ff'),
    transparent: true,
    opacity: 1,
    ior: 1.333,
    reflectivity: 0.52,
    clearcoat: 0.38,
    clearcoatRoughness: 0.15,

    vertexColors: true,
  });

  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  material.envMapIntensity = 0.82;

  const uniforms = {
    uTime: { value: 0 },
    uPrimaryScale: { value: 0.42 },
    uSecondaryScale: { value: 0.18 },
    uChoppiness: { value: 0.55 },
    uFlowScale: { value: 0.16 },
    uFoamSpeed: { value: 1.1 },
    uFadeDepth: { value: 7.5 },
    uRefractionStrength: { value: 0.42 },
    uEdgeFoamBoost: { value: 1.35 },
    uShallowTint: { value: new THREE.Color('#5ddfff') },
    uDeepTint: { value: new THREE.Color('#0a2a63') },
    uFoamColor: { value: new THREE.Color('#c4f4ff') },
    uHorizonTint: { value: new THREE.Color('#7bd4ff') },
    uUnderwaterColor: { value: new THREE.Color('#052946') },
    uSurfaceGlintColor: { value: new THREE.Color('#66e0ff') },

  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;

    shader.uniforms.uPrimaryScale = uniforms.uPrimaryScale;
    shader.uniforms.uSecondaryScale = uniforms.uSecondaryScale;
    shader.uniforms.uChoppiness = uniforms.uChoppiness;
    shader.uniforms.uFlowScale = uniforms.uFlowScale;
    shader.uniforms.uFoamSpeed = uniforms.uFoamSpeed;
    shader.uniforms.uFadeDepth = uniforms.uFadeDepth;
    shader.uniforms.uRefractionStrength = uniforms.uRefractionStrength;
    shader.uniforms.uEdgeFoamBoost = uniforms.uEdgeFoamBoost;
    shader.uniforms.uShallowTint = uniforms.uShallowTint;
    shader.uniforms.uDeepTint = uniforms.uDeepTint;
    shader.uniforms.uFoamColor = uniforms.uFoamColor;
    shader.uniforms.uHorizonTint = uniforms.uHorizonTint;
    shader.uniforms.uUnderwaterColor = uniforms.uUnderwaterColor;
    shader.uniforms.uSurfaceGlintColor = uniforms.uSurfaceGlintColor;

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

uniform float uPrimaryScale;
uniform float uSecondaryScale;
uniform float uChoppiness;
uniform float uFlowScale;
uniform float uFoamSpeed;
uniform float uFadeDepth;

varying float vSurfaceType;
varying vec2 vFlow;
varying float vFoamEdge;
varying float vDepth;
varying float vShore;
varying vec3 vDisplacedNormal;
varying vec3 vHydraWorldPosition;

float sampleHydraWave(vec2 uv, vec2 flowDir, float flowStrength) {
  vec2 advected = uv;
  float time = uTime;
  vec2 flow = flowDir * (flowStrength * 0.85 + 0.12);
  advected += flow * time * 0.45;
  float primary = sin(dot(advected, vec2(0.78, 1.04)) + time * 0.92);
  float cross = sin(dot(advected, vec2(-1.25, 0.64)) - time * 1.18);
  float swirl = sin(dot(advected * 1.37, vec2(1.6, -1.1)) + time * 1.65);
  float micro = sin(dot(advected * 3.4, vec2(0.24, -2.8)) + time * 2.4);
  return primary * 0.7 + cross * 0.55 + swirl * 0.3 + micro * 0.12;
}

vec2 sampleHydraSlope(vec2 uv, vec2 flowDir, float flowStrength) {
  float eps = 0.18;
  float center = sampleHydraWave(uv, flowDir, flowStrength);
  float offsetX = sampleHydraWave(uv + vec2(eps, 0.0), flowDir, flowStrength);
  float offsetZ = sampleHydraWave(uv + vec2(0.0, eps), flowDir, flowStrength);
  return vec2(offsetX - center, offsetZ - center) / eps;

}

        `,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>

vec2 hydraSlope = sampleHydraSlope(position.xz, flowDirection, flowStrength);
float depthAttenuation = clamp(depth / max(uFadeDepth, 0.001), 0.0, 1.0);
float choppy = uChoppiness + depthAttenuation * 0.4;
vec3 bentNormal = normalize(vec3(-hydraSlope.x * choppy, 1.0, -hydraSlope.y * choppy));
objectNormal = bentNormal;
vDisplacedNormal = normalMatrix * bentNormal;


        `,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>

float surfaceMask = clamp(surfaceType, 0.0, 1.0);
float depthFactor = clamp(depth / max(uFadeDepth, 0.0001), 0.1, 1.6);
float wave = sampleHydraWave(position.xz, flowDirection, flowStrength);
float choppyWave = sin(dot(position.xz, vec2(1.3, -0.75)) - uTime * 1.4) * uSecondaryScale;
float crest = sin(dot(position.xz, flowDirection * 1.9) + uTime * 0.82) * flowStrength * (0.6 + shoreline * 0.45);
float waterfallBoost = surfaceMask * (shoreline * 1.2 + flowStrength * 0.6);
float displacement = (wave * uPrimaryScale + choppyWave + crest) * depthFactor + waterfallBoost * uSecondaryScale;
transformed.y += displacement;
transformed.xz += flowDirection * (flowStrength * uFlowScale) * (0.6 + shoreline * 0.4) * sin(uTime * 0.8 + displacement);
vSurfaceType = surfaceMask;
vFlow = flowDirection * flowStrength;
vFoamEdge = edgeFoam;
vDepth = depth;
vShore = shoreline;


        `,
      );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
vHydraWorldPosition = worldPosition.xyz;
`
    );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>

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

varying float vSurfaceType;
varying vec2 vFlow;
varying float vFoamEdge;
varying float vDepth;
varying float vShore;
varying vec3 vDisplacedNormal;
varying vec3 vHydraWorldPosition;

vec3 gHydraTint;
vec3 gFoamColor;
float gHydraDepthMix;
float gHydraShoreMix;

        `,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
normal = normalize(vDisplacedNormal);
geometryNormal = normal;


        `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>

#ifdef USE_COLOR_ALPHA
diffuseColor *= vColor;
#elif defined( USE_COLOR )
diffuseColor.rgb *= vColor;
#endif
float depthMix = clamp(vDepth / max(uFadeDepth, 0.0001), 0.0, 1.0);
float shoreMix = clamp(vShore, 0.0, 1.0);
vec3 shallowTint = mix(diffuseColor.rgb, uShallowTint, 0.6);
vec3 deepTint = mix(diffuseColor.rgb, uDeepTint, 0.85);
vec3 tint = mix(shallowTint, deepTint, depthMix);
float waterfallMask = smoothstep(0.35, 1.0, vSurfaceType);
vec3 horizonBlend = mix(tint, uHorizonTint, 0.35 * (1.0 - depthMix));
diffuseColor.rgb = mix(horizonBlend, tint, depthMix * 0.7);
float altitudeMix = clamp(vHydraWorldPosition.y * 0.02 + 0.5, 0.0, 1.0);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  mix(uHorizonTint, uShallowTint, altitudeMix),
  0.08 * (1.0 - depthMix)
);
float glint = clamp(length(vFlow) * 0.45 + shoreMix * 0.2 + waterfallMask * 0.2, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, uSurfaceGlintColor, glint * 0.25);
float foamNoise = sin(uTime * (uFoamSpeed + length(vFlow) * 0.6) + dot(vFlow, vec2(7.3, -3.1))) * 0.5 + 0.5;
float foamMask = smoothstep(0.15, 0.9, vFoamEdge * uEdgeFoamBoost + shoreMix * 1.35 + waterfallMask * 0.25);
vec3 foamColor = uFoamColor * foamMask * (0.65 + foamNoise * 0.4);
float minAlpha = 0.45;
float maxAlpha = 0.95;
diffuseColor.a = mix(minAlpha, maxAlpha, clamp(depthMix * 0.85 + shoreMix * 0.35, 0.0, 1.0));
gHydraTint = tint;
gFoamColor = foamColor;
gHydraDepthMix = depthMix;
gHydraShoreMix = shoreMix;


        `,
      )
      .replace(
        'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
        `vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
vec3 hydraBaseDiffuse = totalDiffuse;
`
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

outgoingLight += gFoamColor;
vec3 viewDir = normalize(-vViewPosition);
float fresnel = pow(1.0 - max(dot(normalize(vDisplacedNormal), viewDir), 0.0), 3.0);
vec3 refractionTint = mix(uUnderwaterColor, gHydraTint, clamp(0.25 + gHydraDepthMix * 0.75, 0.0, 1.0));
outgoingLight = mix(outgoingLight, refractionTint, uRefractionStrength * (1.0 - gHydraDepthMix));
outgoingLight += uFoamColor * fresnel * (0.08 + gHydraShoreMix * 0.25);

        `,
      );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <transmission_fragment>',
      `#include <transmission_fragment>
#ifdef USE_TRANSMISSION
vec3 refractedTint = mix(transmitted.rgb, gHydraTint, 0.7);
vec3 abyss = mix(uUnderwaterColor, gHydraTint, clamp(gHydraDepthMix * 0.85 + 0.1, 0.0, 1.0));
totalDiffuse = mix(hydraBaseDiffuse, refractedTint, material.transmission);
totalDiffuse += abyss * (0.2 + (1.0 - material.transmission) * 0.4);
#endif

`
    );
  };

  material.customProgramCacheKey = () => 'HydraWaterMaterial_v4';

  const update = (delta) => {
    uniforms.uTime.value += delta;
    if (uniforms.uTime.value > 10000) {

      uniforms.uTime.value = 0;
    }
  };

  return { material, update };
}
