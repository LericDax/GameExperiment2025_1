export function createDreamcastWaterMaterial({ THREE }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1d90d4'),
    roughness: 0.18,
    metalness: 0.04,
    transmission: 0.72,
    thickness: 1.4,
    transparent: true,
    opacity: 1,
    reflectivity: 0.68,
    clearcoat: 0.45,
    clearcoatRoughness: 0.12,
    ior: 1.33,
    vertexColors: true,
  });

  const uniforms = {
    uTime: { value: 0 },
    uWaveAmplitude: { value: 0.12 },
    uSecondaryWaveAmplitude: { value: 0.06 },
    uWaveFrequency: { value: 2.1 },
    uRippleScale: { value: 1.4 },
    uFlowSpeed: { value: 1.35 },
    uWaterfallTumble: { value: 0.12 },
    uOpacity: { value: 0.72 },
    uWaterfallOpacity: { value: 0.58 },
    uShallowColor: { value: new THREE.Color('#4fdfff') },
    uDeepColor: { value: new THREE.Color('#0b2a6f') },
    uFoamColor: { value: new THREE.Color('#ffffff') },
    uWaterfallColor: { value: new THREE.Color('#3cb7ff') },
    uSpecularBoost: { value: 0.15 },
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
float displacement = (baseWave + crossWave * 0.6 + swirlWave * 0.4 + crest) * uWaveAmplitude * elevationMask;
transformed.y += displacement;
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
vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
vWorldPosition = worldPos.xyz;
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
varying vec3 vWorldPosition;
        `,
      )
      .replace(
        '#include <output_fragment>',
        `vec3 dreamcastPalette = mix(uDeepColor, uShallowColor, clamp(vWorldPosition.y * 0.035 + 0.55, 0.0, 1.0));
vec3 waterfallTint = mix(dreamcastPalette, uWaterfallColor, smoothstep(0.35, 1.0, vSurfaceType));
float foamFactor = smoothstep(0.28, 0.92, vEdgeFoam + vFlowStrength * 0.85);
vec3 foamColor = uFoamColor * foamFactor * mix(0.35, 0.75, vSurfaceType);
vec3 paletteTint = waterfallTint;
diffuseColor.rgb *= paletteTint;
diffuseColor.rgb += foamColor;
vec3 dreamcastLight = normalize(vec3(0.22, 0.94, 0.31));
float sparkle = pow(max(dot(normal, dreamcastLight), 0.0), 18.0) * uSpecularBoost;
diffuseColor.rgb += sparkle;
float opacityMix = mix(uOpacity, uWaterfallOpacity, smoothstep(0.45, 0.95, vSurfaceType));
diffuseColor.a = opacityMix;
gl_FragColor = diffuseColor;
        `,
      );
  };

  material.customProgramCacheKey = () => 'DreamcastWaterMaterial_v1';

  const update = (delta) => {
    uniforms.uTime.value += delta;
  };

  return { material, update };
}
