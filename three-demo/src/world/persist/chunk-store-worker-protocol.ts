export const CHUNK_STORE_HANDSHAKE_REQUEST = 'chunkStoreHandshake';
export const CHUNK_STORE_HANDSHAKE_RESPONSE = 'chunkStoreHandshakeResult';

export interface ChunkStoreHandshakeRequest {
  type: typeof CHUNK_STORE_HANDSHAKE_REQUEST;
  supportsSharedArrayBuffer: boolean;
}

export interface ChunkStoreHandshakeResponse {
  type: typeof CHUNK_STORE_HANDSHAKE_RESPONSE;
  supportsSharedArrayBuffer: boolean;
}
