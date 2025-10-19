import { readVarint, sizeOfVarint, writeVarint } from './format.ts';

const MAGIC = 'GEA1';
const HEADER_SIZE = 4 + 2 + 2 + 16 + 2;
const DEFAULT_VERSION = 1;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export interface PersistedEntityRecord {
  id: string;
  typeId: string;
  transform: Float32Array;
  meta: unknown;
}

export type EntityDelta =
  | { kind: 'place'; record: PersistedEntityRecord }
  | { kind: 'remove'; id: string };

export interface EntitiesLogStats {
  entries: number;
  bytes: number;
}

export interface EntitiesRegionOptions {
  version?: number;
  regionSize: number;
  worldUuid: string;
  schemaVersion: number;
}

export type EntitiesRegionRoot = string | FileSystemDirectoryHandle;

interface RegionHeader {
  version: number;
  regionSize: number;
  worldUuid: string;
  schemaVersion: number;
}

interface ChunkState {
  snapshot: PersistedEntityRecord[];
  deltas: EntityDelta[];
  logStats: EntitiesLogStats;
}

export interface EntitiesRegion {
  rx: number;
  rz: number;
  header: RegionHeader;
  file: RegionFileHandle;
  chunks: Map<number, ChunkState>;
}

interface LoadedChunkEntities {
  snapshot: PersistedEntityRecord[];
  deltas: EntityDelta[];
  logStats: EntitiesLogStats;
}

interface ChunkTableEntry {
  index: number;
  snapshotOffset: number;
  snapshotLength: number;
  logOffset: number;
  logLength: number;
}

interface RegionFileHandle {
  read(): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
}

interface EnsureRegionCacheOptions extends EntitiesRegionOptions {
  maxOpenRegions?: number;
}

export interface EntitiesRegionCache {
  get(rx: number, rz: number): Promise<EntitiesRegion>;
  delete(rx: number, rz: number): void;
  clear(): void;
}

export async function openEntitiesRegion(
  root: EntitiesRegionRoot,
  rx: number,
  rz: number,
  options: EntitiesRegionOptions,
): Promise<EntitiesRegion> {
  const file = await ensureRegionFile(root, rx, rz);
  const data = await file.read();
  const header = createHeaderFromOptions(options);
  const region: EntitiesRegion = {
    rx,
    rz,
    header,
    file,
    chunks: new Map(),
  };

  if (data.length === 0) {
    await writeRegion(region);
    return region;
  }

  const parsedHeader = parseHeader(data);
  validateHeader(parsedHeader, options);
  region.header = parsedHeader;
  parseRegionBody(region, data);
  return region;
}

export function loadChunkEntities(
  region: EntitiesRegion,
  chunk: number | { cx: number; cz: number },
): LoadedChunkEntities {
  const chunkIndex = resolveChunkIndex(region, chunk);
  const state = region.chunks.get(chunkIndex);
  if (!state) {
    return {
      snapshot: [],
      deltas: [],
      logStats: { entries: 0, bytes: 0 },
    } satisfies LoadedChunkEntities;
  }

  return {
    snapshot: state.snapshot.map(cloneRecord),
    deltas: state.deltas.map(cloneDelta),
    logStats: { ...state.logStats },
  } satisfies LoadedChunkEntities;
}

export async function appendEntityDeltas(
  region: EntitiesRegion,
  chunk: number | { cx: number; cz: number },
  deltas: EntityDelta[],
): Promise<EntitiesLogStats> {
  if (deltas.length === 0) {
    return loadChunkEntities(region, chunk).logStats;
  }

  const chunkIndex = resolveChunkIndex(region, chunk);
  const state = ensureChunkState(region, chunkIndex);
  const normalized = deltas.map(normalizeDelta);
  const appendedBytes = encodeDeltas(normalized).length;

  for (const delta of normalized) {
    state.deltas.push(delta);
  }

  state.logStats = {
    entries: state.deltas.length,
    bytes: state.logStats.bytes + appendedBytes,
  };

  await writeRegion(region);
  return { ...state.logStats };
}

