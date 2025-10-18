import {
  readSignedVarint,
  readVarint,
  zigZagEncode,
} from './format.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export enum JournalOpId {
  SET_BLOCKS_RLE = 1,
  BRUSH_SPHERE = 2,
  VOXEL_RECT = 3,
  SET_META = 4,
  PLACE_ENTITY = 5,
  REMOVE_ENTITY = 6,
}

export interface JournalRleSpan {
  value: number;
  length: number;
}

export interface SetBlocksRleOp {
  id: JournalOpId.SET_BLOCKS_RLE;
  startIndex: number;
  spans: JournalRleSpan[];
}

export interface BrushSphereOp {
  id: JournalOpId.BRUSH_SPHERE;
  center: { x: number; y: number; z: number };
  radius: number;
  block: number;
}

export interface VoxelRectOp {
  id: JournalOpId.VOXEL_RECT;
  origin: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  block: number;
}

export interface SetMetaOp {
  id: JournalOpId.SET_META;
  key: string;
  value: unknown;
}

export interface JournalEntity {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  state: unknown;
}

export interface PlaceEntityOp {
  id: JournalOpId.PLACE_ENTITY;
  entity: JournalEntity;
}

export interface RemoveEntityOp {
  id: JournalOpId.REMOVE_ENTITY;
  entityId: string;
}

export type JournalOp =
  | SetBlocksRleOp
  | BrushSphereOp
  | VoxelRectOp
  | SetMetaOp
  | PlaceEntityOp
  | RemoveEntityOp;

export interface ChunkJournalGrid {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  blocks: Uint16Array;
  metadata?: Record<string, unknown>;
  entities?:
    | Map<string, JournalEntity>
    | Iterable<JournalEntity>
    | Record<string, JournalEntity>
    | Array<[string, JournalEntity]>;
}

export interface ChunkJournalState {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  blocks: Uint16Array;
  metadata: Record<string, unknown>;
  entities: Map<string, JournalEntity>;
}

class ByteWriter {
  private readonly bytes: number[] = [];

  writeVarint(value: number): void {
    let unsigned = value >>> 0;
    while (unsigned >= 0x80) {
      this.bytes.push((unsigned & 0x7f) | 0x80);
      unsigned >>>= 7;
    }
    this.bytes.push(unsigned & 0x7f);
  }

  writeSignedVarint(value: number): void {
    this.writeVarint(zigZagEncode(value));
  }

  writeUint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeFloat32(value: number): void {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    this.writeBytesRaw(new Uint8Array(view.buffer));
  }

  writeString(value: string): void {
    const data = TEXT_ENCODER.encode(value);
    this.writeVarint(data.length);
    this.writeBytesRaw(data);
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

  readVarint(): number {
    const { value, nextOffset } = readVarint(this.data, this.offset);
    this.offset = nextOffset;
    return value >>> 0;
  }

  readSignedVarint(): number {
    const result = readSignedVarint(this.data, this.offset);
    this.offset = result.nextOffset;
    return result.value;
  }

  readUint8(): number {
    if (this.offset >= this.data.length) {
      throw new RangeError('Unexpected end of buffer');
    }
    return this.data[this.offset++]!;
  }

  readFloat32(): number {
    if (this.offset + 4 > this.data.length) {
      throw new RangeError('Unexpected end of buffer while reading float32');
    }
    const view = new DataView(
      this.data.buffer,
      this.data.byteOffset + this.offset,
      4,
    );
    const value = view.getFloat32(0, true);
    this.offset += 4;
    return value;
  }

  readString(): string {
    const length = this.readVarint();
    if (this.offset + length > this.data.length) {
      throw new RangeError('Unexpected end of buffer while reading string');
    }
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return TEXT_DECODER.decode(slice);
  }

  skipBytes(length: number): void {
    this.offset += length;
    if (this.offset > this.data.length) {
      throw new RangeError('Unexpected end of buffer while skipping bytes');
    }
  }

  get done(): boolean {
    return this.offset >= this.data.length;
  }
}

function normalizeMetadata(source: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!source) {
    return {};
  }
  const result: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (typeof key === 'string' && key.length > 0) {
      result[key] = value;
    }
  });
  return result;
}

