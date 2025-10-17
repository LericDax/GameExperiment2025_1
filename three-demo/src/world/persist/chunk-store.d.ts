/**
 * Identifies a chunk using world-space chunk coordinates.
 */
export interface ChunkKey {
  cx: number;
  cy: number;
  cz: number;
}

/**
 * Describes a persistence operation on a chunk. Snapshot entries must replace
 * the full chunk state, while journal entries append incremental updates that
 * can replay the chunk history after the most recent snapshot.
 */
export type SaveOp =
  | {
      type: 'snapshot';
      key: ChunkKey;
      /** Binary payload that replaces the stored snapshot for the chunk. */
      payload: ArrayBufferView | ArrayBufferLike;
    }
  | {
      type: 'journal';
      key: ChunkKey;
      /** Binary payload that appends to the chunk's journal log. */
      payload: ArrayBufferView | ArrayBufferLike;
      /** Simulation tick or logical timestamp associated with the update. */
      tick: number;
    };

/**
 * Interface implemented by persistence backends that handle chunk data. A
 * snapshot read must return the last full chunk payload, and journal reads must
 * provide entries in the order they were originally committed. `commit` should
 * apply the supplied operations atomically.
 */
export interface ChunkStore {
  loadSnapshot(key: ChunkKey): Promise<Uint8Array | null>;
  loadJournal(key: ChunkKey): Promise<Uint8Array[]>;
  commit(ops: SaveOp[]): Promise<void>;
  remove?(key: ChunkKey): Promise<void>;
}
