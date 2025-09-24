import { setBiomeCausticsConfig } from '../../rendering/biome-tint-material.js';

const SIMULATION_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xyz, 1.0);
}
`;

const SIMULATION_DROP_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

uniform sampler2D texture;
uniform vec2 center;
uniform float radius;
uniform float strength;
varying vec2 vUv;

void main() {
  vec4 info = texture2D(texture, vUv);
  float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - vUv) / radius);
  drop = 0.5 - cos(drop * 3.141592653589793) * 0.5;
  info.r += drop * strength;
  gl_FragColor = info;
}
`;

const SIMULATION_UPDATE_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

uniform sampler2D texture;
uniform vec2 delta;
varying vec2 vUv;

void main() {
  vec4 info = texture2D(texture, vUv);
  vec2 dx = vec2(delta.x, 0.0);
  vec2 dy = vec2(0.0, delta.y);
  float average = (
    texture2D(texture, vUv - dx).r +
    texture2D(texture, vUv - dy).r +
    texture2D(texture, vUv + dx).r +
    texture2D(texture, vUv + dy).r
  ) * 0.25;
  info.g += (average - info.r) * 2.0;
  info.g *= 0.995;
  info.r += info.g;
  vec3 ddx = vec3(delta.x, texture2D(texture, vec2(vUv.x + delta.x, vUv.y)).r - info.r, 0.0);
  vec3 ddy = vec3(0.0, texture2D(texture, vec2(vUv.x, vUv.y + delta.y)).r - info.r, delta.y);
  info.ba = normalize(cross(ddy, ddx)).xz;
  gl_FragColor = info;
}
`;

const CAUSTICS_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const CAUSTICS_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

uniform sampler2D water;
uniform vec2 texelSize;
uniform float strength;
varying vec2 vUv;

void main() {
  float center = texture2D(water, vUv).r;
  float sampleRight = texture2D(water, vUv + vec2(texelSize.x, 0.0)).r;
  float sampleLeft = texture2D(water, vUv - vec2(texelSize.x, 0.0)).r;
  float sampleUp = texture2D(water, vUv + vec2(0.0, texelSize.y)).r;
  float sampleDown = texture2D(water, vUv - vec2(0.0, texelSize.y)).r;
  vec2 gradient = vec2(sampleRight - sampleLeft, sampleUp - sampleDown);
  float focus = max(0.0, 1.0 - dot(gradient, gradient) * strength);
  focus = pow(focus, 4.0);
  gl_FragColor = vec4(vec3(focus), 1.0);
}
`;

const WATER_VERTEX_SHADER = `
#include <fog_pars_vertex>

attribute float surfaceType;
attribute vec2 flowDirection;
attribute float flowStrength;
attribute float edgeFoam;
attribute float depth;
attribute float shoreline;

#ifdef USE_COLOR
attribute vec3 color;
#endif

uniform sampler2D heightTexture;
uniform vec2 heightmapScale;
uniform float displacementScale;
uniform float secondaryWaveScale;
uniform float flowWaveStrength;
uniform float time;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec3 vViewDirection;
varying float vSurfaceMask;
varying vec2 vFlow;
varying float vFoamEdge;
varying float vDepth;
varying float vShoreline;
varying vec3 vVertexColor;

void main() {
  vec3 transformedPosition = position;
  vec3 baseNormal = normal;
#ifdef USE_COLOR
  vVertexColor = color;
#else
  vVertexColor = vec3(1.0);
#endif

  float mask = 1.0 - clamp(surfaceType, 0.0, 1.0);
  vec2 sampleUv = position.xz * heightmapScale;
  vec4 info = texture2D(heightTexture, sampleUv);
  float height = info.r * displacementScale;
  float secondaryWave = sin(dot(position.xz, vec2(0.74, -0.61)) + time * 0.9) * secondaryWaveScale;
  float flowWave = sin(time * 1.6 + dot(position.xz, flowDirection * 2.2)) * flowWaveStrength;
  transformedPosition.y += mask * (height + secondaryWave + flowWave);

  vec2 drift = flowDirection * flowStrength * (0.05 + flowWaveStrength * 1.5) *
    sin(time * 0.6 + position.x * 0.5 + position.z * 0.35);
  transformedPosition.xz += drift * mask;

  vec3 simNormal = normalize(vec3(
    info.b,
    sqrt(max(0.0, 1.0 - dot(info.ba, info.ba))),
    info.a
  ));
  vec3 blendedNormal = normalize(mix(baseNormal, simNormal, mask));
  vec3 worldNormal = normalize(normalMatrix * blendedNormal);

  vec4 worldPosition = modelMatrix * vec4(transformedPosition, 1.0);

  vWorldPosition = worldPosition.xyz;
  vNormal = worldNormal;
  vViewDirection = cameraPosition - worldPosition.xyz;
  vSurfaceMask = mask;
  vFlow = flowDirection * flowStrength;
  vFoamEdge = edgeFoam;
  vDepth = depth;
  vShoreline = shoreline;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  #include <fog_vertex>
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

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec3 vViewDirection;
varying float vSurfaceMask;
varying vec2 vFlow;
varying float vFoamEdge;
varying float vDepth;
varying float vShoreline;
varying vec3 vVertexColor;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewDirection);

  float depthMix = clamp(vDepth / 6.0, 0.0, 1.0);
  vec3 shallowTint = mix(shallowColor, surfaceColor, 0.35);
  vec3 baseColor = mix(shallowTint, deepColor, depthMix);
  baseColor *= mix(vec3(1.0), vVertexColor, 0.25 * vSurfaceMask);

  float foamNoise = sin(time * 1.4 + dot(vWorldPosition.xz, vFlow * 6.0)) * 0.5 + 0.5;
  float foamMask = smoothstep(0.2, 0.92, vFoamEdge * 0.85 + vShoreline * 0.7 + foamNoise * 0.25);
  vec3 foam = foamColor * foamMask * vSurfaceMask;

  vec3 lightDir = normalize(lightDirection);
  float diffuse = clamp(dot(normal, -lightDir), 0.0, 1.0);
  vec3 lighting = baseColor * (0.45 + diffuse * 0.6);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), fresnelPower);
  lighting = mix(lighting, surfaceColor, fresnel * fresnelStrength * vSurfaceMask);

  float specular = pow(max(dot(reflect(lightDir, normal), viewDir), 0.0), 24.0);
  lighting += specular * specularStrength * vSurfaceMask;

  if (causticsIntensity > 0.0001) {
    vec2 causticsUv = vWorldPosition.xz * causticsScale + causticsOffset;
    float causticSample = texture2D(causticsMap, causticsUv).r;
    float heightMask = smoothstep(
      causticsHeight.x + causticsHeight.y,
      causticsHeight.x - causticsHeight.y,
      vWorldPosition.y
    );
    float causticsFactor = causticSample * heightMask * causticsIntensity;
    lighting += shallowColor * causticsFactor * 0.6;
  }

  lighting += foam;

  float finalOpacity = opacity * mix(0.45, 1.0, 1.0 - depthMix) * vSurfaceMask +
    (1.0 - vSurfaceMask);

  gl_FragColor = vec4(lighting, clamp(finalOpacity, 0.05, 1.0));
  if (gl_FragColor.a <= 0.01) {
    discard;
  }
  #include <fog_fragment>
}
`;

