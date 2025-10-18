import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendCrc32,
  crc32,
  decodeRle,
  encodeRle,
  packPalette,
  readCrc32Footer,
  readSignedVarint,
  readVarint,
  sizeOfVarint,
  unpackPalette,
  writeSignedVarint,
  writeVarint,
  zigZagDecode,
  zigZagEncode,
} from '../format.ts';

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

test('zigzag round-trip across int32 range', () => {
  const next = createPrng(0x12345678);
  for (let i = 0; i < 5000; i += 1) {
    const value = (next() << 0) | 0;
    assert.equal(zigZagDecode(zigZagEncode(value)), value);
  }
});

test('varint encoding and decoding matches offsets', () => {
  const next = createPrng(0xabcdef01);
  const buffer = new Uint8Array(10);

  for (let i = 0; i < 2000; i += 1) {
    const value = next() >>> 0;
    const endOffset = writeVarint(value, buffer, 0);
    const { value: decoded, nextOffset } = readVarint(buffer, 0);
    assert.equal(decoded >>> 0, value >>> 0);
    assert.equal(endOffset, nextOffset);
    assert.equal(endOffset, sizeOfVarint(value));
  }
});

test('signed varint works with zigzag conversions', () => {
  const buffer = new Uint8Array(10);
  const next = createPrng(0xf0f0aa55);

  for (let i = 0; i < 2000; i += 1) {
    const value = (next() << 0) | 0;
    const endOffset = writeSignedVarint(value, buffer, 0);
    const { value: decoded, nextOffset } = readSignedVarint(buffer, 0);
    assert.equal(decoded, value);
    assert.equal(endOffset, nextOffset);
  }
});

test('palette packing and unpacking support 1-12 bits', () => {
  const next = createPrng(0x31415926);
  const entryCount = 64;

  for (let bits = 1; bits <= 12; bits += 1) {
    const values = new Uint16Array(entryCount);
    const mask = (1 << bits) - 1;
    for (let i = 0; i < values.length; i += 1) {
      values[i] = next() & mask;
    }
    const packed = packPalette(values, bits);
    const unpacked = unpackPalette(packed, values.length, bits);
    assert.deepEqual(Array.from(unpacked), Array.from(values));
  }
});

test('run-length encoding round-trips through decode', () => {
  const next = createPrng(0xfeed1234);
  const values = new Uint16Array(300);
  let current = next() & 0xffff;
  let runRemaining = (next() % 7) + 1;

  for (let i = 0; i < values.length; i += 1) {
    values[i] = current;
    runRemaining -= 1;
    if (runRemaining === 0) {
      current = next() & 0xffff;
      runRemaining = (next() % 7) + 1;
    }
  }

  const spans = encodeRle(values);
  const decoded = decodeRle(spans);
  assert.deepEqual(Array.from(decoded), Array.from(values));

  const reuseTarget = new Uint16Array(values.length);
  const decodedReuse = decodeRle(spans, reuseTarget);
  assert.strictEqual(decodedReuse, reuseTarget);
  assert.deepEqual(Array.from(decodedReuse), Array.from(values));
});

test('crc32 helper validates known vectors and incremental updates', () => {
  const encoder = new TextEncoder();
  const payload = encoder.encode('123456789');
  assert.equal(crc32(payload), 0xcbf43926);

  const partA = payload.subarray(0, 3);
  const partB = payload.subarray(3);
  const incremental = crc32(partB, crc32(partA));
  assert.equal(incremental, 0xcbf43926);

  const appended = appendCrc32(payload, incremental);
  const { data, crc } = readCrc32Footer(appended);
  assert.equal(crc, incremental);
  assert.deepEqual(Array.from(data), Array.from(payload));
});
