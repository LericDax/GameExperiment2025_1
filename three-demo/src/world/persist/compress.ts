import { deflateSync, inflateSync } from 'fflate';

export enum CompressionCodec {
  None = 0,
  LZ4 = 1,
  Deflate = 2,
}

export interface CompressionResult {
  codec: CompressionCodec;
  data: Uint8Array;
}

type Lz4Module = {
  compress(data: Uint8Array): Uint8Array;
  decompress(data: Uint8Array): Uint8Array;
};

let lz4Loader: Promise<Lz4Module | null> | null = null;
let lz4Unavailable = false;

async function tryLoadModule(specifier: string): Promise<Lz4Module | null> {
  try {
    const mod: any = await import(specifier);
    const initializer = mod?.default;
    if (typeof initializer === 'function') {
      const initResult = initializer();
      if (initResult && typeof initResult.then === 'function') {
        await initResult;
      }
    }
    const compress = typeof mod.compress === 'function' ? mod.compress.bind(mod) : undefined;
    const decompress = typeof mod.decompress === 'function' ? mod.decompress.bind(mod) : undefined;
    if (compress && decompress) {
      return { compress, decompress } satisfies Lz4Module;
    }
  } catch (error) {
    // Swallow the error so we can fall back to other codecs or implementations.
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      console.warn('[persist] Failed to load', specifier, 'codec module.', error);
    }
  }
  return null;
}

async function loadLz4(): Promise<Lz4Module | null> {
  if (lz4Unavailable) {
    return null;
  }
  if (!lz4Loader) {
    lz4Loader = (async () => {
      const candidates = ['lz4-wasm', 'lz4-wasm/lz4_wasm.js', 'lz4-wasm/lz4_wasm_bg.js'];
      for (const specifier of candidates) {
        const module = await tryLoadModule(specifier);
        if (module) {
          return module;
        }
      }
      lz4Unavailable = true;
      return null;
    })();
  }
  return lz4Loader;
}

const DEFAULT_PREFERENCE = [CompressionCodec.LZ4, CompressionCodec.Deflate, CompressionCodec.None];

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return bytes.length === 0 ? new Uint8Array(0) : bytes.slice();
}

export async function compress(
  data: Uint8Array,
  preference: CompressionCodec[] = DEFAULT_PREFERENCE,
): Promise<CompressionResult> {
  for (const codec of preference) {
    switch (codec) {
      case CompressionCodec.None:
        return { codec, data: cloneBytes(data) };
      case CompressionCodec.LZ4: {
        const module = await loadLz4();
        if (!module) {
          continue;
        }
        const compressed = module.compress(data);
        if (compressed.length < data.length) {
          return { codec, data: compressed }; // prefer smaller payloads
        }
        break;
      }
      case CompressionCodec.Deflate: {
        const compressed = deflateSync(data);
        if (compressed.length < data.length) {
          return { codec, data: compressed };
        }
        break;
      }
      default:
        throw new Error(`Unknown compression codec: ${codec}`);
    }
  }

  return { codec: CompressionCodec.None, data: cloneBytes(data) };
}

export async function decompress(data: Uint8Array, codec: CompressionCodec): Promise<Uint8Array> {
  switch (codec) {
    case CompressionCodec.None:
      return cloneBytes(data);
    case CompressionCodec.LZ4: {
      const module = await loadLz4();
      if (!module) {
        throw new Error('LZ4 codec unavailable');
      }
      return module.decompress(data);
    }
    case CompressionCodec.Deflate:
      return inflateSync(data);
    default:
      throw new Error(`Unknown compression codec: ${codec}`);
  }
}

export async function ensureLz4(): Promise<boolean> {
  const module = await loadLz4();
  return module !== null;
}