class HydraWaterCausticsManager {
  constructor({ THREE }) {
    this.THREE = THREE;
    this.size = 256;
    this.renderer = null;
    this.sunDirection = new THREE.Vector3(-0.35, -1, -0.25).normalize();
    this.simulationStep = 1 / 60;
    this.accumulator = 0;
    this.elapsed = 0;
    this.dropTimer = 0;
    this.dropInterval = 0.9;
    this.causticsFade = 6;
    this.waterHeight = 0;
    this.tempVector = new THREE.Vector3();
    this.causticsOffset = new THREE.Vector2(0, 0);
    this.causticsScale = new THREE.Vector2(0.12, 0.12);
    this.causticsColor = new THREE.Color('#9deaff');

    const targetOptions = {
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this.targets = [
      new THREE.WebGLRenderTarget(this.size, this.size, targetOptions),
      new THREE.WebGLRenderTarget(this.size, this.size, targetOptions),
    ];
    this.currentTargetIndex = 0;

    this.simulationScene = new THREE.Scene();
    this.simulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);

    this.updateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        texture: { value: null },
        delta: { value: new THREE.Vector2(1 / this.size, 1 / this.size) },
      },
      vertexShader: SIMULATION_VERTEX_SHADER,
      fragmentShader: SIMULATION_UPDATE_FRAGMENT_SHADER,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NoBlending,
    });

    this.dropMaterial = new THREE.ShaderMaterial({
      uniforms: {
        texture: { value: null },
        center: { value: new THREE.Vector2(0, 0) },
        radius: { value: 0.05 },
        strength: { value: 0.35 },
      },
      vertexShader: SIMULATION_VERTEX_SHADER,
      fragmentShader: SIMULATION_DROP_FRAGMENT_SHADER,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NoBlending,
    });

    this.simulationMesh = new THREE.Mesh(this.quadGeometry, this.updateMaterial);
    this.simulationMesh.frustumCulled = false;
    this.simulationScene.add(this.simulationMesh);

    this.causticsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        water: { value: this.getHeightTexture() },
        texelSize: { value: new THREE.Vector2(1 / this.size, 1 / this.size) },
        strength: { value: 3.2 },
      },
      vertexShader: CAUSTICS_VERTEX_SHADER,
      fragmentShader: CAUSTICS_FRAGMENT_SHADER,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NoBlending,
    });

    this.causticsMesh = new THREE.Mesh(this.quadGeometry, this.causticsMaterial);
    this.causticsMesh.frustumCulled = false;

    this.causticsScene = new THREE.Scene();
    this.causticsScene.add(this.causticsMesh);

    this.causticsTarget = new THREE.WebGLRenderTarget(this.size, this.size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.waterUniforms = {
      time: { value: 0 },
      heightTexture: { value: this.getHeightTexture() },
      heightmapScale: { value: new THREE.Vector2(0.065, 0.065) },
      displacementScale: { value: 0.55 },
      secondaryWaveScale: { value: 0.1 },
      flowWaveStrength: { value: 0.07 },
      lightDirection: { value: this.sunDirection.clone() },
      shallowColor: { value: new THREE.Color('#3ad6ff') },
      deepColor: { value: new THREE.Color('#071c3c') },
      surfaceColor: { value: new THREE.Color('#7be8ff') },
      foamColor: { value: new THREE.Color('#eefcff') },
      opacity: { value: 0.86 },
      specularStrength: { value: 0.55 },
      fresnelStrength: { value: 0.22 },
      fresnelPower: { value: 3.2 },
      causticsMap: { value: this.causticsTarget.texture },
      causticsScale: { value: this.causticsScale.clone() },
      causticsOffset: { value: this.causticsOffset.clone() },
      causticsHeight: { value: new THREE.Vector2(this.waterHeight, this.causticsFade) },
      causticsIntensity: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.material.name = 'HydraWaterCausticsMaterial';
    this.material.customProgramCacheKey = () => 'HydraWaterCaustics_v1';
    this.material.vertexColors = true;

    setBiomeCausticsConfig({
      texture: this.causticsTarget.texture,
      intensity: 0,
      color: this.causticsColor,
      scale: this.waterUniforms.causticsScale.value,
      offset: this.waterUniforms.causticsOffset.value,
      height: this.waterUniforms.causticsHeight.value,
    });
  }

  get materialInstance() {
    return this.material;
  }

  getHeightTexture() {
    return this.targets[this.currentTargetIndex].texture;
  }

  renderSimulationPass(material) {
    if (!this.renderer) {
      return;
    }
    const renderer = this.renderer;
    const source = this.targets[this.currentTargetIndex];
    const destination = this.targets[1 - this.currentTargetIndex];
    if (material.uniforms.texture) {
      material.uniforms.texture.value = source.texture;
    }
    this.simulationMesh.material = material;
    renderer.setRenderTarget(destination);
    renderer.render(this.simulationScene, this.simulationCamera);
    renderer.setRenderTarget(null);
    this.currentTargetIndex = 1 - this.currentTargetIndex;
    this.simulationMesh.material = this.updateMaterial;
  }

  stepSimulation() {
    this.renderSimulationPass(this.updateMaterial);
  }

  addRandomDrop() {
    const center = this.dropMaterial.uniforms.center.value;
    center.set(Math.random() * 2 - 1, Math.random() * 2 - 1);
    this.dropMaterial.uniforms.radius.value = 0.03 + Math.random() * 0.08;
    const strength = (Math.random() * 0.35 + 0.15) * (Math.random() > 0.55 ? -1 : 1);
    this.dropMaterial.uniforms.strength.value = strength;
    this.renderSimulationPass(this.dropMaterial);
  }

  generateCaustics() {
    if (!this.renderer) {
      return;
    }
    this.causticsMaterial.uniforms.water.value = this.getHeightTexture();
    const renderer = this.renderer;
    renderer.setRenderTarget(this.causticsTarget);
    renderer.render(this.causticsScene, this.simulationCamera);
    renderer.setRenderTarget(null);
  }

  updateWaterHeight(surfaces) {
    if (!surfaces || surfaces.size === 0) {
      return;
    }
    for (const mesh of surfaces) {
      const positionAttr = mesh.geometry?.getAttribute('position');
      const surfaceAttr = mesh.geometry?.getAttribute('surfaceType');
      if (!positionAttr || !surfaceAttr) {
        continue;
      }
      mesh.updateMatrixWorld(true);
      let total = 0;
      let samples = 0;
      for (let i = 0; i < positionAttr.count; i++) {
        if (surfaceAttr.getX(i) > 0.5) {
          continue;
        }
        this.tempVector.fromBufferAttribute(positionAttr, i);
        this.tempVector.applyMatrix4(mesh.matrixWorld);
        total += this.tempVector.y;
        samples++;
        if (samples >= 80) {
          break;
        }
      }
      if (samples > 0) {
        this.waterHeight = total / samples;
        return;
      }
    }
  }

  updateBiomeCausticsState(intensity) {
    this.waterUniforms.causticsIntensity.value = intensity;
    setBiomeCausticsConfig({
      texture: this.causticsTarget.texture,
      intensity,
      color: this.causticsColor,
      scale: this.waterUniforms.causticsScale.value,
      offset: this.waterUniforms.causticsOffset.value,
      height: this.waterUniforms.causticsHeight.value,
    });
  }

  update({ delta, surfaces, context }) {
    if (!surfaces || surfaces.size === 0) {
      this.updateBiomeCausticsState(0);
      return;
    }

    if (context?.renderer) {
      this.renderer = context.renderer;
    }
    if (!this.renderer) {
      return;
    }

    if (context?.sun && typeof context.sun.getWorldDirection === 'function') {
      context.sun.getWorldDirection(this.sunDirection).normalize();
      this.waterUniforms.lightDirection.value.copy(this.sunDirection);
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