export async function compactChunkEntities(
  region: EntitiesRegion,
  chunk: number | { cx: number; cz: number },
  snapshot: PersistedEntityRecord[],
  deltas: EntityDelta[] = [],
): Promise<void> {
  const chunkIndex = resolveChunkIndex(region, chunk);
  const normalizedSnapshot = snapshot.map(normalizeRecord);
  const normalizedDeltas = deltas.map(normalizeDelta);

  const state = ensureChunkState(region, chunkIndex);
  state.snapshot = normalizedSnapshot;
  state.deltas = normalizedDeltas;
  state.logStats = {
    entries: normalizedDeltas.length,
    bytes: encodeDeltas(normalizedDeltas).length,
  };

  await writeRegion(region);
}

export async function removeChunkEntities(
  region: EntitiesRegion,
  chunk: number | { cx: number; cz: number },
): Promise<void> {
  const chunkIndex = resolveChunkIndex(region, chunk);
  if (!region.chunks.delete(chunkIndex)) {
    return;
  }
  await writeRegion(region);
}

export async function ensureRegionFile(
  root: EntitiesRegionRoot,
  rx: number,
  rz: number,
): Promise<RegionFileHandle> {
  const filename = createRegionFilename(rx, rz);
  if (typeof root === 'string') {
    return ensureNodeRegionFile(root, filename);
  }
  return ensureOpfsRegionFile(root, filename);
}

