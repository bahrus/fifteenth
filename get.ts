import { parseProtocolRef, getValue } from 'assign-gingerly/resolve/getValues.js';
import { protocols } from './protocols.js';
import { getProtocolReader } from './protocolRegistry.js';

/**
 * One-time pull of a single resource addressed by a USL string.
 *
 * ```js
 * const zip = await get('indexedDB://myDB/myStore/myKey?.address?.zip');
 * ```
 *
 * This is a thin convenience wrapper over the same pieces `assignFromAsync`
 * uses: `parseProtocolRef` splits the outer grammar, the {@link protocols} bag
 * resolves the key, and `getValue` walks the trailing `?.` accessor chain — so
 * a single USL and a whole pattern object resolve through exactly one code path.
 * Protocols registered via `registerProtocol` (e.g. `gist://` after
 * `configureGist()`) are consulted when the bag has no handler.
 *
 * Returns `null` when the resource (or any link in the accessor chain) is absent.
 */
export async function get(usl: string): Promise<any> {
    const { protocol, key, path } = parseProtocolRef(usl);
    const handler = (protocols as Record<string, ((key: string) => unknown) | undefined>)[protocol]
        ?? getProtocolReader(protocol);
    if (!handler) throw new Error(`Unsupported protocol "${protocol}" in "${usl}"`);

    const base = await handler(key);
    if (base == null) return null;
    if (!path) return base;

    const resolved = getValue(path, base);
    return resolved ?? null;
}
