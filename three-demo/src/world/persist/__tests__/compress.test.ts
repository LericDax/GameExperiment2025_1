import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CompressionCodec,
  compress,
  decompress,
  ensureLz4,
} from '../compress.ts';

function repeatByte(value: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  out.fill(value & 0xff);
  return out;
}

test('compress/decompress round-trip with default preference', async () => {
  const payload = repeatByte(42, 2048);
  const result = await compress(payload);
  const restored = await decompress(result.data, result.codec);
  assert.deepEqual(Array.from(restored), Array.from(payload));
});

test('deflate fallback round-trip', async () => {
  const payload = repeatByte(0, 4096);
  const result = await compress(payload, [CompressionCodec.Deflate, CompressionCodec.None]);
  assert.equal(result.codec, CompressionCodec.Deflate);
  const restored = await decompress(result.data, result.codec);
  assert.deepEqual(Array.from(restored), Array.from(payload));
});

test('lz4 codec round-trip when available', async (t) => {
  if (!(await ensureLz4())) {
    t.skip('LZ4 codec unavailable in this environment');
    return;
  }
  const payload = repeatByte(7, 8192);
  const result = await compress(payload, [CompressionCodec.LZ4, CompressionCodec.None]);
  assert.equal(result.codec, CompressionCodec.LZ4);
  const restored = await decompress(result.data, result.codec);
  assert.deepEqual(Array.from(restored), Array.from(payload));
});