function cloneEntity(entity: JournalEntity): JournalEntity {
  return {
    id: entity.id,
    type: entity.type,
    position: {
      x: Number.isFinite(entity.position?.x) ? entity.position.x : 0,
      y: Number.isFinite(entity.position?.y) ? entity.position.y : 0,
      z: Number.isFinite(entity.position?.z) ? entity.position.z : 0,
    },
    state: entity.state ?? null,
  } satisfies JournalEntity;
}

function normalizeEntity(id: string, entity: unknown): JournalEntity {
  if (entity == null) {
    return {
      id,
      type: '',
      position: { x: 0, y: 0, z: 0 },
      state: null,
    } satisfies JournalEntity;
  }
  const candidate = entity as Partial<JournalEntity>;
  const normalizedId =
    typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : id;
  if (!normalizedId) {
    throw new Error('Journal entity is missing an id');
  }
  const positionCandidate = candidate.position as
    | Partial<JournalEntity['position']>
    | undefined;
  const stateCandidate = (candidate as { state?: unknown }).state;
  return {
    id: normalizedId,
    type: typeof candidate.type === 'string' ? candidate.type : '',
    position: {
      x: Number.isFinite(positionCandidate?.x) ? Number(positionCandidate!.x) : 0,
      y: Number.isFinite(positionCandidate?.y) ? Number(positionCandidate!.y) : 0,
      z: Number.isFinite(positionCandidate?.z) ? Number(positionCandidate!.z) : 0,
    },
    state: stateCandidate ?? null,
  } satisfies JournalEntity;
}

function normalizeEntities(
  source:
    | Map<string, unknown>
    | Iterable<unknown>
    | Record<string, unknown>
    | Array<[string, unknown]>
    | undefined,
): Map<string, JournalEntity> {
  const result = new Map<string, JournalEntity>();
  if (!source) {
    return result;
  }
  if (source instanceof Map) {
    source.forEach((value, key) => {
      if (typeof key === 'string' && key.length > 0) {
        result.set(key, normalizeEntity(key, value));
      }
    });
    return result;
  }
  if (Array.isArray(source)) {
    source.forEach((entry) => {
      if (!entry) {
        return;
      }
      if (Array.isArray(entry) && entry.length >= 2) {
        const [id, value] = entry;
        if (typeof id === 'string' && id.length > 0) {
          result.set(id, normalizeEntity(id, value));
        }
        return;
      }
      if (typeof entry === 'object' && entry && 'id' in entry) {
        const rawId = (entry as { id?: unknown }).id;
        const id = typeof rawId === 'string' ? rawId : '';
        if (id.length > 0) {
          result.set(id, normalizeEntity(id, entry));
        }
      }
    });
    return result;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (key.length > 0) {
      result.set(key, normalizeEntity(key, value));
    }
  });
  return result;
}

function normalizeGrid(grid: ChunkJournalGrid): ChunkJournalState {
  if (!Number.isFinite(grid.sizeX) || !Number.isFinite(grid.sizeY) || !Number.isFinite(grid.sizeZ)) {
    throw new Error('Chunk journal grid requires finite dimensions');
  }
  const sizeX = Math.max(1, Math.floor(grid.sizeX));
  const sizeY = Math.max(1, Math.floor(grid.sizeY));
  const sizeZ = Math.max(1, Math.floor(grid.sizeZ));
  const expectedLength = sizeX * sizeY * sizeZ;
  const blocks =
    grid.blocks instanceof Uint16Array ? new Uint16Array(grid.blocks) : new Uint16Array(grid.blocks ?? []);
  if (blocks.length !== expectedLength) {
    if (blocks.length < expectedLength) {
      const resized = new Uint16Array(expectedLength);
      resized.set(blocks.subarray(0, expectedLength));
      return {
        sizeX,
        sizeY,
        sizeZ,
        blocks: resized,
        metadata: normalizeMetadata(grid.metadata),
        entities: normalizeEntities(grid.entities),
      } satisfies ChunkJournalState;
    }
    return {
      sizeX,
      sizeY,
      sizeZ,
      blocks: blocks.subarray(0, expectedLength),
      metadata: normalizeMetadata(grid.metadata),
      entities: normalizeEntities(grid.entities),
    } satisfies ChunkJournalState;
  }
  return {
    sizeX,
    sizeY,
    sizeZ,
    blocks,
    metadata: normalizeMetadata(grid.metadata),
    entities: normalizeEntities(grid.entities),
  } satisfies ChunkJournalState;
}

