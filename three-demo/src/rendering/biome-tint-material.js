function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const biomeCausticsUniformSets = new Set();
const biomeCausticsState = {
  texture: null,
  intensity: 0,
  color: null,
  scale: null,
  offset: null,
  height: null,
  fallbackTexture: null,
};

let THREERef = null;

function ensureCausticsDefaults(THREE) {
  if (!THREERef && THREE) {
    THREERef = THREE;
  }
  if (!THREERef) {
    return;
  }
  const { DataTexture, RepeatWrapping, Vector2, Color } = THREERef;
  if (!biomeCausticsState.fallbackTexture) {
    const data = new Uint8Array([0, 0, 0, 0]);
    const texture = new DataTexture(data, 1, 1);
    texture.needsUpdate = true;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    biomeCausticsState.fallbackTexture = texture;
  }
  if (!biomeCausticsState.texture) {
    biomeCausticsState.texture = biomeCausticsState.fallbackTexture;
  }
  if (!biomeCausticsState.color) {
    biomeCausticsState.color = new Color(0.95, 0.98, 1);
  }
  if (!biomeCausticsState.scale) {
    biomeCausticsState.scale = new Vector2(0.18, 0.18);
  }
  if (!biomeCausticsState.offset) {
    biomeCausticsState.offset = new Vector2(0, 0);
  }
  if (!biomeCausticsState.height) {
    biomeCausticsState.height = new Vector2(0, 8);
  }
}

function applyCausticsUniforms(uniforms) {
  if (!THREERef) {
    return;
  }
  ensureCausticsDefaults();
  const { texture, intensity, color, scale, offset, height, fallbackTexture } =
    biomeCausticsState;
  if (texture) {
    uniforms.causticsMap.value = texture;
  } else if (fallbackTexture) {
    uniforms.causticsMap.value = fallbackTexture;
  }
  uniforms.causticsIntensity.value = intensity;
  if (color) {
    uniforms.causticsColor.value.copy(color);
  }
  if (scale) {
    uniforms.causticsScale.value.copy(scale);
  }
  if (offset) {
    uniforms.causticsOffset.value.copy(offset);
  }
  if (height) {
    uniforms.causticsHeight.value.copy(height);
  }
}

export function setBiomeCausticsConfig({
  texture,
  intensity,
  color,
  scale,
  offset,
  height,
} = {}) {
  if (texture !== undefined) {
    biomeCausticsState.texture = texture;
  }
  if (intensity !== undefined) {
    biomeCausticsState.intensity = intensity;
  }
  if (color !== undefined) {
    biomeCausticsState.color = color;
  }
  if (scale !== undefined) {
    biomeCausticsState.scale = scale;
  }
  if (offset !== undefined) {
    biomeCausticsState.offset = offset;
  }
  if (height !== undefined) {
    biomeCausticsState.height = height;
  }
  biomeCausticsUniformSets.forEach((uniforms) => {
    applyCausticsUniforms(uniforms);
  });
}

export function createBiomeTintMaterial({
  THREE,
  texture,
  name = 'BiomeTintMaterial',
  tintStrength = 1,
  materialOptions = {},
} = {}) {
  if (!THREE) {
    throw new Error('createBiomeTintMaterial requires a THREE instance');
  }
  if (!texture) {
    throw new Error('createBiomeTintMaterial requires a texture map');
  }

  ensureCausticsDefaults(THREE);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    flatShading: true,
    metalness: 0,
    roughness: 0.85,
    ...materialOptions,
  });

  material.name = name;
  material.defines = material.defines || {};
  material.defines.BIOME_TINT = 1;

  const uniforms = {
    biomeTintStrength: { value: clamp(tintStrength, 0, 1) },
  };

  material.userData.biomeTintUniforms = uniforms;

  const causticsUniforms = {
    causticsMap: {
      value: biomeCausticsState.texture || biomeCausticsState.fallbackTexture,
    },
    causticsIntensity: { value: biomeCausticsState.intensity },
    causticsColor: { value: biomeCausticsState.color.clone() },
    causticsScale: { value: biomeCausticsState.scale.clone() },
    causticsOffset: { value: biomeCausticsState.offset.clone() },
    causticsHeight: { value: biomeCausticsState.height.clone() },
  };

  material.userData.causticsUniforms = causticsUniforms;
  biomeCausticsUniformSets.add(causticsUniforms);
  applyCausticsUniforms(causticsUniforms);

  const originalDispose = material.dispose.bind(material);
  material.dispose = () => {
    biomeCausticsUniformSets.delete(causticsUniforms);
    originalDispose();
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.biomeTintStrength = uniforms.biomeTintStrength;
    shader.uniforms.causticsMap = causticsUniforms.causticsMap;
    shader.uniforms.causticsIntensity = causticsUniforms.causticsIntensity;
    shader.uniforms.causticsColor = causticsUniforms.causticsColor;
    shader.uniforms.causticsScale = causticsUniforms.causticsScale;
    shader.uniforms.causticsOffset = causticsUniforms.causticsOffset;
    shader.uniforms.causticsHeight = causticsUniforms.causticsHeight;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute vec3 biomeTint;\nvarying vec3 vBiomeTint;\nvarying vec3 vWorldPosition;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvBiomeTint = biomeTint;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>\n\tvWorldPosition = worldPosition.xyz;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vBiomeTint;\nvarying vec3 vWorldPosition;\nuniform float biomeTintStrength;\nuniform sampler2D causticsMap;\nuniform vec3 causticsColor;\nuniform float causticsIntensity;\nuniform vec2 causticsScale;\nuniform vec2 causticsOffset;\nuniform vec2 causticsHeight;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vBiomeTint, biomeTintStrength);\n\tif (causticsIntensity > 0.0001) {\n\t  vec2 causticsUv = vWorldPosition.xz * causticsScale + causticsOffset;\n\t  float causticsSample = texture2D(causticsMap, causticsUv).r;\n\t  float heightMask = smoothstep(\n\t    causticsHeight.x + causticsHeight.y,\n\t    causticsHeight.x - causticsHeight.y,\n\t    vWorldPosition.y\n\t  );\n\t  float causticsFactor = causticsSample * heightMask * causticsIntensity;\n\t  diffuseColor.rgb += causticsColor * causticsFactor;\n\t}`,
    );
  };

  material.customProgramCacheKey = () => `${material.uuid}_biome_tint_caustics`;

  return material;
}
