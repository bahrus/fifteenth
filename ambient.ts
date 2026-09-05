/**
 * ambient.ts — synchronous protocol handlers for the "trivial" browser stores.
 *
 * Each handler receives only the *key* portion of a USL — the text between
 * `://` and the first `?.` — exactly as assign-gingerly's `resolveValues` /
 * `assignFrom` hand it over. The outer USL grammar (protocol split, `?.`
 * accessor chain) is owned by assign-gingerly; the `?.` chain is resolved by
 * assign-gingerly against whatever the handler returns, so these handlers only
 * have to turn a key into a base value.
 *
 * The one store that needs real async work — IndexedDB — lives in ./idb.ts.
 */

/** A protocol handler resolves a USL key to a value. May be sync or async. */
export type ProtocolHandler = (key: string) => unknown | Promise<unknown>;

/** Map of protocol name (text before `://`) to a handler. */
export type ProtocolHandlers = Record<string, ProtocolHandler>;

/**
 * Walk a `/`-separated key as a property chain on a root object.
 * Returns `null` as soon as an intermediate value is nullish.
 */
function walk(root: unknown, key: string): unknown {
    let current: any = root;
    for (const part of key.split('/')) {
        if (part === '') continue;
        if (current == null) return null;
        current = current[part];
    }
    return current ?? null;
}

/**
 * Read a raw string out of Web Storage, JSON-parsing it when possible so
 * `localStorage://k?.sub` chains work. Falls back to the raw string.
 */
function readWebStorage(store: Storage, key: string): unknown {
    const raw = store.getItem(key);
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** Read a cookie value by name, URL-decoded. `null` when absent. */
function readCookie(name: string): string | null {
    const escaped = name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

/** Read a value from `location.hash`, treated as `#key1=value1&key2=value2`. */
function readHash(key: string): string | null {
    const hash = location.hash.slice(1);
    if (!hash) return null;
    return new URLSearchParams(hash).get(key) ?? null;
}

/**
 * The ambient (no-setup, synchronous) protocol handlers. Spread into the
 * combined bag in ./protocols.ts; also usable on their own with
 * `getValues` / `assignFrom` when every protocol in play is synchronous.
 */
export const ambientProtocols: ProtocolHandlers = {
    globalThis: (key) => walk(globalThis, key),
    localStorage: (key) => readWebStorage(localStorage, key),
    sessionStorage: (key) => readWebStorage(sessionStorage, key),
    cookie: (key) => readCookie(key),
    locationHash: (key) => readHash(key),
};
