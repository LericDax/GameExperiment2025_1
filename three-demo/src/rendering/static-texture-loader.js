const hasImportMetaGlob = typeof import.meta?.glob === 'function';

const STATIC_TEXTURE_URLS = hasImportMetaGlob
  ? import.meta.glob(
      '../textures/nonprocedural/**/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP,avif,AVIF,gif,GIF}',
      { eager: true, import: 'default', query: '?url' },
    )
  : {};

const textureCache = new WeakMap();

function parseTextureKey(filePath) {
  const filename = filePath.split('/').pop();
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  const match = nameWithoutExt.match(/^(.*?)(?:@(\d+))?$/);
  const baseName = match ? match[1] : nameWithoutExt;
  const variantSize = match && match[2] ? Number.parseInt(match[2], 10) : Number.MAX_SAFE_INTEGER;
  return { baseName, variantSize };
}

function normalizeTexture(texture, { THREE, key }) {
  texture.name = key;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.flipY = false;
  if ('colorSpace' in texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if ('encoding' in texture) {
    texture.encoding = THREE.sRGBEncoding;
  }
  texture.needsUpdate = true;
  return texture;
}

export function loadStaticTextureMap({ THREE } = {}) {
  if (!THREE) {
    throw new Error('loadStaticTextureMap requires a THREE instance');
  }

  if (textureCache.has(THREE)) {
    return textureCache.get(THREE);
  }

  const loader = new THREE.TextureLoader();
  const entries = Object.entries(STATIC_TEXTURE_URLS);
  const staged = new Map();

  for (const [path, url] of entries) {
    if (!url) continue;
    const { baseName, variantSize } = parseTextureKey(path);
    const existing = staged.get(baseName);
    if (existing && existing.variantSize >= variantSize) {
      continue;
    }

    const texture = normalizeTexture(loader.load(url), { THREE, key: baseName });
    staged.set(baseName, { texture, variantSize });
  }

  const result = {};
  for (const [key, { texture }] of staged.entries()) {
    result[key] = texture;
  }

  textureCache.set(THREE, result);
  return result;
}