function linearIndex(x: number, y: number, z: number, sizeX: number, sizeY: number, sizeZ: number): number {
  if (x < 0 || x >= sizeX || y < 0 || y >= sizeY || z < 0 || z >= sizeZ) {
    return -1;
  }
  return x + sizeX * (y + sizeY * z);
}

export function encodeJournalOps(ops: Iterable<JournalOp>): Uint8Array {
  const writer = new ByteWriter();
  for (const op of ops) {
    if (!op) {
      continue;
    }
    writer.writeVarint(op.id);
    switch (op.id) {
      case JournalOpId.SET_BLOCKS_RLE: {
        const startIndex = Math.max(0, Math.floor(op.startIndex));
        writer.writeVarint(startIndex);
        const spans = Array.isArray(op.spans) ? op.spans : [];
        writer.writeVarint(spans.length);
        spans.forEach((span) => {
          const value = Math.max(0, Math.floor(span?.value ?? 0));
          const length = Math.max(0, Math.floor(span?.length ?? 0));
          writer.writeVarint(value);
          writer.writeVarint(length);
        });
        break;
      }
      case JournalOpId.BRUSH_SPHERE: {
        writer.writeSignedVarint(Math.trunc(op.center?.x ?? 0));
        writer.writeSignedVarint(Math.trunc(op.center?.y ?? 0));
        writer.writeSignedVarint(Math.trunc(op.center?.z ?? 0));
        writer.writeFloat32(Number.isFinite(op.radius) ? op.radius : 0);
        writer.writeVarint(Math.max(0, Math.floor(op.block ?? 0)));
        break;
      }
      case JournalOpId.VOXEL_RECT: {
        writer.writeSignedVarint(Math.trunc(op.origin?.x ?? 0));
        writer.writeSignedVarint(Math.trunc(op.origin?.y ?? 0));
        writer.writeSignedVarint(Math.trunc(op.origin?.z ?? 0));
        writer.writeVarint(Math.max(0, Math.floor(op.size?.x ?? 0)));
        writer.writeVarint(Math.max(0, Math.floor(op.size?.y ?? 0)));
        writer.writeVarint(Math.max(0, Math.floor(op.size?.z ?? 0)));
        writer.writeVarint(Math.max(0, Math.floor(op.block ?? 0)));
        break;
      }
      case JournalOpId.SET_META: {
        const key = typeof op.key === 'string' ? op.key : '';
        writer.writeString(key);
        const json = op.value === undefined ? 'null' : JSON.stringify(op.value) ?? 'null';
        writer.writeString(json);
        break;
      }
      case JournalOpId.PLACE_ENTITY: {
        const entity = cloneEntity(op.entity);
        writer.writeString(entity.id);
        writer.writeString(entity.type);
        writer.writeFloat32(entity.position.x);
        writer.writeFloat32(entity.position.y);
        writer.writeFloat32(entity.position.z);
        const stateJson = entity.state === undefined ? 'null' : JSON.stringify(entity.state) ?? 'null';
        writer.writeString(stateJson);
        break;
      }
      case JournalOpId.REMOVE_ENTITY: {
        const id = typeof op.entityId === 'string' ? op.entityId : '';
        writer.writeString(id);
        break;
      }
      default:
        throw new Error(`Unknown journal op id ${(op as JournalOp)?.id}`);
    }
  }
  return writer.toUint8Array();
}
export function decodeJournalOps(data: Uint8Array): JournalOp[] {
  const reader = new ByteReader(data);
  const ops: JournalOp[] = [];
  while (!reader.done) {
    const id = reader.readVarint();
    switch (id) {
      case JournalOpId.SET_BLOCKS_RLE: {
        const startIndex = reader.readVarint();
        const spanCount = reader.readVarint();
        const spans: JournalRleSpan[] = [];
        for (let i = 0; i < spanCount; i += 1) {
          const value = reader.readVarint();
          const length = reader.readVarint();
          spans.push({ value, length });
        }
        ops.push({ id, startIndex, spans });
        break;
      }
      case JournalOpId.BRUSH_SPHERE: {
        const x = reader.readSignedVarint();
        const y = reader.readSignedVarint();
        const z = reader.readSignedVarint();
        const radius = reader.readFloat32();
        const block = reader.readVarint();
        ops.push({ id, center: { x, y, z }, radius, block });
        break;
      }
      case JournalOpId.VOXEL_RECT: {
        const x = reader.readSignedVarint();
        const y = reader.readSignedVarint();
        const z = reader.readSignedVarint();
        const sizeX = reader.readVarint();
        const sizeY = reader.readVarint();
        const sizeZ = reader.readVarint();
        const block = reader.readVarint();
        ops.push({ id, origin: { x, y, z }, size: { x: sizeX, y: sizeY, z: sizeZ }, block });
        break;
      }
      case JournalOpId.SET_META: {
        const key = reader.readString();
        const json = reader.readString();
        const value = json.length > 0 ? JSON.parse(json) : null;
        ops.push({ id, key, value });
        break;
      }
      case JournalOpId.PLACE_ENTITY: {
        const entityId = reader.readString();
        const type = reader.readString();
        const x = reader.readFloat32();
        const y = reader.readFloat32();
        const z = reader.readFloat32();
        const json = reader.readString();
        const state = json.length > 0 ? JSON.parse(json) : null;
        ops.push({ id, entity: { id: entityId, type, position: { x, y, z }, state } });
        break;
      }
      case JournalOpId.REMOVE_ENTITY: {
        const entityId = reader.readString();
        ops.push({ id, entityId });
        break;
      }
      default:
        throw new Error(`Unknown journal op id ${id}`);
    }
  }
  return ops;
}

