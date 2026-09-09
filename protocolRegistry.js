const registry = new Map();
/**
 * Register a `read` handler and/or `write` handler for a protocol name, so that
 * `get()` / `set()` recognise a USL scheme beyond the built-in browser stores.
 * Called again with the same name, the given halves replace what was there.
 *
 * This is the seam the opt-in network modules (e.g. `gist.js`) use; the
 * default `protocols` bag is unaffected.
 */
export function registerProtocol(name, entry) {
    registry.set(name, { ...registry.get(name), ...entry });
}
export function getProtocolReader(name) {
    return registry.get(name)?.read;
}
export function getProtocolWriter(name) {
    return registry.get(name)?.write;
}
