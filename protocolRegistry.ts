import type { ProtocolHandler } from './ambient.js';

/**
 * Writes the value produced by a `set()` call into a protocol's backing store.
 *
 * Receives the same `(key, chain, val)` triple the built-in writers in `set.ts`
 * use — `key` is the text between `://` and the first `?.`, `chain` is the `?.`
 * accessor path already split into segments (`[]` when there is none). The
 * change broadcast is still emitted by `set()` itself, so a writer only has to
 * persist.
 */
export type ProtocolWriter = (key: string, chain: string[], val: any) => void | Promise<void>;

interface Entry {
    read?: ProtocolHandler;
    write?: ProtocolWriter;
}

const registry = new Map<string, Entry>();

/**
 * Register a `read` handler and/or `write` handler for a protocol name, so that
 * `get()` / `set()` recognise a USL scheme beyond the built-in browser stores.
 * Called again with the same name, the given halves replace what was there.
 *
 * This is the seam the opt-in network modules (e.g. `gist.js`) use; the
 * default `protocols` bag is unaffected.
 */
export function registerProtocol(name: string, entry: Entry): void {
    registry.set(name, { ...registry.get(name), ...entry });
}

export function getProtocolReader(name: string): ProtocolHandler | undefined {
    return registry.get(name)?.read;
}

export function getProtocolWriter(name: string): ProtocolWriter | undefined {
    return registry.get(name)?.write;
}
