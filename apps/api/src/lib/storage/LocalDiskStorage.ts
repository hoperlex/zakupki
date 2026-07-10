import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageAdapter } from './StorageAdapter';

export class LocalDiskStorage implements StorageAdapter {
  constructor(private root: string) {}

  private full(key: string): string {
    // prevent path traversal
    const target = resolve(this.root, key);
    if (!target.startsWith(resolve(this.root))) {
      throw new Error('Invalid storage key');
    }
    return target;
  }

  async put(key: string, data: Buffer | Readable, _contentType: string): Promise<void> {
    const path = this.full(key);
    await mkdir(dirname(path), { recursive: true });
    if (Buffer.isBuffer(data)) {
      await writeFile(path, data);
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of data) chunks.push(chunk as Buffer);
      await writeFile(path, Buffer.concat(chunks));
    }
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.full(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.full(key), { force: true });
  }
}

export function buildStorageKey(ownerType: string, ownerId: string, filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return join(`${ownerType}s`, ownerId, `${crypto.randomUUID()}${ext}`);
}
