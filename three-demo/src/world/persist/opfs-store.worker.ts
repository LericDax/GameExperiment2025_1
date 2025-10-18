const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

interface ChunkKey {
  cx: number;
  cy: number;
  cz: number;
}

interface SaveSnapshotOp {
  type: 'snapshot';
  key: ChunkKey;
  payload: ArrayBuffer;
}

interface SaveJournalOp {
  type: 'journal';
  key: ChunkKey;
  payload: ArrayBuffer;
  tick: number;
}

type WorkerCommitOp = SaveSnapshotOp | SaveJournalOp;

type WorkerRequestMethod = 'init' | 'loadSnapshot' | 'loadJournal' | 'commit' | 'remove';

interface WorkerRequestBase<M extends WorkerRequestMethod> {
  id: number;
  method: M;
}

interface InitParams {
  worldId: string;
  compatibility: RegionCompatibility;
  regionSize?: number;
  maxOpenRegions?: number;
}

interface InitRequest extends WorkerRequestBase<'init'> {
  params: InitParams;
}

interface LoadRequest extends WorkerRequestBase<'loadSnapshot' | 'loadJournal'> {
  params: { key: ChunkKey };
}

interface CommitRequest extends WorkerRequestBase<'commit'> {
  params: { ops: WorkerCommitOp[] };
}

interface RemoveRequest extends WorkerRequestBase<'remove'> {
  params: { key: ChunkKey };
}

type WorkerRequest = InitRequest | LoadRequest | CommitRequest | RemoveRequest;

type WorkerResponse =
  | { id: number; result: unknown }
  | { id: number; error: { message: string; stack?: string } };

interface RegionCompatibility {
  worldUuid: string;
  schemaVersion: number;
}

interface RegionChunkMetadata {
  hasSnapshot: boolean;
  snapshotSize: number;
  lastJournalTick: number | null;
  journalEntries: number;
  journalSize: number;
  updatedAt: string;
}

interface RegionMetadata {
  worldUuid: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  chunks: Record<string, RegionChunkMetadata>;
}

interface RegionContext {
  key: string;
  dir: FileSystemDirectoryHandle;
  snapshotsDir: FileSystemDirectoryHandle;
  journalsDir: FileSystemDirectoryHandle;
  metadataHandle: FileSystemFileHandle;
  metadata: RegionMetadata;
}

interface ActiveConfiguration {
  worldId: string;
  regionSize: number;
  maxOpenRegions: number;
  compatibility: RegionCompatibility;
  root: FileSystemDirectoryHandle;
  worldDir: FileSystemDirectoryHandle;
  regionsDir: FileSystemDirectoryHandle;
}

const DEFAULT_REGION_SIZE = 32;
const DEFAULT_REGION_CACHE_SIZE = 8;

let config: ActiveConfiguration | null = null;
const regionCache = new Map<string, RegionContext>();

