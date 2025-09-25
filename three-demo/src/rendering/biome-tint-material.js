function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

  material.onBeforeCompile = (shader) => {
    shader.uniforms.biomeTintStrength = uniforms.biomeTintStrength;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute vec3 biomeTint;\nvarying vec3 vBiomeTint;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvBiomeTint = biomeTint;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vBiomeTint;\nuniform float biomeTintStrength;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vBiomeTint, biomeTintStrength);`,
    );
  };

  material.customProgramCacheKey = () => `${material.uuid}_biome_tint`;

  return material;
}
