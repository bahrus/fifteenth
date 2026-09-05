/**
 * fifteenth — protocol handlers for the USL grammar, wired for assign-gingerly.
 *
 * - `protocols` — the drop-in bag for assign-gingerly's resolveValues /
 *   assignFrom / assignFromAsync.
 * - `get` — convenience one-time pull of a single USL.
 * - `IDBObjectStore` — the minimal IndexedDB object-mode wrapper.
 */
export { protocols } from './protocols.js';
export type { ProtocolHandler, ProtocolHandlers } from './ambient.js';
export { ambientProtocols } from './ambient.js';
export { get } from './get.js';
export { IDBObjectStore, indexedDBHandler } from './idb.js';