ctx.addEventListener('message', async (event) => {
  const data = event.data as WorkerRequest;

  if (!data || typeof data !== 'object') {
    return;
  }

  try {
    switch (data.method) {
      case 'init': {
        const result = await handleInit(data.params);
        postResponse({ id: data.id, result });
        break;
      }
      case 'loadSnapshot': {
        const payload = await handleLoadSnapshot(data.params.key);
        if (payload) {
          postResponse({ id: data.id, result: payload.buffer }, [payload.buffer]);
        } else {
          postResponse({ id: data.id, result: null });
        }
        break;
      }
      case 'loadJournal': {
        const payloads = await handleLoadJournal(data.params.key);
        const transfer = payloads.map((item) => item.buffer);
        postResponse({ id: data.id, result: payloads.map((item) => item.buffer) }, transfer);
        break;
      }
      case 'commit': {
        await handleCommit(data.params.ops);
        postResponse({ id: data.id, result: null });
        break;
      }
      case 'remove': {
        await handleRemove(data.params.key);
        postResponse({ id: data.id, result: null });
        break;
      }
      default:
        throw new Error(`Unknown method ${(data as WorkerRequest).method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    postResponse({ id: data.id, error: { message, stack } });
  }
});

function postResponse(response: WorkerResponse, transfer?: Transferable[]) {
  ctx.postMessage(response, transfer ?? []);
}

async function handleInit(params: InitParams): Promise<null> {
  if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS is not available in this environment');
  }

  const regionSize = Math.max(1, Math.floor(params.regionSize ?? DEFAULT_REGION_SIZE));
  const maxOpenRegions = Math.max(1, Math.floor(params.maxOpenRegions ?? DEFAULT_REGION_CACHE_SIZE));

  const root = await navigator.storage.getDirectory();
  const worldsDir = await getOrCreateDirectory(root, 'worlds');
  const worldDir = await getOrCreateDirectory(worldsDir, params.worldId);
  const regionsDir = await getOrCreateDirectory(worldDir, 'regions');

  config = {
    worldId: params.worldId,
    regionSize,
    maxOpenRegions,
    compatibility: params.compatibility,
    root,
    worldDir,
    regionsDir,
  };
  regionCache.clear();

  return null;
}

async function handleLoadSnapshot(key: ChunkKey): Promise<Uint8Array | null> {
  const region = await getRegionForKey(key);
  const filename = createChunkFilename(key);

  try {
    const fileHandle = await region.snapshotsDir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const buffer = new Uint8Array(await file.arrayBuffer());
    return decodeSnapshot(buffer);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function handleLoadJournal(key: ChunkKey): Promise<Uint8Array[]> {
  const region = await getRegionForKey(key);
  const filename = createChunkFilename(key);

  try {
    const fileHandle = await region.journalsDir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const buffer = new Uint8Array(await file.arrayBuffer());
    return decodeJournal(buffer);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function handleCommit(ops: WorkerCommitOp[]): Promise<void> {
  if (!ops.length) {
    return;
  }

  const touchedRegions = new Set<RegionContext>();
  const now = new Date().toISOString();

  for (const op of ops) {
    const region = await getRegionForKey(op.key);
    touchedRegions.add(region);
    const chunkId = createChunkId(op.key);
    const payload = new Uint8Array(op.payload);

    switch (op.type) {
      case 'snapshot': {
        await writeSnapshot(region, chunkId, payload);
        updateChunkMetadata(region, chunkId, (meta) => ({
          ...meta,
          hasSnapshot: true,
          snapshotSize: payload.byteLength,
          updatedAt: now,
        }));
        break;
      }
      case 'journal': {
        const newLength = await appendJournal(region, chunkId, payload, op.tick);
        updateChunkMetadata(region, chunkId, (meta) => ({
          ...meta,
          journalEntries: meta.journalEntries + 1,
          journalSize: newLength,
          lastJournalTick: op.tick,
          updatedAt: now,
        }));
        break;
      }
    }
  }

  for (const region of touchedRegions) {
    region.metadata.updatedAt = now;
    await writeRegionMetadata(region);
  }
}

async function handleRemove(key: ChunkKey): Promise<void> {
  const region = await getRegionForKey(key);
  const filename = createChunkFilename(key);
  const chunkId = createChunkId(key);
  const promises: Promise<void>[] = [];

  promises.push(
    region.snapshotsDir
      .removeEntry(filename)
      .catch((error) => {
        if (!isNotFoundError(error)) {
          throw error;
        }
      })
      .then(() => undefined),
  );

  promises.push(
    region.journalsDir
      .removeEntry(filename)
      .catch((error) => {
        if (!isNotFoundError(error)) {
          throw error;
        }
      })
      .then(() => undefined),
  );

  await Promise.all(promises);

  if (region.metadata.chunks[chunkId]) {
    delete region.metadata.chunks[chunkId];
    region.metadata.updatedAt = new Date().toISOString();
    await writeRegionMetadata(region);
  }
}

function ensureConfig(): ActiveConfiguration {
  if (!config) {
    throw new Error('Worker has not been initialised');
  }
  return config;
}

async function getRegionForKey(key: ChunkKey): Promise<RegionContext> {
  const active = ensureConfig();
  const { regionSize } = active;
  const rx = Math.floor(key.cx / regionSize);
  const ry = Math.floor(key.cy / regionSize);
  const rz = Math.floor(key.cz / regionSize);
  const regionKey = `${rx}_${ry}_${rz}`;

  const cached = regionCache.get(regionKey);
  if (cached) {
    regionCache.delete(regionKey);
    regionCache.set(regionKey, cached);
    return cached;
  }

  const regionDir = await getOrCreateDirectory(active.regionsDir, regionKey);
  const snapshotsDir = await getOrCreateDirectory(regionDir, 'snapshots');
  const journalsDir = await getOrCreateDirectory(regionDir, 'journals');
  const metadataHandle = await regionDir.getFileHandle('metadata.json', { create: true });
  const metadata = await readRegionMetadata(regionDir, metadataHandle, active.compatibility);

  const context: RegionContext = {
    key: regionKey,
    dir: regionDir,
    snapshotsDir,
    journalsDir,
    metadataHandle,
    metadata,
  };

  regionCache.set(regionKey, context);
  enforceRegionCacheLimit(active.maxOpenRegions);

  return context;
}

function enforceRegionCacheLimit(limit: number): void {
  while (regionCache.size > limit) {
    const oldestKey = regionCache.keys().next().value as string | undefined;
    if (typeof oldestKey === 'undefined') {
      break;
    }
    regionCache.delete(oldestKey);
  }
}

async function readRegionMetadata(
  directory: FileSystemDirectoryHandle,
  handle: FileSystemFileHandle,
  compatibility: RegionCompatibility,
): Promise<RegionMetadata> {
  try {
    const file = await handle.getFile();
    if (file.size === 0) {
      throw new Error('Empty metadata');
    }
    const text = await file.text();
    const parsed = JSON.parse(text) as RegionMetadata;
    validateRegionCompatibility(parsed, compatibility);
    return normalizeRegionMetadata(parsed);
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.warn('Failed to read region metadata, recreating', error);
    }
  }

  const now = new Date().toISOString();
  const fresh: RegionMetadata = {
    worldUuid: compatibility.worldUuid,
    schemaVersion: compatibility.schemaVersion,
    createdAt: now,
    updatedAt: now,
    chunks: {},
  };

  await writeRegionMetadataFile(directory, fresh);
  return fresh;
}

async function writeRegionMetadata(region: RegionContext): Promise<void> {
  await writeRegionMetadataFile(region.dir, region.metadata);
}

async function writeRegionMetadataFile(
  directory: FileSystemDirectoryHandle,
  metadata: RegionMetadata,
): Promise<void> {
  const text = JSON.stringify(metadata, null, 2);
  await writeFileAtomic(directory, 'metadata.json', text);
}

async function writeSnapshot(region: RegionContext, chunkId: string, payload: Uint8Array): Promise<void> {
  const encoded = encodeSnapshot(payload);
  const filename = `${chunkId}.bin`;
  await writeFileAtomic(region.snapshotsDir, filename, encoded);
}

async function appendJournal(
  region: RegionContext,
  chunkId: string,
  payload: Uint8Array,
  tick: number,
): Promise<number> {
  const filename = `${chunkId}.bin`;
  const tempData = encodeJournalEntry(payload, tick);
  const handle = await region.journalsDir.getFileHandle(filename, { create: true });
  let existing = new Uint8Array(0);

  try {
    const file = await handle.getFile();
    existing = new Uint8Array(await file.arrayBuffer());
    if (existing.byteLength > 0) {
      // Validate current journal before appending.
      decodeJournal(existing);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const combined = new Uint8Array(existing.byteLength + tempData.byteLength);
  combined.set(existing, 0);
  combined.set(tempData, existing.byteLength);
  await writeFileAtomic(region.journalsDir, filename, combined);
  return combined.byteLength;
}

async function writeFileAtomic(
  directory: FileSystemDirectoryHandle,
  name: string,
  contents: Uint8Array | string,
): Promise<void> {
  const data = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  const tempName = `${name}.tmp-${Math.random().toString(16).slice(2)}`;
  const tempHandle = await directory.getFileHandle(tempName, { create: true });
  await writeDirect(tempHandle, data);
  await removeIfExists(directory, name);
  if (typeof (tempHandle as any).move === 'function') {
    await (tempHandle as any).move(directory, name);
  } else {
    const finalHandle = await directory.getFileHandle(name, { create: true });
    await writeDirect(finalHandle, data);
    await directory.removeEntry(tempName).catch(() => undefined);
    return;
  }
  await directory.removeEntry(tempName).catch(() => undefined);
}

async function writeDirect(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(data);
  await writable.close();
}

async function removeIfExists(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function createChunkId({ cx, cy, cz }: ChunkKey): string {
  return `${cx}_${cy}_${cz}`;
}

function createChunkFilename(key: ChunkKey): string {
  return `${createChunkId(key)}.bin`;
}

async function getOrCreateDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

function validateRegionCompatibility(metadata: RegionMetadata, expected: RegionCompatibility): void {
  if (metadata.worldUuid !== expected.worldUuid) {
    throw new Error('World UUID mismatch for region metadata');
  }

  if (metadata.schemaVersion !== expected.schemaVersion) {
    throw new Error('Schema version mismatch for region metadata');
  }
}

function normalizeRegionMetadata(metadata: RegionMetadata): RegionMetadata {
  const normalizedChunks: Record<string, RegionChunkMetadata> = {};
  for (const [key, value] of Object.entries(metadata.chunks ?? {})) {
    normalizedChunks[key] = {
      hasSnapshot: Boolean(value.hasSnapshot),
      snapshotSize: Number(value.snapshotSize ?? 0),
      lastJournalTick:
        typeof value.lastJournalTick === 'number' && Number.isFinite(value.lastJournalTick)
          ? value.lastJournalTick
          : null,
      journalEntries: Number(value.journalEntries ?? 0) || 0,
      journalSize: Number(value.journalSize ?? 0) || 0,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    };
  }

  return {
    worldUuid: String(metadata.worldUuid),
    schemaVersion: Number(metadata.schemaVersion),
    createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : new Date().toISOString(),
    updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : new Date().toISOString(),
    chunks: normalizedChunks,
  };
}

function updateChunkMetadata(
  region: RegionContext,
  chunkId: string,
  updater: (meta: RegionChunkMetadata) => RegionChunkMetadata,
): void {
  const existing =
    region.metadata.chunks[chunkId] ??
    ({
      hasSnapshot: false,
      snapshotSize: 0,
      lastJournalTick: null,
      journalEntries: 0,
      journalSize: 0,
      updatedAt: new Date().toISOString(),
    } satisfies RegionChunkMetadata);
  region.metadata.chunks[chunkId] = updater(existing);
}

const CRC_TABLE = new Uint32Array(256);

(function initCrcTable() {
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      if ((c & 1) !== 0) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    CRC_TABLE[i] = c >>> 0;
  }
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i];
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeSnapshot(payload: Uint8Array): Uint8Array {
  const header = new DataView(new ArrayBuffer(8));
  header.setUint32(0, payload.byteLength, true);
  header.setUint32(4, crc32(payload), true);
  const result = new Uint8Array(8 + payload.byteLength);
  result.set(new Uint8Array(header.buffer), 0);
  result.set(payload, 8);
  return result;
}

function decodeSnapshot(buffer: Uint8Array): Uint8Array {
  if (buffer.byteLength < 8) {
    throw new Error('Corrupt snapshot payload: missing header');
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint32(0, true);
  const expectedCrc = view.getUint32(4, true);
  if (length !== buffer.byteLength - 8) {
    throw new Error('Corrupt snapshot payload: length mismatch');
  }
  const payload = buffer.subarray(8);
  const actualCrc = crc32(payload);
  if (actualCrc !== expectedCrc) {
    throw new Error('Snapshot CRC mismatch');
  }
  return payload.slice();
}

function encodeJournalEntry(payload: Uint8Array, tick: number): Uint8Array {
  const header = new DataView(new ArrayBuffer(12));
  header.setUint32(0, payload.byteLength, true);
  header.setUint32(4, Math.trunc(tick) >>> 0, true);
  header.setUint32(8, crc32(payload), true);
  const result = new Uint8Array(12 + payload.byteLength);
  result.set(new Uint8Array(header.buffer), 0);
  result.set(payload, 12);
  return result;
}

function decodeJournal(buffer: Uint8Array): Uint8Array[] {
  const entries: Uint8Array[] = [];
  let offset = 0;
  while (offset < buffer.byteLength) {
    if (offset + 12 > buffer.byteLength) {
      throw new Error('Corrupt journal payload: truncated header');
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 12);
    const length = view.getUint32(0, true);
    const tick = view.getUint32(4, true); // Validate tick is consumed but not returned.
    const expectedCrc = view.getUint32(8, true);
    offset += 12;
    if (offset + length > buffer.byteLength) {
      throw new Error('Corrupt journal payload: truncated entry');
    }
    const payload = buffer.subarray(offset, offset + length);
    offset += length;
    const actualCrc = crc32(payload);
    if (actualCrc !== expectedCrc) {
      throw new Error('Journal CRC mismatch');
    }
    // Reference tick to ensure structure validity even though not returned.
    if (!Number.isFinite(tick)) {
      throw new Error('Invalid journal tick');
    }
    entries.push(payload.slice());
  }
  return entries;
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if ('name' in error && (error as { name?: string }).name === 'NotFoundError') {
    return true;
  }
  if ('code' in error && (error as { code?: number }).code === 8) {
    return true;
  }
  return false;
}

// Polyfills for experimental APIs used above.
declare global {
  interface FileSystemFileHandle {
    move?(parent: FileSystemDirectoryHandle, name?: string): Promise<void>;
  }
}
