/**
 * protocols.ts — the ready-made protocol bag for assign-gingerly.
 *
 * This is the package's primary integration point. Hand it to assign-gingerly's
 * `resolveValues` / `assignFrom` / `assignFromAsync` and USL strings resolve
 * against browser storage:
 *
 * ```js
 * import { protocols } from 'fifteenth/protocols.js';
 * import { assignFromAsync } from 'assign-gingerly/assignFromAsync.js';
 *
 * await assignFromAsync(target, {
 *     zip:   'indexedDB://addressDB/byUser/current?.address?.zip',
 *     theme: 'localStorage://prefs?.theme',
 * }, { from: {}, protocols });
 * ```
 *
 * assign-gingerly owns the outer USL grammar (the `protocol://` split and the
 * `?.` accessor chain); this bag only supplies the per-protocol key handlers.
 */
import { ambientProtocols } from './ambient.js';
import { indexedDBHandler } from './idb.js';
export const protocols = {
    ...ambientProtocols,
    indexedDB: indexedDBHandler,
};
