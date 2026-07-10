import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** Opaque URL-safe random token (for refresh tokens, invite links, reset links). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newUuid(): string {
  return randomUUID();
}
