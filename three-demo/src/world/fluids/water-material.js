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
    cameraPosition: { value: new THREE.Vector3() },
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

    void main() {
      vec3 localPosition = position;
      vec2 flowDir = flowStrength > 0.001 ? normalize(flowDirection) : vec2(0.0);
      float depthFactor = clamp(depth / max(uFadeDepth, 0.0001), 0.1, 1.6);
      vec2 uv = position.xz;

      float wave = sampleHydraWave(uv, flowDir, flowStrength);
      float choppyWave = sin(dot(uv, vec2(1.3, -0.75)) - uTime * 1.4) * uSecondaryScale;
      float crest = sin(dot(uv, flowDir * 1.9) + uTime * 0.82) * flowStrength * (0.6 + shoreline * 0.45);
      float waterfallBoost = clamp(surfaceType, 0.0, 1.0) * (shoreline * 1.2 + flowStrength * 0.6);
      float displacement = (wave * uPrimaryScale + choppyWave + crest) * depthFactor + waterfallBoost * uSecondaryScale;
      localPosition.y += displacement;
      localPosition.xz += flowDir * (flowStrength * uFlowScale) * (0.6 + shoreline * 0.4) * sin(uTime * 0.8 + displacement);

      float eps = 0.18;
      float sampleX = sampleHydraWave(uv + vec2(eps, 0.0), flowDir, flowStrength);
      float sampleZ = sampleHydraWave(uv + vec2(0.0, eps), flowDir, flowStrength);
      float choppy = uChoppiness + depthFactor * 0.4;
      vec3 bentNormal = normalize(vec3(-(sampleX - wave) / eps * choppy, 1.0, -(sampleZ - wave) / eps * choppy));
      vNormal = normalMatrix * bentNormal;

      vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
      vWorldPosition = worldPosition.xyz;
      vColor = color;
      vFlow = flowDir * flowStrength;
      vFoamEdge = edgeFoam;
      vDepth = depth;
      vShore = shoreline;
      vSurfaceType = surfaceType;

      vec4 mvPosition = viewMatrix * worldPosition;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `;

  const fragmentShader = `
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

    void main() {
      vec3 normal = normalize(vNormal);
      float depthMix = clamp(vDepth / max(uFadeDepth, 0.0001), 0.0, 1.0);
      float shoreMix = clamp(vShore, 0.0, 1.0);

      vec3 shallowTint = mix(vColor, uShallowTint, 0.6);
      vec3 deepTint = mix(vColor, uDeepTint, 0.85);
      vec3 tint = mix(shallowTint, deepTint, depthMix);
      float waterfallMask = smoothstep(0.35, 1.0, clamp(vSurfaceType, 0.0, 1.0));
      vec3 horizonBlend = mix(tint, uHorizonTint, 0.35 * (1.0 - depthMix));
      tint = mix(horizonBlend, tint, depthMix * 0.7);
      float altitudeMix = clamp(vWorldPosition.y * 0.02 + 0.5, 0.0, 1.0);
      tint = mix(tint, mix(uHorizonTint, uShallowTint, altitudeMix), 0.08 * (1.0 - depthMix));

      float foamNoise = sin(uTime * (uFoamSpeed + length(vFlow) * 0.6) + dot(vFlow, vec2(7.3, -3.1))) * 0.5 + 0.5;
      float foamMask = smoothstep(0.15, 0.9, vFoamEdge * uEdgeFoamBoost + shoreMix * 1.35 + waterfallMask * 0.25);
      vec3 foamColor = uFoamColor * foamMask * (0.65 + foamNoise * 0.4);

      vec3 lightDir = normalize(uLightDirection);
      float lambert = max(dot(normal, lightDir), 0.0);
      vec3 lighting = uAmbientColor + uLightColor * lambert;
      vec3 color = tint * lighting;

      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
      color = mix(color, uSurfaceGlintColor, fresnel * 0.25 + length(vFlow) * 0.1);
      vec3 refractionTint = mix(uUnderwaterColor, tint, clamp(0.25 + depthMix * 0.75, 0.0, 1.0));
      color = mix(color, refractionTint, uRefractionStrength * (1.0 - depthMix));

      color += foamColor;
      color += uFoamColor * fresnel * (0.08 + shoreMix * 0.25);

      float alpha = mix(0.45, 0.95, clamp(depthMix * 0.85 + shoreMix * 0.35, 0.0, 1.0));
      gl_FragColor = vec4(color, alpha);

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
