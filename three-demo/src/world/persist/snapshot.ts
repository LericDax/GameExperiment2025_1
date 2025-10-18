import {
  packPalette,
  unpackPalette,
  readVarint,
} from './format.ts';
import {
  applyJournalToGrid,
  decodeJournalOps,
  ChunkJournalState,
} from './journal.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const SNAPSHOT_MAGIC = 0x47454353; // 'GECS'
const SNAPSHOT_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 16;

export interface ChunkSnapshotState extends ChunkJournalState {}

type SnapshotEntity = ChunkSnapshotState['entities'] extends Map<string, infer T> ? T : never;

export interface MergeSnapshotOptions {
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
}

export interface SnapshotMergeResult {
  payload: Uint8Array;
  state: ChunkSnapshotState;
  journalOps: number;
  journalBytes: number;
}

export interface JournalCompactionStats {
  entries: number;
  bytes: number;
}

export interface JournalCompactionThresholds {
  maxOps?: number;
  maxBytes?: number;
}

export const DEFAULT_COMPACTION_THRESHOLDS: Readonly<JournalCompactionThresholds> = {
  maxOps: 2000,
  maxBytes: 128 * 1024,
};

class ByteWriter {
  private readonly bytes: number[] = [];

  writeUint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeVarint(value: number): void {
    let unsigned = value >>> 0;
    while (unsigned >= 0x80) {
      this.bytes.push((unsigned & 0x7f) | 0x80);
      unsigned >>>= 7;
    }
    this.bytes.push(unsigned & 0x7f);
  }

