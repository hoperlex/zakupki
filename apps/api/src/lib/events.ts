import { EventEmitter } from 'node:events';

/**
 * In-process typed event bus (single-node MVP). Swap for Redis pub/sub when scaling out.
 * Events carry only "tender X changed" — each SSE connection re-derives its own view.
 */
export type BusEvent =
  | { kind: 'tender:changed'; tenderId: string; reason: 'bid' | 'deadline' | 'status' };

class Bus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  emitTenderChanged(tenderId: string, reason: 'bid' | 'deadline' | 'status'): void {
    this.emitter.emit(`tender:${tenderId}`, { kind: 'tender:changed', tenderId, reason } as BusEvent);
  }
  onTender(tenderId: string, handler: (e: BusEvent) => void): () => void {
    const channel = `tender:${tenderId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

export const bus = new Bus();
