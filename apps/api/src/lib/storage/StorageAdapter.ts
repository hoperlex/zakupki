import type { Readable } from 'node:stream';

/** Storage seam — LocalDiskStorage for MVP, S3Storage later (same `storageKey` semantics). */
export interface StorageAdapter {
  put(key: string, data: Buffer | Readable, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}