export function countJournalOps(data: Uint8Array): number {
  return decodeJournalOps(data).length;
}

function clampToVolume(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value >= max) {
    return max - 1;
  }
  return Math.floor(value);
}

export function applyJournalToGrid(grid: ChunkJournalGrid, operations: Iterable<JournalOp>): ChunkJournalState {
  const state = normalizeGrid(grid);
  const blocks = new Uint16Array(state.blocks);
  const metadata = { ...state.metadata };
  const entities = new Map<string, JournalEntity>();
  state.entities.forEach((entity, id) => {
    entities.set(id, cloneEntity(entity));
  });

  const { sizeX, sizeY, sizeZ } = state;
  const volume = sizeX * sizeY * sizeZ;

  for (const op of operations) {
    if (!op) {
      continue;
    }
    switch (op.id) {
      case JournalOpId.SET_BLOCKS_RLE: {
        let offset = Math.max(0, Math.floor(op.startIndex));
        for (const span of op.spans) {
          const value = Math.max(0, Math.floor(span.value ?? 0)) & 0xffff;
          const length = Math.max(0, Math.floor(span.length ?? 0));
          for (let i = 0; i < length; i += 1) {
            if (offset >= volume) {
              throw new RangeError('Journal RLE span exceeds chunk volume');
            }
            blocks[offset++] = value;
          }
        }
        break;
      }
      case JournalOpId.BRUSH_SPHERE: {
        const centerX = Math.trunc(op.center?.x ?? 0);
        const centerY = Math.trunc(op.center?.y ?? 0);
        const centerZ = Math.trunc(op.center?.z ?? 0);
        const radius = Math.max(0, Number.isFinite(op.radius) ? op.radius : 0);
        const blockValue = Math.max(0, Math.floor(op.block ?? 0)) & 0xffff;
        if (radius <= 0) {
          const index = linearIndex(centerX, centerY, centerZ, sizeX, sizeY, sizeZ);
          if (index >= 0) {
            blocks[index] = blockValue;
          }
          break;
        }
        const radiusSq = radius * radius;
        const minX = clampToVolume(Math.floor(centerX - radius), sizeX);
        const maxX = clampToVolume(Math.ceil(centerX + radius), sizeX);
        const minY = clampToVolume(Math.floor(centerY - radius), sizeY);
        const maxY = clampToVolume(Math.ceil(centerY + radius), sizeY);
        const minZ = clampToVolume(Math.floor(centerZ - radius), sizeZ);
        const maxZ = clampToVolume(Math.ceil(centerZ + radius), sizeZ);
        for (let z = minZ; z <= maxZ; z += 1) {
          const dz = z - centerZ;
          const dzSq = dz * dz;
          for (let y = minY; y <= maxY; y += 1) {
            const dy = y - centerY;
            const dySq = dy * dy;
            for (let x = minX; x <= maxX; x += 1) {
              const dx = x - centerX;
              const distanceSq = dx * dx + dySq + dzSq;
              if (distanceSq <= radiusSq) {
                const index = linearIndex(x, y, z, sizeX, sizeY, sizeZ);
                if (index >= 0) {
                  blocks[index] = blockValue;
                }
              }
            }
          }
        }
        break;
      }
      case JournalOpId.VOXEL_RECT: {
        const originX = Math.trunc(op.origin?.x ?? 0);
        const originY = Math.trunc(op.origin?.y ?? 0);
        const originZ = Math.trunc(op.origin?.z ?? 0);
        const sizeXSpan = Math.max(0, Math.floor(op.size?.x ?? 0));
        const sizeYSpan = Math.max(0, Math.floor(op.size?.y ?? 0));
        const sizeZSpan = Math.max(0, Math.floor(op.size?.z ?? 0));
        const blockValue = Math.max(0, Math.floor(op.block ?? 0)) & 0xffff;
        if (sizeXSpan <= 0 || sizeYSpan <= 0 || sizeZSpan <= 0) {
          break;
        }
        const minX = clampToVolume(originX, sizeX);
        const minY = clampToVolume(originY, sizeY);
        const minZ = clampToVolume(originZ, sizeZ);
        const maxX = clampToVolume(originX + sizeXSpan - 1, sizeX);
        const maxY = clampToVolume(originY + sizeYSpan - 1, sizeY);
        const maxZ = clampToVolume(originZ + sizeZSpan - 1, sizeZ);
        for (let z = minZ; z <= maxZ; z += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            let index = linearIndex(minX, y, z, sizeX, sizeY, sizeZ);
            if (index < 0) {
              continue;
            }
            for (let x = minX; x <= maxX; x += 1) {
              blocks[index] = blockValue;
              index += 1;
            }
          }
        }
        break;
      }
      case JournalOpId.SET_META: {
        const key = typeof op.key === 'string' ? op.key : '';
        if (!key) {
          break;
        }
        if (op.value === null) {
          delete metadata[key];
          break;
        }
        metadata[key] = op.value;
        break;
      }
      case JournalOpId.PLACE_ENTITY: {
        const entity = cloneEntity(op.entity);
        if (!entity.id) {
          throw new Error('Journal entity is missing an id');
        }
        entities.set(entity.id, entity);
        break;
      }
      case JournalOpId.REMOVE_ENTITY: {
        const id = typeof op.entityId === 'string' ? op.entityId : '';
        if (!id) {
          break;
        }
        entities.delete(id);
        break;
      }
      default:
        throw new Error(`Unknown journal op id ${(op as JournalOp)?.id}`);
    }
  }

  return {
    sizeX,
    sizeY,
    sizeZ,
    blocks,
    metadata,
    entities,
  } satisfies ChunkJournalState;
}

