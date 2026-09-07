/**
 * fifteenth — protocol handlers for the USL grammar, wired for assign-gingerly.
 *
 * - `protocols` — the drop-in bag for assign-gingerly's resolveValues /
 *   assignFrom / assignFromAsync.
 * - `get` — convenience one-time pull of a single USL.
 * - `set` — one-time push of a single USL, with change broadcast.
 * - `IDBObjectStore` — the minimal IndexedDB object-mode wrapper.
 */
export { protocols } from './protocols.js';
export type { ProtocolHandler, ProtocolHandlers } from './ambient.js';
export { ambientProtocols } from './ambient.js';
export { get } from './get.js';
export { set } from './set.js';
export type { SavingContext } from './set.js';
export { IDBObjectStore, indexedDBHandler } from './idb.js';
export { registerProtocol } from './protocolRegistry.js';
export type { ProtocolWriter } from './protocolRegistry.js';
export { jsonBlobProtocols, configureJsonBlob } from './jsonblob.js';
export type { JsonBlobConfig, JsonBlobServiceConfig } from './jsonblob.js';
export { gistProtocols, configureGist } from './gist.js';
export type { GistConfig } from './gist.js';
export type { IdStore, IdStoreChoice, TokenProvider } from './aliasStore.js';
