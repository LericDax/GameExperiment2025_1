export function createDreamcastWaterMaterial({ THREE }) {

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1d90d4'),

    roughness: 0.14,
    metalness: 0.03,
    transmission: 0.78,
    thickness: 1.8,
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

  const vertexShader = /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>

    uniform float uTime;
    uniform float uWaveAmplitude;
    uniform float uSecondaryWaveAmplitude;
    uniform float uWaveFrequency;
    uniform float uRippleScale;
    uniform float uFlowSpeed;
    uniform float uWaterfallTumble;

    attribute vec3 color;
    attribute float surfaceType;
    attribute vec2 flowDirection;
    attribute float flowStrength;
    attribute float edgeFoam;

    varying vec3 vColor;
    varying float vSurfaceType;
    varying vec2 vFlowDirection;
    varying float vFlowStrength;
    varying float vEdgeFoam;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      float surfaceMask = clamp(surfaceType, 0.0, 1.0);
      float elevationMask = 1.0 - surfaceMask;

      vec3 displaced = position;
      float baseWave = sin((position.x + position.z) * uWaveFrequency + uTime * 0.8);
      float crossWave = sin((position.x * 0.8 - position.z * 1.3) * (uWaveFrequency * 0.85) - uTime * 1.4);
      float swirlWave = sin((position.x * 0.35 + position.z * 0.65) * uRippleScale + uTime * 0.6);
      float directional = dot(flowDirection, vec2(position.x, position.z)) * flowStrength;
      float crest = max(0.0, directional * 0.6);
      float secondary = sin((position.x * 1.6 + position.z * 0.8) * (uWaveFrequency * 0.45) + uTime * 1.6);
      float displacementPrimary =
        (baseWave + crossWave * 0.6 + swirlWave * 0.35 + crest) * uWaveAmplitude * elevationMask;
      float displacementSecondary = secondary * uSecondaryWaveAmplitude * elevationMask;

      displaced.y += displacementPrimary + displacementSecondary;
      displaced.xz += flowDirection * flowStrength * 0.08 * elevationMask * sin(uTime * 0.9 + position.y * 0.6);

      if (surfaceMask > 0.5) {
        float tumble = sin(uTime * uFlowSpeed + position.y * 2.3) * uWaterfallTumble;
        displaced.x += flowDirection.x * tumble;
        displaced.z += flowDirection.y * tumble;
        displaced.y -= abs(flowStrength) * 0.04;
      }

      vec3 bentNormal = normal;
      bentNormal.xz += flowDirection * flowStrength * 0.1 * elevationMask;
      bentNormal.y += (displacementPrimary + displacementSecondary) * 0.4;

      vColor = color;
      vSurfaceType = surfaceMask;
      vFlowDirection = flowDirection;
      vFlowStrength = flowStrength;
      vEdgeFoam = edgeFoam;

      vec3 worldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;
      vWorldPosition = worldPosition;
      vNormal = normalize(normalMatrix * bentNormal);

      gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      #include <fog_vertex>
    }
  `;

  const fragmentShader = /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>

    uniform float uOpacity;
    uniform float uWaterfallOpacity;
    uniform vec3 uShallowColor;
    uniform vec3 uDeepColor;
    uniform vec3 uFoamColor;
    uniform vec3 uWaterfallColor;
    uniform float uSpecularBoost;

    varying vec3 vColor;
    varying float vSurfaceType;
    varying vec2 vFlowDirection;
    varying float vFlowStrength;
    varying float vEdgeFoam;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);

      float surfaceMix = clamp(vSurfaceType, 0.0, 1.0);
      float dreamcastHeight = clamp(vWorldPosition.y * 0.04 + 0.48, 0.0, 1.0);
      vec3 dreamcastPalette = mix(uDeepColor, uShallowColor, dreamcastHeight);
      vec3 waterfallPalette = mix(
        dreamcastPalette,
        uWaterfallColor,
        smoothstep(0.35, 0.95, surfaceMix)
      );
      vec3 baseColor = mix(vec3(1.0), waterfallPalette, 0.85) * vColor;

      vec3 sunDir = normalize(vec3(0.22, 0.94, 0.31));
      float diffuse = max(dot(normal, sunDir), 0.0);
      vec3 ambient = baseColor * 0.35;
      vec3 litColor = baseColor * (diffuse * 0.85 + 0.2) + ambient;

      vec3 halfVector = normalize(sunDir + viewDir);
      float sparkle = pow(max(dot(normal, halfVector), 0.0), 32.0) * uSpecularBoost;
      vec3 flowNormal = normalize(vec3(vFlowDirection, 0.25));
      vec3 dreamcastAzimuth = normalize(vec3(sunDir.x, sunDir.z, sunDir.y));
      float ribbonHighlight = max(dot(flowNormal, dreamcastAzimuth), 0.0) * vFlowStrength;
      float foamFactor = smoothstep(0.25, 0.95, vEdgeFoam + vFlowStrength * 0.85);
      vec3 foam = uFoamColor * foamFactor * mix(0.32, 0.72, surfaceMix);
      float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);

      vec3 color = litColor;
      color += waterfallPalette * (sparkle + ribbonHighlight * 0.18);
      color += foam;
      color += waterfallPalette * fresnel * 0.2;
      color = clamp(color, 0.0, 1.4);

      float opacityMix = mix(uOpacity, uWaterfallOpacity, smoothstep(0.35, 0.95, surfaceMix));

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), opacityMix);
      #include <fog_fragment>
    }
  `;

  const material = new THREE.ShaderMaterial({
    name: 'DreamcastWaterMaterial',
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
=======

    uSpecularBoost: { value: 0.22 },

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

        `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float surfaceMix = clamp(vSurfaceType, 0.0, 1.0);
#ifdef USE_TRANSMISSION
float dreamcastHeight = clamp(vWorldPosition.y * 0.04 + 0.48, 0.0, 1.0);
#else
float dreamcastHeight = 0.6;
#endif
vec3 dreamcastPalette = mix(uDeepColor, uShallowColor, dreamcastHeight);
vec3 waterfallPalette = mix(dreamcastPalette, uWaterfallColor, smoothstep(0.35, 0.95, surfaceMix));
diffuseColor.rgb *= mix(vec3(1.0), waterfallPalette, 0.85);
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
float opacityMix = mix(uOpacity, uWaterfallOpacity, smoothstep(0.35, 0.95, surfaceMix));
diffuseColor.a = opacityMix;
        `,
      );
  };

  material.customProgramCacheKey = () => 'DreamcastWaterMaterial_v2';



  const update = (delta) => {
    uniforms.uTime.value += delta;
  };

  return { material, update };
}