  writeBytesRaw(data: Uint8Array): void {
    for (let i = 0; i < data.length; i += 1) {
      this.bytes.push(data[i]!);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class ByteReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  readUint8(): number {
    if (this.offset >= this.data.length) {
      throw new RangeError('Unexpected end of buffer');
    }
    return this.data[this.offset++]!;
  }

  readVarint(): number {
    const { value, nextOffset } = readVarint(this.data, this.offset);
    this.offset = nextOffset;
    return value >>> 0;
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.data.length) {
      throw new RangeError('Unexpected end of buffer while reading bytes');
    }
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }
}

function encodeMetadata(state: ChunkSnapshotState): Uint8Array {
  const entities = Array.from(state.entities.values()).map((entity) => ({
    id: entity.id,
    type: entity.type,
    position: {
      x: Number.isFinite(entity.position?.x) ? entity.position.x : 0,
      y: Number.isFinite(entity.position?.y) ? entity.position.y : 0,
      z: Number.isFinite(entity.position?.z) ? entity.position.z : 0,
    },
    state: entity.state ?? null,
  }));
  const payload = {
    metadata: state.metadata ?? {},
    entities,
  };
  return TEXT_ENCODER.encode(JSON.stringify(payload));
}

function decodeMetadata(bytes: Uint8Array): {
  metadata: Record<string, unknown>;
  entities: Map<string, SnapshotEntity>;
} {
  if (bytes.length === 0) {
    return { metadata: {}, entities: new Map() };
  }
  const parsed = JSON.parse(TEXT_DECODER.decode(bytes)) as {
    metadata?: Record<string, unknown>;
    entities?: Array<{
      id?: string;
      type?: string;
      position?: { x?: number; y?: number; z?: number };
      state?: unknown;
    }>;
  };
  const metadata = parsed?.metadata && typeof parsed.metadata === 'object' ? { ...parsed.metadata } : {};
  const entities = new Map<string, SnapshotEntity>();
  (parsed?.entities ?? []).forEach((entity) => {
    if (!entity || typeof entity.id !== 'string' || entity.id.length === 0) {
      return;
    }
    const position = entity.position ?? {};
    entities.set(entity.id, {
      id: entity.id,
      type: typeof entity.type === 'string' ? entity.type : '',
      position: {
        x: Number.isFinite(position.x) ? (position.x as number) : 0,
        y: Number.isFinite(position.y) ? (position.y as number) : 0,
        z: Number.isFinite(position.z) ? (position.z as number) : 0,
      },
      state: entity.state ?? null,
    } as SnapshotEntity);
  });
  return { metadata, entities };
}

export function createEmptySnapshotState(
  sizeX = DEFAULT_CHUNK_SIZE,
  sizeY = DEFAULT_CHUNK_SIZE,
  sizeZ = DEFAULT_CHUNK_SIZE,
): ChunkSnapshotState {
  const safeX = Math.max(1, Math.floor(sizeX));
  const safeY = Math.max(1, Math.floor(sizeY));
  const safeZ = Math.max(1, Math.floor(sizeZ));
  const volume = safeX * safeY * safeZ;
  return {
    sizeX: safeX,
    sizeY: safeY,
    sizeZ: safeZ,
    blocks: new Uint16Array(volume),
    metadata: {},
    entities: new Map(),
  } satisfies ChunkSnapshotState;
}

export function encodeSnapshotPayload(state: ChunkSnapshotState): Uint8Array {
  const { sizeX, sizeY, sizeZ } = state;
  const volume = sizeX * sizeY * sizeZ;
  if (state.blocks.length !== volume) {
    throw new RangeError('Snapshot block array does not match chunk dimensions');
  }

  const palette = new Map<number, number>();
  const paletteValues: number[] = [];
  const indices = new Uint16Array(volume);
  for (let i = 0; i < volume; i += 1) {
    const value = state.blocks[i]! & 0xffff;
    let paletteIndex = palette.get(value);
    if (paletteIndex === undefined) {
      paletteIndex = paletteValues.length;
      palette.set(value, paletteIndex);
      paletteValues.push(value);
    }
    indices[i] = paletteIndex;
  }

  if (paletteValues.length === 0) {
    paletteValues.push(0);
  }

  const bitsPerEntry = Math.max(1, Math.ceil(Math.log2(paletteValues.length)));
  const packed = packPalette(indices, bitsPerEntry);
  const metadataBytes = encodeMetadata(state);

  const writer = new ByteWriter();
  writer.writeUint8((SNAPSHOT_MAGIC >>> 24) & 0xff);
  writer.writeUint8((SNAPSHOT_MAGIC >>> 16) & 0xff);
  writer.writeUint8((SNAPSHOT_MAGIC >>> 8) & 0xff);
  writer.writeUint8(SNAPSHOT_MAGIC & 0xff);
  writer.writeUint8(SNAPSHOT_VERSION);
  writer.writeVarint(sizeX);
  writer.writeVarint(sizeY);
  writer.writeVarint(sizeZ);
  writer.writeVarint(bitsPerEntry);
  writer.writeVarint(paletteValues.length);
  paletteValues.forEach((value) => writer.writeVarint(value));
  writer.writeVarint(packed.length);
  writer.writeBytesRaw(packed);
  writer.writeVarint(metadataBytes.length);
  writer.writeBytesRaw(metadataBytes);

  return writer.toUint8Array();
}

export function decodeSnapshotPayload(payload: Uint8Array): ChunkSnapshotState {
  const reader = new ByteReader(payload);
  const magic =
    (reader.readUint8() << 24) |
    (reader.readUint8() << 16) |
    (reader.readUint8() << 8) |
    reader.readUint8();
  if (magic !== SNAPSHOT_MAGIC) {
    throw new Error('Invalid snapshot payload magic');
  }
  const version = reader.readUint8();
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot payload version ${version}`);
  }
  const sizeX = reader.readVarint();
  const sizeY = reader.readVarint();
  const sizeZ = reader.readVarint();
  const bitsPerEntry = reader.readVarint();
  const paletteLength = reader.readVarint();
  const palette = new Uint16Array(paletteLength || 1);
  for (let i = 0; i < palette.length; i += 1) {
    palette[i] = reader.readVarint() & 0xffff;
  }
  const packedLength = reader.readVarint();
  const packed = reader.readBytes(packedLength);
  const metadataLength = reader.readVarint();
  const metadataBytes = reader.readBytes(metadataLength);
  if (reader.remaining !== 0) {
    throw new Error('Snapshot payload contains trailing data');
  }

  const volume = sizeX * sizeY * sizeZ;
  const indices = unpackPalette(packed, volume, bitsPerEntry);
  const blocks = new Uint16Array(volume);
  for (let i = 0; i < volume; i += 1) {
    const paletteIndex = indices[i]!;
    blocks[i] = palette[paletteIndex] ?? 0;
  }

  const { metadata, entities } = decodeMetadata(metadataBytes);

  return {
    sizeX,
    sizeY,
    sizeZ,
    blocks,
    metadata,
    entities,
  } satisfies ChunkSnapshotState;
}

export function mergeSnapshotWithJournals(
  baseSnapshot: Uint8Array | null,
  journalPayloads: Iterable<Uint8Array>,
  options: MergeSnapshotOptions = {},
): SnapshotMergeResult {
  const baseState = baseSnapshot
    ? decodeSnapshotPayload(baseSnapshot)
    : createEmptySnapshotState(options.sizeX, options.sizeY, options.sizeZ);

  let state: ChunkSnapshotState = baseState;
  let totalOps = 0;
  let totalBytes = 0;

  for (const payload of journalPayloads) {
    if (!(payload instanceof Uint8Array)) {
      continue;
    }
    totalBytes += payload.byteLength;
    const ops = decodeJournalOps(payload);
    if (ops.length === 0) {
      continue;
    }
    totalOps += ops.length;
    state = applyJournalToGrid(state, ops);
  }

  const encoded = encodeSnapshotPayload(state);
  return { payload: encoded, state, journalOps: totalOps, journalBytes: totalBytes } satisfies SnapshotMergeResult;
}

export function shouldCompactJournal(
  stats: JournalCompactionStats,
  thresholds: JournalCompactionThresholds = DEFAULT_COMPACTION_THRESHOLDS,
): boolean {
  if (typeof thresholds.maxOps === 'number' && thresholds.maxOps >= 0) {
    if (stats.entries >= thresholds.maxOps) {
      return true;
    }
  }
  if (typeof thresholds.maxBytes === 'number' && thresholds.maxBytes >= 0) {
    if (stats.bytes >= thresholds.maxBytes) {
      return true;
    }
  }
  return false;
}
