import { registerProtocol } from './protocolRegistry.js';
import { writeThroughObject } from './set.js';
const KNOWN = ['jsonblob', 'superjsonblob'];
const DEFAULT_BASE = {
    jsonblob: 'https://jsonblob.com',
    superjsonblob: 'https://superjsonblob.com',
};
// ---- id-stores ----
function hashKey(service, alias) {
    return `jsonBlobID:${service}:${alias}`;
}
function readHashParams() {
    return new URLSearchParams(location.hash.replace(/^#/, ''));
}
function writeHashParams(params) {
    const hash = params.toString();
    const url = `${location.pathname}${location.search}${hash ? '#' + hash : ''}`;
    history.replaceState(history.state, '', url);
}
function locationHashStore(service) {
    return {
        get: (alias) => readHashParams().get(hashKey(service, alias)),
        set: (alias, id) => {
            const p = readHashParams();
            p.set(hashKey(service, alias), id);
            writeHashParams(p);
        },
        delete: (alias) => {
            const p = readHashParams();
            p.delete(hashKey(service, alias));
            writeHashParams(p);
        },
    };
}
function localStorageStore(service) {
    return {
        get: (alias) => localStorage.getItem(hashKey(service, alias)),
        set: (alias, id) => localStorage.setItem(hashKey(service, alias), id),
        delete: (alias) => localStorage.removeItem(hashKey(service, alias)),
    };
}
function resolveIdStore(service, cfg) {
    const choice = cfg?.idStore ?? 'locationHash';
    if (choice === 'locationHash')
        return locationHashStore(service);
    if (choice === 'localStorage')
        return localStorageStore(service);
    return choice;
}
function resolveConfig(service, cfg) {
    return {
        base: (cfg?.baseURL ?? DEFAULT_BASE[service]).replace(/\/+$/, ''),
        store: resolveIdStore(service, cfg),
        getToken: cfg?.getToken,
    };
}
async function headers(r, body) {
    const h = { Accept: 'application/json' };
    if (body)
        h['Content-Type'] = 'application/json';
    const token = await r.getToken?.();
    if (token)
        h['Authorization'] = `Bearer ${token}`;
    return h;
}
/** `null` on 404, parsed JSON otherwise, throws on any other non-2xx. */
async function getBlob(r, id) {
    const resp = await fetch(`${r.base}/api/jsonBlob/${encodeURIComponent(id)}`, {
        headers: await headers(r, false),
    });
    if (resp.status === 404)
        return null;
    if (!resp.ok)
        throw new Error(`jsonblob GET ${id} → ${resp.status}`);
    return resp.json();
}
async function putBlob(r, id, value) {
    const resp = await fetch(`${r.base}/api/jsonBlob/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: await headers(r, true),
        body: JSON.stringify(value),
    });
    if (!resp.ok)
        throw new Error(`jsonblob PUT ${id} → ${resp.status}`);
}
async function postBlob(r, value) {
    const resp = await fetch(`${r.base}/api/jsonBlob`, {
        method: 'POST',
        headers: await headers(r, true),
        body: JSON.stringify(value),
    });
    if (!resp.ok)
        throw new Error(`jsonblob POST → ${resp.status}`);
    const location = resp.headers.get('Location');
    const fromLocation = location?.match(/\/api\/jsonBlob\/([^/?#]+)/)?.[1];
    if (fromLocation)
        return decodeURIComponent(fromLocation);
    const xId = resp.headers.get('X-jsonblob-id') ?? resp.headers.get('X-jsonblob');
    if (xId)
        return xId;
    const parsed = await resp.json().catch(() => null);
    if (parsed && typeof parsed.id === 'string')
        return parsed.id;
    throw new Error('jsonblob POST: could not determine new blob id (no readable Location / X-jsonblob-id / body id — CORS?)');
}
function parseKey(key) {
    if (key.startsWith('='))
        return { alias: null, literalId: key.slice(1) };
    return { alias: key, literalId: null };
}
// ---- handler construction ----
function makeService(service, cfg) {
    const r = resolveConfig(service, cfg);
    const pendingCreate = new Map();
    // Serialize writes that target the same alias / id, so a burst of `set()`
    // calls in one tab does read-modify-write in order instead of racing (each
    // one would otherwise GET the same snapshot and clobber the others on PUT).
    // Cross-tab / cross-device writes still race — inherent to the transport.
    const writeQueues = new Map();
    function enqueue(qk, task) {
        const prev = writeQueues.get(qk) ?? Promise.resolve();
        const next = prev.then(() => { }, () => { }).then(task);
        writeQueues.set(qk, next);
        next.then(() => { }, () => { }).then(() => {
            if (writeQueues.get(qk) === next)
                writeQueues.delete(qk);
        });
        return next;
    }
    /** Existing id for `alias`, or POST a fresh blob seeded with `seed` and remember it. */
    async function ensureId(alias, seed) {
        const existing = await r.store.get(alias);
        if (existing)
            return existing;
        let p = pendingCreate.get(alias);
        if (!p) {
            p = (async () => {
                const id = await postBlob(r, seed);
                await r.store.set(alias, id);
                return id;
            })();
            pendingCreate.set(alias, p);
            p.catch(() => { }).finally(() => pendingCreate.delete(alias));
        }
        return p;
    }
    const read = async (key) => {
        const { alias, literalId } = parseKey(key);
        const id = literalId ?? (await r.store.get(alias)) ?? null;
        if (!id)
            return null;
        const value = await getBlob(r, id);
        if (value === null && literalId === null) {
            await r.store.delete?.(alias);
        }
        return value;
    };
    const write = (key, chain, val) => {
        const { alias, literalId } = parseKey(key);
        return enqueue(literalId ?? alias, async () => {
            if (chain.length === 0) {
                if (literalId !== null) {
                    await putBlob(r, literalId, val);
                    return;
                }
                const existing = await r.store.get(alias);
                if (existing)
                    await putBlob(r, existing, val);
                else
                    await ensureId(alias, val); // seed the new blob with the value itself
                return;
            }
            const id = literalId ?? (await ensureId(alias, {}));
            const current = await getBlob(r, id);
            await putBlob(r, id, writeThroughObject(current, chain, val));
        });
    };
    return { read, write };
}
// ---- public API ----
function serviceConfig(config, name) {
    return config?.[name];
}
/**
 * Build `{ jsonblob, superjsonblob }` read handlers for use with
 * assign-gingerly's `resolveValues` / `assignFrom` / `assignFromAsync`.
 * Pure — no global registration. Use {@link configureJsonBlob} for `get`/`set`.
 */
export function jsonBlobProtocols(config) {
    const out = {};
    for (const name of KNOWN) {
        out[name] = makeService(name, serviceConfig(config, name)).read;
    }
    return out;
}
/**
 * Register `jsonblob://` and `superjsonblob://` with `get()` / `set()`, using
 * `config` (all fields optional; omitted → public hosts + URL-hash id-store).
 * Call again to reconfigure. Returns the same read bag {@link jsonBlobProtocols}
 * produces.
 */
export function configureJsonBlob(config) {
    const out = {};
    for (const name of KNOWN) {
        const svc = makeService(name, serviceConfig(config, name));
        registerProtocol(name, svc);
        out[name] = svc.read;
    }
    return out;
}
