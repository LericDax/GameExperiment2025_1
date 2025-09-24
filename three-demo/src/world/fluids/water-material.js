export function createHydraWaterMaterial({ THREE }) {
  const lightDirection = new THREE.Vector3(-0.35, 1, 0.25).normalize();

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
    uAmbientColor: { value: new THREE.Color('#2a3f58') },
    uLightColor: { value: new THREE.Color('#ffffff') },
    uLightDirection: { value: lightDirection },

  };

  const vertexShader = `
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

  const fragmentShader = `
    #include <common>
    #include <fog_pars_fragment>

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


  const material = new THREE.ShaderMaterial({
    name: 'HydraWaterMaterial',
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });

  const update = (delta) => {
    uniforms.uTime.value += delta;
    if (uniforms.uTime.value > 10000) {
      uniforms.uTime.value = 0;
    }
  };

  return { material, update };
}
