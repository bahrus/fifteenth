import { parseProtocolRef } from 'assign-gingerly/resolve/getValues.js';
import { IDBObjectStore } from './idb.js';
import { getProtocolWriter } from './protocolRegistry.js';
/**
 * Walk `parts` from `root`, creating a plain object at any segment that is
 * missing or not an object, and return the container plus the final key so the
 * caller can assign into it.
 *
 * Mirrors assign-gingerly's create-on-write path semantics: an existing
 * intermediate object is descended into, never replaced; only an exact
 * full-path match is overwritten.
 */
function evaluatePath(root, parts) {
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === null || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    return { target: current, lastKey: parts[parts.length - 1] };
}
/** Split a `parseProtocolRef` path (`?.a?.b`, or `null`) into `['a','b']` / `[]`. */
function chainParts(path) {
    return path ? path.split('?.').filter(Boolean) : [];
}
/**
 * Broadcast (or, with a context, record) that `usp` — and, when it differs, the
 * exact `usl` — has changed.
 */
function notify(usp, usl, ctx) {
    const msgs = usp === usl ? [usp] : [usp, usl];
    if (ctx !== undefined) {
        for (const m of msgs)
            ctx.usls.add(m);
    }
    else {
        window.postMessage(msgs);
    }
}
/**
 * Merge `val` into the object read from `read()` at `parts`, and hand the whole
 * (possibly newly created) root back to `write()`. Shared by the stores that
 * hold structured values (Web Storage, IndexedDB) and by the registered network
 * writers (`jsonblob.js`). `parts` must be non-empty.
 */
export function writeThroughObject(current, parts, val) {
    const root = current !== null && typeof current === 'object' ? current : {};
    const { target, lastKey } = evaluatePath(root, parts);
    target[lastKey] = val;
    return root;
}
function setWebStorage(store, key, parts, val) {
    if (parts.length === 0) {
        store.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        return;
    }
    const raw = store.getItem(key);
    let current = null;
    if (raw !== null) {
        try {
            current = JSON.parse(raw);
        }
        catch {
            current = null;
        }
    }
    store.setItem(key, JSON.stringify(writeThroughObject(current, parts, val)));
}
function setCookie(name, val) {
    const encoded = encodeURIComponent(typeof val === 'string' ? val : JSON.stringify(val));
    document.cookie = `${encodeURIComponent(name)}=${encoded}; path=/`;
}
function setHash(key, val) {
    const params = new URLSearchParams(location.hash.slice(1));
    params.set(key, typeof val === 'string' ? val : JSON.stringify(val));
    location.hash = params.toString();
}
async function setIndexedDB(key, parts, val) {
    const [dbName, storeName, propName] = key.split('/');
    if (!dbName || !storeName || !propName) {
        throw new Error(`indexedDB key requires "dbName/storeName/key", got "${key}"`);
    }
    const store = new IDBObjectStore(dbName, storeName);
    await store.open();
    try {
        if (parts.length === 0) {
            await store.put(propName, val);
        }
        else {
            const current = await store.get(propName);
            await store.put(propName, writeThroughObject(current, parts, val));
        }
    }
    finally {
        store.close();
    }
}
/**
 * One-time push of a single resource addressed by a USL string.
 *
 * ```js
 * await set('indexedDB://myDB/myStore/myKey?.address?.zip', '90210');
 * ```
 *
 * The outer grammar is split by assign-gingerly's `parseProtocolRef`. When the
 * USL carries a `?.` accessor chain the stored value is read, the chain is
 * merged into it — intermediate objects are created where missing and left
 * untouched where they already exist, only the exact leaf is overwritten — and
 * the whole object is written back. Without a chain, `val` is stored as-is.
 *
 * On completion it broadcasts `window.postMessage([usp])` — or `[usp, usl]` when
 * an accessor chain was used — so subscribers keyed on either string can react.
 * Pass a {@link SavingContext} to collect those strings for a batched broadcast
 * instead.
 *
 * `cookie` and `locationHash` hold plain strings and reject an accessor chain.
 * Protocols registered via `registerProtocol` (e.g. `jsonblob://` after
 * `configureJsonBlob()`) are dispatched to their writer before the built-ins.
 */
export async function set(usl, val, ctx) {
    const { protocol, key, path } = parseProtocolRef(usl);
    const parts = chainParts(path);
    const registered = getProtocolWriter(protocol);
    if (registered !== undefined) {
        await registered(key, parts, val);
        notify(`${protocol}://${key}`, usl, ctx);
        return;
    }
    switch (protocol) {
        case 'globalThis': {
            const allParts = key.split('/').filter(Boolean).concat(parts);
            const { target, lastKey } = evaluatePath(globalThis, allParts);
            target[lastKey] = val;
            break;
        }
        case 'localStorage':
            setWebStorage(localStorage, key, parts, val);
            break;
        case 'sessionStorage':
            setWebStorage(sessionStorage, key, parts, val);
            break;
        case 'cookie':
            if (parts.length > 0)
                throw new Error(`cookie protocol does not support an accessor chain: "${usl}"`);
            setCookie(key, val);
            break;
        case 'locationHash':
            if (parts.length > 0)
                throw new Error(`locationHash protocol does not support an accessor chain: "${usl}"`);
            setHash(key, val);
            break;
        case 'indexedDB':
            await setIndexedDB(key, parts, val);
            break;
        default:
            throw new Error(`Unsupported protocol "${protocol}" in "${usl}"`);
    }
    const usp = `${protocol}://${key}`;
    notify(usp, usl, ctx);
}
