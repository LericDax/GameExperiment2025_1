import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChunkKey, ChunkStore, SaveOp } from './chunk-store';

export const WORLD_INDEX_FILE = 'world.geca';
export const CURRENT_WORLD_SCHEMA_VERSION = 1;

export interface WorldIndexRecord {
  worldUuid: string;
  seed: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface EnsureWorldIndexOptions {
  seed: string;
  schemaVersion?: number;
  worldUuid?: string;
  overwrite?: boolean;
}

export interface RegionCompatibility {
  worldUuid: string;
  schemaVersion: number;
}

export type ChunkKeyLike =
  | ChunkKey
  | { cx: number; cy: number; cz: number }
  | readonly [number, number, number];

type SnapshotOpInput = Omit<Extract<SaveOp, { type: 'snapshot' }>, 'key'> & {
  key: ChunkKeyLike;
};
type JournalOpInput = Omit<Extract<SaveOp, { type: 'journal' }>, 'key'> & {
  key: ChunkKeyLike;
};
export type SaveOpInput = SnapshotOpInput | JournalOpInput;

export interface NormalizedChunkStore {
  loadSnapshot(key: ChunkKeyLike): Promise<Uint8Array | null>;
  loadJournal(key: ChunkKeyLike): Promise<Uint8Array[]>;
  commit(ops: SaveOpInput[]): Promise<void>;
  remove(key: ChunkKeyLike): Promise<void>;
  readonly raw: ChunkStore;
}

export async function loadWorldIndex(directory: string): Promise<WorldIndexRecord | null> {
  const indexPath = path.join(directory, WORLD_INDEX_FILE);

  try {
    const file = await readFile(indexPath, 'utf8');
    const parsed = JSON.parse(file);
    return normalizeWorldIndex(parsed);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function ensureWorldIndex(
  directory: string,
  options: EnsureWorldIndexOptions,
): Promise<WorldIndexRecord> {
  const existing = await loadWorldIndex(directory);
  const schemaVersion = options.schemaVersion ?? CURRENT_WORLD_SCHEMA_VERSION;

  if (existing && !options.overwrite) {
    return existing;
  }

  const timestamp = new Date().toISOString();
  const record: WorldIndexRecord = existing
    ? {
        ...existing,
        seed: options.seed,
        schemaVersion,
        updatedAt: timestamp,
      }
    : {
        worldUuid: options.worldUuid ?? randomUUID(),
        seed: options.seed,
        schemaVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, WORLD_INDEX_FILE),
    JSON.stringify(record, null, 2),
    'utf8',
  );

  return record;
}

export function assertRegionCompatibility(
  region: RegionCompatibility,
  index: WorldIndexRecord,
  context = 'region file',
): void {
  if (region.worldUuid !== index.worldUuid) {
    throw new Error(
      `World mismatch for ${context}: expected ${index.worldUuid} but received ${region.worldUuid}`,
    );
  }

  if (region.schemaVersion !== index.schemaVersion) {
    throw new Error(
      `Schema mismatch for ${context}: expected v${index.schemaVersion} but received v${region.schemaVersion}`,
    );
  }
}

export function isRegionCompatible(region: RegionCompatibility, index: WorldIndexRecord): boolean {
  return region.worldUuid === index.worldUuid && region.schemaVersion === index.schemaVersion;
}

export function createRegionCompatibility(index: WorldIndexRecord): RegionCompatibility {
  return {
    worldUuid: index.worldUuid,
    schemaVersion: index.schemaVersion,
  };
}

export function normalizeChunkKey(key: ChunkKeyLike): ChunkKey {
  if (Array.isArray(key)) {
    const [cx, cy, cz] = key;
    return { cx: Number(cx), cy: Number(cy), cz: Number(cz) };
  }

  return { cx: Number(key.cx), cy: Number(key.cy), cz: Number(key.cz) };
}

export function normalizeSaveOp(op: SaveOpInput): SaveOp {
  if (op.type === 'snapshot') {
    return {
      type: 'snapshot',
      payload: op.payload,
      key: normalizeChunkKey(op.key),
    };
  }

  return {
    type: 'journal',
    payload: op.payload,
    tick: op.tick,
    key: normalizeChunkKey(op.key),
  };
}

export function createChunkStoreFacade(store: ChunkStore): NormalizedChunkStore {
  return {
    loadSnapshot: (key) => store.loadSnapshot(normalizeChunkKey(key)),
    loadJournal: (key) => store.loadJournal(normalizeChunkKey(key)),
    commit: (ops) => store.commit(ops.map((op) => normalizeSaveOp(op))),
    remove: async (key) => {
      if (typeof store.remove === 'function') {
        await store.remove(normalizeChunkKey(key));
        return;
      }
    },
    raw: store,
  };
}

function normalizeWorldIndex(value: unknown): WorldIndexRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid world index file: expected object payload');
  }

  const {
    worldUuid,
    seed,
    schemaVersion,
    createdAt,
    updatedAt,
  } = value as Partial<WorldIndexRecord>;

  if (typeof worldUuid !== 'string' || worldUuid.length === 0) {
    throw new Error('Invalid world index file: missing worldUuid');
  }

  if (typeof seed !== 'string') {
    throw new Error('Invalid world index file: missing seed');
  }

  if (typeof schemaVersion !== 'number' || Number.isNaN(schemaVersion)) {
    throw new Error('Invalid world index file: missing schemaVersion');
  }

  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new Error('Invalid world index file: schemaVersion must be a non-negative integer');
  }

  const fallbackTimestamp = new Date().toISOString();

  return {
    worldUuid,
    seed,
    schemaVersion,
    createdAt: typeof createdAt === 'string' ? createdAt : fallbackTimestamp,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : fallbackTimestamp,
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT');
}
