const MAX_VARINT_BYTES = 5;
const MAX_PALETTE_BITS = 12;

export function zigZagEncode(value: number): number {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}

export function zigZagDecode(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

export function sizeOfVarint(value: number): number {
  let unsigned = value >>> 0;
  let size = 1;
  while (unsigned >= 0x80 && size < MAX_VARINT_BYTES) {
    unsigned >>>= 7;
    size += 1;
  }
  return size;
}

export function writeVarint(value: number, target: Uint8Array, offset = 0): number {
  let unsigned = value >>> 0;
  while (unsigned >= 0x80) {
    target[offset++] = (unsigned & 0x7f) | 0x80;
    unsigned >>>= 7;
  }
  target[offset++] = unsigned & 0x7f;
  return offset;
}

export function writeSignedVarint(value: number, target: Uint8Array, offset = 0): number {
  return writeVarint(zigZagEncode(value), target, offset);
}

export function readVarint(source: Uint8Array, offset = 0): { value: number; nextOffset: number } {
  let shift = 0;
  let result = 0;
  let next = offset;
  while (next < source.length && shift < 35) {
    const byte = source[next++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, nextOffset: next };
    }
    shift += 7;
  }
  throw new RangeError('Malformed varint sequence');
}

export function readSignedVarint(
  source: Uint8Array,
  offset = 0,
): { value: number; nextOffset: number } {
  const { value, nextOffset } = readVarint(source, offset);
  return { value: zigZagDecode(value), nextOffset };
}

export interface RleSpan {
  value: number;
  length: number;
}

export function encodeRle(values: ArrayLike<number>): RleSpan[] {
  const spans: RleSpan[] = [];
  const count = values.length >>> 0;
  if (count === 0) {
    return spans;
  }

  let currentValue = values[0] ?? 0;
  let runLength = 1;

  for (let i = 1; i < count; i += 1) {
    const value = values[i] ?? 0;
    if (value === currentValue && runLength < 0xffffffff) {
      runLength += 1;
      continue;
    }
    spans.push({ value: currentValue, length: runLength });
    currentValue = value;
    runLength = 1;
  }

  spans.push({ value: currentValue, length: runLength });
  return spans;
}

export function decodeRle(spans: Iterable<RleSpan>, target?: Uint16Array): Uint16Array {
  const spanList = Array.isArray(spans) ? spans : Array.from(spans);

  const output = target ?? (() => {
    let totalLength = 0;
    for (const span of spanList) {
      totalLength += span.length >>> 0;
    }
    return new Uint16Array(totalLength);
  })();

  let offset = 0;
  for (const span of spanList) {
    const length = span.length >>> 0;
    const value = span.value & 0xffff;
    for (let i = 0; i < length; i += 1) {
      if (offset >= output.length) {
        throw new RangeError('RLE spans exceed target length');
      }
      output[offset++] = value;
    }
  }

  if (offset !== output.length) {
    throw new RangeError('RLE spans underflow target length');
  }

  return output;
}

export function packPalette(values: ArrayLike<number>, bitsPerEntry: number): Uint8Array {
  if (bitsPerEntry < 1 || bitsPerEntry > MAX_PALETTE_BITS) {
    throw new RangeError('bitsPerEntry must be between 1 and 12');
  }
  const count = values.length >>> 0;
  const totalBits = count * bitsPerEntry;
  const result = new Uint8Array(Math.ceil(totalBits / 8));
  let bitOffset = 0;

  for (let i = 0; i < count; i += 1) {
    const value = values[i] ?? 0;
    if (value < 0 || value >= 1 << bitsPerEntry) {
      throw new RangeError('Palette value out of range');
    }

    let remainingBits = bitsPerEntry;
    let outValue = value;

    while (remainingBits > 0) {
      const byteIndex = bitOffset >> 3;
      const bitIndex = bitOffset & 7;
      const space = Math.min(remainingBits, 8 - bitIndex);
      const mask = (1 << space) - 1;
      result[byteIndex] |= ((outValue & mask) << bitIndex) & 0xff;
      outValue >>>= space;
      remainingBits -= space;
      bitOffset += space;
    }
  }

  return result;
}

export function unpackPalette(
  data: Uint8Array,
  count: number,
  bitsPerEntry: number,
): Uint16Array {
  if (bitsPerEntry < 1 || bitsPerEntry > MAX_PALETTE_BITS) {
    throw new RangeError('bitsPerEntry must be between 1 and 12');
  }
  const result = new Uint16Array(count >>> 0);
  let bitOffset = 0;

  for (let i = 0; i < result.length; i += 1) {
    let value = 0;
    let shift = 0;
    let remainingBits = bitsPerEntry;

    while (remainingBits > 0) {
      const byteIndex = bitOffset >> 3;
      const bitIndex = bitOffset & 7;
      const available = Math.min(remainingBits, 8 - bitIndex);
      const mask = (1 << available) - 1;
      const slice = (data[byteIndex] >> bitIndex) & mask;
      value |= slice << shift;
      bitOffset += available;
      shift += available;
      remainingBits -= available;
    }

    result[i] = value;
  }

  return result;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let crc = index;
  for (let i = 0; i < 8; i += 1) {
    if ((crc & 1) !== 0) {
      crc = (crc >>> 1) ^ 0xedb88320;
    } else {
      crc >>>= 1;
    }
  }
  crcTable[index] = crc >>> 0;
}

export function crc32(bytes: ArrayLike<number>, seed = 0): number {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function appendCrc32(bytes: Uint8Array, crc: number): Uint8Array {
  const result = new Uint8Array(bytes.length + 4);
  result.set(bytes, 0);
  const view = new DataView(result.buffer, result.byteOffset + bytes.length, 4);
  view.setUint32(0, crc >>> 0, true);
  return result;
}

export function readCrc32Footer(buffer: Uint8Array): { data: Uint8Array; crc: number } {
  if (buffer.length < 4) {
    throw new RangeError('Buffer too small for CRC32 footer');
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset + buffer.length - 4, 4);
  const crc = view.getUint32(0, true);
  return { data: buffer.subarray(0, buffer.length - 4), crc };
}