export function ensureEntityRegionCache(
  root: EntitiesRegionRoot,
  options: EnsureRegionCacheOptions,
): EntitiesRegionCache {
  const cache = new Map<string, EntitiesRegion>();
  const pending = new Map<string, Promise<EntitiesRegion>>();
  const limit = Math.max(1, options.maxOpenRegions ?? 8);

  function key(rx: number, rz: number): string {
    return `${rx}:${rz}`;
  }

  async function get(rx: number, rz: number): Promise<EntitiesRegion> {
    const cacheKey = key(rx, rz);
    const existing = cache.get(cacheKey);
    if (existing) {
      cache.delete(cacheKey);
      cache.set(cacheKey, existing);
      return existing;
    }

    const inflight = pending.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const openPromise = openEntitiesRegion(root, rx, rz, options)
      .then((region) => {
        pending.delete(cacheKey);
        cache.set(cacheKey, region);
        enforceLimit();
        return region;
      })
      .catch((error) => {
        pending.delete(cacheKey);
        throw error;
      });

    pending.set(cacheKey, openPromise);
    return openPromise;
  }

  function del(rx: number, rz: number): void {
    const cacheKey = key(rx, rz);
    cache.delete(cacheKey);
    pending.delete(cacheKey);
  }

  function clear(): void {
    cache.clear();
    pending.clear();
  }

  function enforceLimit(): void {
    while (cache.size > limit) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (typeof oldestKey === 'undefined') {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  return { get, delete: del, clear } satisfies EntitiesRegionCache;
}

function resolveChunkIndex(
  region: EntitiesRegion,
  chunk: number | { cx: number; cz: number },
): number {
  if (typeof chunk === 'number') {
    return chunk >>> 0;
  }

  const { cx, cz } = chunk;
  const { regionSize } = region.header;
  const localX = cx - region.rx * regionSize;
  const localZ = cz - region.rz * regionSize;
  if (localX < 0 || localX >= regionSize || localZ < 0 || localZ >= regionSize) {
    throw new RangeError('Chunk is outside region bounds');
  }
  return localZ * regionSize + localX;
}

function ensureChunkState(region: EntitiesRegion, chunkIndex: number): ChunkState {
  let state = region.chunks.get(chunkIndex);
  if (!state) {
    state = {
      snapshot: [],
      deltas: [],
      logStats: { entries: 0, bytes: 0 },
    } satisfies ChunkState;
    region.chunks.set(chunkIndex, state);
  }
  return state;
}

function createRegionFilename(rx: number, rz: number): string {
  return `entities.r.${rx}.${rz}.gea`;
}

function createHeaderFromOptions(options: EntitiesRegionOptions): RegionHeader {
  return {
    version: options.version ?? DEFAULT_VERSION,
    regionSize: options.regionSize >>> 0,
    worldUuid: normalizeUuidString(options.worldUuid),
    schemaVersion: options.schemaVersion >>> 0,
  } satisfies RegionHeader;
}

function parseRegionBody(region: EntitiesRegion, data: Uint8Array): void {
  const table = parseChunkTable(data);
  const snapshotStart = table.endOffset;
  const snapshotEnd = snapshotStart + table.snapshotSize;
  const logStart = snapshotEnd;
  const logEnd = logStart + table.logSize;

  if (logEnd > data.length) {
    throw new RangeError('Entities region file is truncated');
  }

  const snapshotBlob = data.subarray(snapshotStart, snapshotEnd);
  const logBlob = data.subarray(logStart, logEnd);

  for (const entry of table.entries) {
    if (entry.snapshotOffset + entry.snapshotLength > snapshotBlob.length) {
      throw new RangeError('Snapshot entry exceeds snapshot blob size');
    }
    if (entry.logOffset + entry.logLength > logBlob.length) {
      throw new RangeError('Log entry exceeds log blob size');
    }

    const snapshotSlice = snapshotBlob.subarray(
      entry.snapshotOffset,
      entry.snapshotOffset + entry.snapshotLength,
    );
    const logSlice = logBlob.subarray(entry.logOffset, entry.logOffset + entry.logLength);

    const snapshot = parseSnapshot(snapshotSlice);
    const { deltas, stats } = parseDeltas(logSlice);

    region.chunks.set(entry.index, {
      snapshot,
      deltas,
      logStats: stats,
    });
  }
}

function parseChunkTable(data: Uint8Array): {
  entries: ChunkTableEntry[];
  snapshotSize: number;
  logSize: number;
  endOffset: number;
} {
  let offset = HEADER_SIZE;
  const { value: chunkCount, nextOffset } = readVarint(data, offset);
  offset = nextOffset;

  const entries: ChunkTableEntry[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const indexResult = readVarint(data, offset);
    offset = indexResult.nextOffset;
    const snapshotOffsetResult = readVarint(data, offset);
    offset = snapshotOffsetResult.nextOffset;
    const snapshotLengthResult = readVarint(data, offset);
    offset = snapshotLengthResult.nextOffset;
    const logOffsetResult = readVarint(data, offset);
    offset = logOffsetResult.nextOffset;
    const logLengthResult = readVarint(data, offset);
    offset = logLengthResult.nextOffset;

    entries.push({
      index: indexResult.value >>> 0,
      snapshotOffset: snapshotOffsetResult.value >>> 0,
      snapshotLength: snapshotLengthResult.value >>> 0,
      logOffset: logOffsetResult.value >>> 0,
      logLength: logLengthResult.value >>> 0,
    });
  }

  const snapshotSizeResult = readVarint(data, offset);
  offset = snapshotSizeResult.nextOffset;
  const logSizeResult = readVarint(data, offset);
  offset = logSizeResult.nextOffset;

  return {
    entries,
    snapshotSize: snapshotSizeResult.value >>> 0,
    logSize: logSizeResult.value >>> 0,
    endOffset: offset,
  };
}

function parseSnapshot(data: Uint8Array): PersistedEntityRecord[] {
  if (data.length === 0) {
    return [];
  }
  let offset = 0;
  const countResult = readVarint(data, offset);
  offset = countResult.nextOffset;
  const records: PersistedEntityRecord[] = [];
  for (let i = 0; i < countResult.value; i += 1) {
    const parsed = readRecord(data, offset);
    records.push(parsed.record);
    offset = parsed.nextOffset;
  }
  return records;
}

function parseDeltas(data: Uint8Array): { deltas: EntityDelta[]; stats: EntitiesLogStats } {
  const deltas: EntityDelta[] = [];
  let offset = 0;
  while (offset < data.length) {
    const opKind = data[offset++];
    switch (opKind) {
      case 1: {
        const parsed = readRecord(data, offset);
        deltas.push({ kind: 'place', record: parsed.record });
        offset = parsed.nextOffset;
        break;
      }
      case 2: {
        const lengthResult = readVarint(data, offset);
        offset = lengthResult.nextOffset;
        const end = offset + lengthResult.value;
        if (end > data.length) {
          throw new RangeError('Malformed entity log entry');
        }
        const id = TEXT_DECODER.decode(data.subarray(offset, end));
        deltas.push({ kind: 'remove', id });
        offset = end;
        break;
      }
      default:
        throw new RangeError(`Unknown entity log op ${opKind}`);
    }
  }
  return {
    deltas,
    stats: { entries: deltas.length, bytes: data.length },
  };
}

function readRecord(
  data: Uint8Array,
  offset: number,
): { record: PersistedEntityRecord; nextOffset: number } {
  const typeResult = readVarint(data, offset);
  offset = typeResult.nextOffset;
  const typeEnd = offset + typeResult.value;
  if (typeEnd > data.length) {
    throw new RangeError('Malformed entity record type');
  }
  const typeId = TEXT_DECODER.decode(data.subarray(offset, typeEnd));
  offset = typeEnd;

  if (offset + 64 > data.length) {
    throw new RangeError('Malformed entity transform');
  }
  const transform = new Float32Array(16);
  const view = new DataView(data.buffer, data.byteOffset + offset, 64);
  for (let i = 0; i < 16; i += 1) {
    transform[i] = view.getFloat32(i * 4, true);
  }
  offset += 64;

  const metaResult = readVarint(data, offset);
  offset = metaResult.nextOffset;
  const metaEnd = offset + metaResult.value;
  if (metaEnd > data.length) {
    throw new RangeError('Malformed entity record metadata');
  }
  const metaText = TEXT_DECODER.decode(data.subarray(offset, metaEnd));
  const meta = metaText.length === 0 ? null : JSON.parse(metaText);
  offset = metaEnd;

  const idResult = readVarint(data, offset);
  offset = idResult.nextOffset;
  const idEnd = offset + idResult.value;
  if (idEnd > data.length) {
    throw new RangeError('Malformed entity record id');
  }
  const id = TEXT_DECODER.decode(data.subarray(offset, idEnd));
  offset = idEnd;

  return {
    record: { id, typeId, transform, meta },
    nextOffset: offset,
  };
}

async function writeRegion(region: EntitiesRegion): Promise<void> {
  const serialized = serializeRegion(region);
  await region.file.write(serialized);
}

function serializeRegion(region: EntitiesRegion): Uint8Array {
  const headerBytes = serializeHeader(region.header);

  const chunkEntries = Array.from(region.chunks.entries()).sort(
    ([a], [b]) => a - b,
  );

  const snapshotParts: Uint8Array[] = [];
  const logParts: Uint8Array[] = [];
  const tableNumbers: number[] = [];

  let snapshotOffset = 0;
  let logOffset = 0;

  encodeVarint(tableNumbers, chunkEntries.length);
  for (const [index, state] of chunkEntries) {
    const snapshotBytes = encodeSnapshot(state.snapshot);
    const logBytes = encodeDeltas(state.deltas);

    state.logStats = {
      entries: state.deltas.length,
      bytes: logBytes.length,
    } satisfies EntitiesLogStats;

    encodeVarint(tableNumbers, index);
    encodeVarint(tableNumbers, snapshotOffset);
    encodeVarint(tableNumbers, snapshotBytes.length);
    encodeVarint(tableNumbers, logOffset);
    encodeVarint(tableNumbers, logBytes.length);

    snapshotParts.push(snapshotBytes);
    logParts.push(logBytes);

    snapshotOffset += snapshotBytes.length;
    logOffset += logBytes.length;
  }

  encodeVarint(tableNumbers, snapshotOffset);
  encodeVarint(tableNumbers, logOffset);

  const tableBytes = Uint8Array.from(tableNumbers);
  const snapshotBlob = concatArrays(snapshotParts);
  const logBlob = concatArrays(logParts);

  const totalLength = headerBytes.length + tableBytes.length + snapshotBlob.length + logBlob.length;
  const output = new Uint8Array(totalLength);

  let offset = 0;
  output.set(headerBytes, offset);
  offset += headerBytes.length;
  output.set(tableBytes, offset);
  offset += tableBytes.length;
  output.set(snapshotBlob, offset);
  offset += snapshotBlob.length;
  output.set(logBlob, offset);

  return output;
}

function encodeSnapshot(records: PersistedEntityRecord[]): Uint8Array {
  const encodedRecords = records.map(encodeRecord);
  const totalLength =
    sizeOfVarint(records.length) + encodedRecords.reduce((sum, record) => sum + record.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = writeVarint(records.length, result, 0);
  for (const record of encodedRecords) {
    result.set(record, offset);
    offset += record.length;
  }
  return result;
}

function encodeDeltas(deltas: EntityDelta[]): Uint8Array {
  if (deltas.length === 0) {
    return new Uint8Array(0);
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  for (const delta of deltas) {
    if (delta.kind === 'place') {
      const recordBytes = encodeRecord(delta.record);
      const payload = new Uint8Array(1 + recordBytes.length);
      payload[0] = 1;
      payload.set(recordBytes, 1);
      parts.push(payload);
      total += payload.length;
    } else {
      const idBytes = TEXT_ENCODER.encode(delta.id);
      const payload = new Uint8Array(1 + sizeOfVarint(idBytes.length) + idBytes.length);
      payload[0] = 2;
      let offset = writeVarint(idBytes.length, payload, 1);
      payload.set(idBytes, offset);
      total += payload.length;
      parts.push(payload);
    }
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeRecord(record: PersistedEntityRecord): Uint8Array {
  const idBytes = TEXT_ENCODER.encode(record.id);
  const typeBytes = TEXT_ENCODER.encode(record.typeId);
  const metaJson = JSON.stringify(record.meta ?? null);
  const metaBytes = TEXT_ENCODER.encode(metaJson);

  const totalLength =
    sizeOfVarint(typeBytes.length) +
    typeBytes.length +
    64 +
    sizeOfVarint(metaBytes.length) +
    metaBytes.length +
    sizeOfVarint(idBytes.length) +
    idBytes.length;

  const result = new Uint8Array(totalLength);
  let offset = writeVarint(typeBytes.length, result, 0);
  result.set(typeBytes, offset);
  offset += typeBytes.length;

  const view = new DataView(result.buffer, result.byteOffset + offset, 64);
  const matrix = record.transform;
  for (let i = 0; i < 16; i += 1) {
    view.setFloat32(i * 4, matrix[i] ?? 0, true);
  }
  offset += 64;

  offset = writeVarint(metaBytes.length, result, offset);
  result.set(metaBytes, offset);
  offset += metaBytes.length;

  offset = writeVarint(idBytes.length, result, offset);
  result.set(idBytes, offset);
  offset += idBytes.length;

  return result.subarray(0, offset);
}

function concatArrays(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function cloneRecord(record: PersistedEntityRecord): PersistedEntityRecord {
  return {
    id: record.id,
    typeId: record.typeId,
    transform: new Float32Array(record.transform),
    meta: structuredCloneSafe(record.meta),
  } satisfies PersistedEntityRecord;
}

function cloneDelta(delta: EntityDelta): EntityDelta {
  if (delta.kind === 'place') {
    return { kind: 'place', record: cloneRecord(delta.record) };
  }
  return { kind: 'remove', id: delta.id } satisfies EntityDelta;
}

function normalizeRecord(record: PersistedEntityRecord): PersistedEntityRecord {
  return {
    id: String(record.id ?? ''),
    typeId: String(record.typeId ?? ''),
    transform: normalizeTransform(record.transform),
    meta: structuredCloneSafe(record.meta),
  } satisfies PersistedEntityRecord;
}

function normalizeDelta(delta: EntityDelta): EntityDelta {
  if (delta.kind === 'place') {
    return { kind: 'place', record: normalizeRecord(delta.record) };
  }
  return { kind: 'remove', id: String(delta.id ?? '') } satisfies EntityDelta;
}

function normalizeTransform(transform?: Float32Array): Float32Array {
  const matrix = new Float32Array(16);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  if (transform) {
    const limit = Math.min(16, transform.length);
    for (let i = 0; i < limit; i += 1) {
      matrix[i] = transform[i] ?? matrix[i];
    }
  }
  return matrix;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function serializeHeader(header: RegionHeader): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE);
  bytes.set(TEXT_ENCODER.encode(MAGIC).slice(0, 4), 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(4, header.version, true);
  view.setUint16(6, header.regionSize, true);
  const uuidBytes = encodeUuid(header.worldUuid);
  bytes.set(uuidBytes, 8);
  view.setUint16(24, header.schemaVersion, true);
  return bytes;
}

function parseHeader(data: Uint8Array): RegionHeader {
  if (data.length < HEADER_SIZE) {
    throw new RangeError('Entities region file is too small');
  }
  const magic = TEXT_DECODER.decode(data.subarray(0, 4));
  if (magic !== MAGIC) {
    throw new Error('Invalid entities region magic header');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint16(4, true);
  const regionSize = view.getUint16(6, true);
  const uuidBytes = data.subarray(8, 24);
  const schemaVersion = view.getUint16(24, true);
  return {
    version,
    regionSize,
    worldUuid: decodeUuid(uuidBytes),
    schemaVersion,
  } satisfies RegionHeader;
}

function validateHeader(header: RegionHeader, options: EntitiesRegionOptions): void {
  const expectedVersion = options.version ?? DEFAULT_VERSION;
  if (header.version !== expectedVersion) {
    throw new Error(`Unsupported entities region version ${header.version}`);
  }
  if (header.regionSize !== (options.regionSize >>> 0)) {
    throw new Error('Entities region size mismatch');
  }
  if (header.worldUuid !== normalizeUuidString(options.worldUuid)) {
    throw new Error('Entities region world UUID mismatch');
  }
  if (header.schemaVersion !== (options.schemaVersion >>> 0)) {
    throw new Error('Entities region schema version mismatch');
  }
}

function encodeVarint(target: number[], value: number): void {
  let unsigned = value >>> 0;
  while (unsigned >= 0x80) {
    target.push((unsigned & 0x7f) | 0x80);
    unsigned >>>= 7;
  }
  target.push(unsigned & 0x7f);
}

function encodeUuid(uuid: string): Uint8Array {
  const normalized = uuid.replace(/-/g, '').toLowerCase();
  if (normalized.length !== 32) {
    throw new Error('UUID must be 16 bytes');
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    const hex = normalized.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(hex, 16);
    if (Number.isNaN(value)) {
      throw new Error('Invalid UUID format');
    }
    bytes[i] = value & 0xff;
  }
  return bytes;
}

function decodeUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeUuidString(uuid: string): string {
  return decodeUuid(encodeUuid(uuid));
}

async function ensureNodeRegionFile(root: string, filename: string): Promise<RegionFileHandle> {
  const fs = await importNodeFs();
  const path = await importNodePath();
  await fs.mkdir(root, { recursive: true });
  const targetPath = path.join(root, filename);
  try {
    await fs.access(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      await fs.writeFile(targetPath, new Uint8Array(0));
    } else {
      throw error;
    }
  }

  return {
    async read() {
      try {
        const buffer = await fs.readFile(targetPath);
        return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return new Uint8Array(0);
        }
        throw error;
      }
    },
    async write(data) {
      const dir = path.dirname(targetPath);
      const tempName = `${path.basename(targetPath)}.${Date.now().toString(16)}.${Math.random()
        .toString(16)
        .slice(2)}.tmp`;
      const tempPath = path.join(dir, tempName);
      await fs.writeFile(tempPath, data);
      await fs.rename(tempPath, targetPath);
    },
  } satisfies RegionFileHandle;
}

async function ensureOpfsRegionFile(
  root: FileSystemDirectoryHandle,
  filename: string,
): Promise<RegionFileHandle> {
  const handle = await root.getFileHandle(filename, { create: true });
  return {
    async read() {
      const file = await handle.getFile();
      if (file.size === 0) {
        return new Uint8Array(0);
      }
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    },
    async write(data) {
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(data);
      await writable.close();
    },
  } satisfies RegionFileHandle;
}

let nodeFsPromise: Promise<typeof import('node:fs/promises')> | null = null;
let nodePathPromise: Promise<typeof import('node:path')> | null = null;

async function importNodeFs(): Promise<typeof import('node:fs/promises')> {
  if (!nodeFsPromise) {
    nodeFsPromise = import('node:fs/promises');
  }
  return nodeFsPromise;
}

async function importNodePath(): Promise<typeof import('node:path')> {
  if (!nodePathPromise) {
    nodePathPromise = import('node:path');
  }
  return nodePathPromise;
}
