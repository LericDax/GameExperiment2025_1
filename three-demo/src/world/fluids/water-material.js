export function createDreamcastWaterMaterial({ THREE }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1d90d4'),
    roughness: 0.12,
    metalness: 0.03,
    transmission: 0.58,
    thickness: 1.15,
    attenuationDistance: 1.85,
    attenuationColor: new THREE.Color('#3cb7ff'),
    transparent: true,
    opacity: 1,
    reflectivity: 0.72,
    clearcoat: 0.52,
    clearcoatRoughness: 0.1,
    ior: 1.33,
    vertexColors: true,
  });

  material.side = THREE.DoubleSide;
  material.envMapIntensity = 0.65;

  const uniforms = {
    uTime: { value: 0 },
    uWaveAmplitude: { value: 0.12 },
    uSecondaryWaveAmplitude: { value: 0.06 },
    uWaveFrequency: { value: 2.1 },
    uRippleScale: { value: 1.4 },
    uFlowSpeed: { value: 1.35 },
    uWaterfallTumble: { value: 0.12 },
    uOpacity: { value: 0.78 },
    uWaterfallOpacity: { value: 0.64 },
    uShallowColor: { value: new THREE.Color('#4fdfff') },
    uDeepColor: { value: new THREE.Color('#0b2a6f') },
    uFoamColor: { value: new THREE.Color('#ffffff') },
    uWaterfallColor: { value: new THREE.Color('#3cb7ff') },
    uSpecularBoost: { value: 0.28 },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWaveAmplitude = uniforms.uWaveAmplitude;
    shader.uniforms.uSecondaryWaveAmplitude = uniforms.uSecondaryWaveAmplitude;
    shader.uniforms.uWaveFrequency = uniforms.uWaveFrequency;
    shader.uniforms.uRippleScale = uniforms.uRippleScale;
    shader.uniforms.uFlowSpeed = uniforms.uFlowSpeed;
    shader.uniforms.uWaterfallTumble = uniforms.uWaterfallTumble;
    shader.uniforms.uOpacity = uniforms.uOpacity;
    shader.uniforms.uWaterfallOpacity = uniforms.uWaterfallOpacity;
    shader.uniforms.uShallowColor = uniforms.uShallowColor;
    shader.uniforms.uDeepColor = uniforms.uDeepColor;
    shader.uniforms.uFoamColor = uniforms.uFoamColor;
    shader.uniforms.uWaterfallColor = uniforms.uWaterfallColor;
    shader.uniforms.uSpecularBoost = uniforms.uSpecularBoost;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float surfaceType;
attribute vec2 flowDirection;
attribute float flowStrength;
attribute float edgeFoam;

uniform float uTime;
uniform float uWaveAmplitude;
uniform float uSecondaryWaveAmplitude;
uniform float uWaveFrequency;
uniform float uRippleScale;
uniform float uFlowSpeed;
uniform float uWaterfallTumble;

varying float vSurfaceType;
varying vec2 vFlowDirection;
varying float vFlowStrength;
varying float vEdgeFoam;

varying vec3 vWorldPosition;

        `,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float surfaceMask = clamp(surfaceType, 0.0, 1.0);
float elevationMask = 1.0 - surfaceMask;
float baseWave = sin((position.x + position.z) * uWaveFrequency + uTime * 0.8);
float crossWave = sin((position.x * 0.8 - position.z * 1.3) * (uWaveFrequency * 0.85) - uTime * 1.4);
float swirlWave = sin((position.x * 0.35 + position.z * 0.65) * uRippleScale + uTime * 0.6);
float directional = dot(flowDirection, vec2(position.x, position.z)) * flowStrength;
float crest = max(0.0, directional * 0.6);

float secondary = sin((position.x * 1.6 + position.z * 0.8) * (uWaveFrequency * 0.45) + uTime * 1.6);
float displacementPrimary =
  (baseWave + crossWave * 0.6 + swirlWave * 0.35 + crest) * uWaveAmplitude * elevationMask;
float displacementSecondary = secondary * uSecondaryWaveAmplitude * elevationMask;
transformed.y += displacementPrimary + displacementSecondary;

transformed.xz += flowDirection * flowStrength * 0.08 * elevationMask * sin(uTime * 0.9 + position.y * 0.6);
if (surfaceMask > 0.5) {
  float tumble = sin(uTime * uFlowSpeed + position.y * 2.3) * uWaterfallTumble;
  transformed.x += flowDirection.x * tumble;
  transformed.z += flowDirection.y * tumble;
  transformed.y -= abs(flowStrength) * 0.04;
}
vSurfaceType = surfaceMask;
vFlowDirection = flowDirection;
vFlowStrength = flowStrength;
vEdgeFoam = edgeFoam;

#ifdef USE_TRANSMISSION
vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
vWorldPosition = worldPos.xyz;
#endif

        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uOpacity;
uniform float uWaterfallOpacity;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uFoamColor;
uniform vec3 uWaterfallColor;
uniform float uSpecularBoost;

varying float vSurfaceType;
varying vec2 vFlowDirection;
varying float vFlowStrength;
varying float vEdgeFoam;

vec3 gBiomeColor;
vec3 gWaterfallPalette;
float gSurfaceMix;
vec3 gDreamcastPalette;

        `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float surfaceMix = clamp(vSurfaceType, 0.0, 1.0);
#ifdef USE_TRANSMISSION
gSurfaceMix = surfaceMix;
#endif
#ifdef USE_TRANSMISSION
float dreamcastHeight = clamp(vWorldPosition.y * 0.038 + 0.54, 0.0, 1.0);
#else
float dreamcastHeight = 0.62;
#endif
vec3 biomeColor = diffuseColor.rgb;
vec3 dreamcastPalette = mix(uDeepColor, uShallowColor, dreamcastHeight);
vec3 lagoonPalette = mix(biomeColor, dreamcastPalette, 0.65);
float cataract = smoothstep(0.2, 0.92, surfaceMix);
vec3 waterfallPalette = mix(lagoonPalette, uWaterfallColor, cataract);
float foamHaze = smoothstep(0.15, 0.85, vEdgeFoam + vFlowStrength * 0.5);
vec3 hazePalette = mix(lagoonPalette, waterfallPalette, foamHaze * 0.45);
vec3 fresnelBase = mix(vec3(1.0), hazePalette, 0.35);

gBiomeColor = lagoonPalette;
gWaterfallPalette = waterfallPalette;
gDreamcastPalette = dreamcastPalette;

diffuseColor.rgb = mix(lagoonPalette, waterfallPalette, cataract * 0.35);
diffuseColor.rgb = mix(diffuseColor.rgb, hazePalette, 0.55);
diffuseColor.rgb *= fresnelBase;
        `,
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
float surfaceMix = clamp(vSurfaceType, 0.0, 1.0);
float foamFactor = smoothstep(0.25, 0.95, vEdgeFoam + vFlowStrength * 0.85);
vec3 foam = uFoamColor * foamFactor * mix(0.32, 0.72, surfaceMix);
outgoingLight += foam;
vec3 dreamcastLight = normalize(vec3(0.22, 0.94, 0.31));
float sparkle = pow(max(dot(normalize(normal), dreamcastLight), 0.0), 24.0) * uSpecularBoost;
outgoingLight += sparkle;
vec3 flowNormal = normalize(vec3(vFlowDirection, 0.25));
vec3 dreamcastAzimuth = normalize(vec3(dreamcastLight.x, dreamcastLight.z, dreamcastLight.y));
float ribbonHighlight = max(dot(flowNormal, dreamcastAzimuth), 0.0) * vFlowStrength;
outgoingLight += waterfallPalette * ribbonHighlight * 0.18;
vec3 viewDir = normalize(-vViewPosition);
float fresnel = pow(1.0 - clamp(dot(normalize(normal), viewDir), 0.0, 1.0), 2.6);
vec3 rimShimmer = mix(lagoonPalette, waterfallPalette, cataract);
outgoingLight += rimShimmer * fresnel * 0.65;
vec3 basinIrradiance = mix(lagoonPalette, gDreamcastPalette, 0.45);
outgoingLight = mix(outgoingLight, basinIrradiance, 0.38);
float opacityMix = mix(uOpacity, uWaterfallOpacity, smoothstep(0.35, 0.95, surfaceMix));
float translucency = clamp(1.0 - opacityMix, 0.0, 1.0);
vec3 transmittedBiome = mix(lagoonPalette, waterfallPalette, 0.55);
outgoingLight += transmittedBiome * translucency * 0.36;
diffuseColor.a = mix(opacityMix, 0.94, fresnel * 0.3);
        `,
      );

    shader.fragmentShader = shader.fragmentShader.replace(
      'totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );',
      `vec3 transmissionBiome = mix(transmitted.rgb, gBiomeColor, 0.85);
float waterfallInfluence = smoothstep(0.35, 0.95, gSurfaceMix);
vec3 tintedTransmission = mix(transmissionBiome, gWaterfallPalette, waterfallInfluence * 0.9);
vec3 absorption = mix(gDreamcastPalette, gBiomeColor, 0.35);
totalDiffuse = mix(totalDiffuse, tintedTransmission, material.transmission);
totalDiffuse += absorption * (1.0 - material.transmission) * 0.45;
`,
    );
  };

  material.customProgramCacheKey = () => 'DreamcastWaterMaterial_v3';



  const update = (delta) => {
    uniforms.uTime.value += delta;
  };

  return { material, update };
}
