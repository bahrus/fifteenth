/**
 * jsonblob.ts — opt-in `jsonblob://` and `superjsonblob://` protocol support.
 *
 * Both services expose the same REST shape under `/api/jsonBlob`
 * (`POST` create, `GET` read, `PUT` replace, `DELETE`). This module is NOT part
 * of the default `protocols` bag — network latency, failure modes and auth are
 * unlike the browser stores. Turn it on explicitly:
 *
 * ```js
 * import { configureJsonBlob } from 'fifteenth/jsonblob.js';
 * import { get, set } from 'fifteenth';
 *
 * configureJsonBlob();                       // public hosts, hash id-store
 * await set('jsonblob://prefs?.theme', 'dark');
 * const theme = await get('jsonblob://prefs?.theme');
 * ```
 *
 * or, for use through assign-gingerly directly:
 *
 * ```js
 * import { jsonBlobProtocols } from 'fifteenth/jsonblob.js';
 * const protocols = { ...ambientProtocols, ...jsonBlobProtocols({ superjsonblob: { getToken } }) };
 * ```
 *
 * ### The `key` is a local alias, not the blob id
 *
 * `jsonblob://prefs` names a logical slot; the real server-assigned blob id is
 * looked up in an *id-store* (the URL hash by default, keyed
 * `jsonBlobID:<protocol>:<alias>`). The first `set` to an unmapped alias `POST`s
 * a new blob and records its id; later `set`s `PUT`. `get` on an unmapped alias
 * returns `null`. Prefix the key with `=` (`jsonblob://=<id>`) to address a blob
 * id directly and skip the id-store.
 *
 * ### CORS
 *
 * jsonblob.com sends `Access-Control-Allow-Origin: *` and exposes `Location` /
 * `X-jsonblob-id`, so it works from any browser origin. **superjsonblob.com
 * currently sends no CORS headers at all** — it is only reachable same-origin,
 * through a proxy, or from a non-browser runtime. Point `baseURL` at a
 * self-hosted instance you control if you need it from a browser.
 */
import { registerProtocol } from './protocolRegistry.js';
import { writeThroughObject } from './set.js';
import { resolveIdStore } from './aliasStore.js';
import type { IdStore, IdStoreChoice, TokenProvider } from './aliasStore.js';
import type { ProtocolHandler } from './ambient.js';

// Re-exported so existing `import ... from 'fifteenth/jsonblob.js'` keeps working.
export type { IdStore, TokenProvider };

const KNOWN = ['jsonblob', 'superjsonblob'] as const;
type ServiceName = (typeof KNOWN)[number];

const DEFAULT_BASE: Record<ServiceName, string> = {
    jsonblob: 'https://jsonblob.com',
    superjsonblob: 'https://superjsonblob.com',
};

export interface JsonBlobServiceConfig {
    /** Override the service origin (self-hosted instance, proxy). */
    baseURL?: string;
    /** Called per request; a truthy result becomes `Authorization: Bearer <token>`. */
    getToken?: TokenProvider;
    /** Where alias→id mappings live. Default `'locationHash'`. */
    idStore?: IdStoreChoice;
}

export interface JsonBlobConfig {
    jsonblob?: JsonBlobServiceConfig;
    superjsonblob?: JsonBlobServiceConfig;
}

// ---- id-store ----

function hashKey(service: ServiceName, alias: string): string {
    return `jsonBlobID:${service}:${alias}`;
}

function idStoreFor(service: ServiceName, cfg?: JsonBlobServiceConfig): IdStore {
    return resolveIdStore(cfg?.idStore, (alias) => hashKey(service, alias));
}

// ---- HTTP ----

interface Resolved {
    base: string;
    store: IdStore;
    getToken?: TokenProvider;
}

function resolveConfig(service: ServiceName, cfg?: JsonBlobServiceConfig): Resolved {
    return {
        base: (cfg?.baseURL ?? DEFAULT_BASE[service]).replace(/\/+$/, ''),
        store: idStoreFor(service, cfg),
        getToken: cfg?.getToken,
    };
}

async function headers(r: Resolved, body: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (body) h['Content-Type'] = 'application/json';
    const token = await r.getToken?.();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
}

/** `null` on 404, parsed JSON otherwise, throws on any other non-2xx. */
async function getBlob(r: Resolved, id: string): Promise<any> {
    const resp = await fetch(`${r.base}/api/jsonBlob/${encodeURIComponent(id)}`, {
        headers: await headers(r, false),
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`jsonblob GET ${id} → ${resp.status}`);
    return resp.json();
}

async function putBlob(r: Resolved, id: string, value: any): Promise<void> {
    const resp = await fetch(`${r.base}/api/jsonBlob/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: await headers(r, true),
        body: JSON.stringify(value),
    });
    if (!resp.ok) throw new Error(`jsonblob PUT ${id} → ${resp.status}`);
}

async function postBlob(r: Resolved, value: any): Promise<string> {
    const resp = await fetch(`${r.base}/api/jsonBlob`, {
        method: 'POST',
        headers: await headers(r, true),
        body: JSON.stringify(value),
    });
    if (!resp.ok) throw new Error(`jsonblob POST → ${resp.status}`);

    const location = resp.headers.get('Location');
    const fromLocation = location?.match(/\/api\/jsonBlob\/([^/?#]+)/)?.[1];
    if (fromLocation) return decodeURIComponent(fromLocation);

    const xId = resp.headers.get('X-jsonblob-id') ?? resp.headers.get('X-jsonblob');
    if (xId) return xId;

    const parsed = await resp.json().catch(() => null);
    if (parsed && typeof parsed.id === 'string') return parsed.id;

    throw new Error('jsonblob POST: could not determine new blob id (no readable Location / X-jsonblob-id / body id — CORS?)');
}

// ---- alias resolution ----

interface Addr {
    /** `null` when the key is a literal id. */
    alias: string | null;
    /** Set when the key is `=<id>`. */
    literalId: string | null;
}

function parseKey(key: string): Addr {
    if (key.startsWith('=')) return { alias: null, literalId: key.slice(1) };
    return { alias: key, literalId: null };
}

// ---- handler construction ----

function makeService(service: ServiceName, cfg?: JsonBlobServiceConfig) {
    const r = resolveConfig(service, cfg);
    const pendingCreate = new Map<string, Promise<string>>();

    // Serialize writes that target the same alias / id, so a burst of `set()`
    // calls in one tab does read-modify-write in order instead of racing (each
    // one would otherwise GET the same snapshot and clobber the others on PUT).
    // Cross-tab / cross-device writes still race — inherent to the transport.
    const writeQueues = new Map<string, Promise<unknown>>();
    function enqueue<T>(qk: string, task: () => Promise<T>): Promise<T> {
        const prev = writeQueues.get(qk) ?? Promise.resolve();
        const next = prev.then(() => {}, () => {}).then(task);
        writeQueues.set(qk, next);
        next.then(() => {}, () => {}).then(() => {
            if (writeQueues.get(qk) === next) writeQueues.delete(qk);
        });
        return next;
    }

    /** Existing id for `alias`, or POST a fresh blob seeded with `seed` and remember it. */
    async function ensureId(alias: string, seed: any): Promise<string> {
        const existing = await r.store.get(alias);
        if (existing) return existing;

        let p = pendingCreate.get(alias);
        if (!p) {
            p = (async () => {
                const id = await postBlob(r, seed);
                await r.store.set(alias, id);
                return id;
            })();
            pendingCreate.set(alias, p);
            p.catch(() => {}).finally(() => pendingCreate.delete(alias));
        }
        return p;
    }

    const read: ProtocolHandler = async (key: string) => {
        const { alias, literalId } = parseKey(key);
        const id = literalId ?? (await r.store.get(alias!)) ?? null;
        if (!id) return null;

        const value = await getBlob(r, id);
        if (value === null && literalId === null) {
            await r.store.delete?.(alias!);
        }
        return value;
    };

    const write = (key: string, chain: string[], val: any): Promise<void> => {
        const { alias, literalId } = parseKey(key);
        return enqueue(literalId ?? alias!, async () => {
            if (chain.length === 0) {
                if (literalId !== null) {
                    await putBlob(r, literalId, val);
                    return;
                }
                const existing = await r.store.get(alias!);
                if (existing) await putBlob(r, existing, val);
                else await ensureId(alias!, val); // seed the new blob with the value itself
                return;
            }

            const id = literalId ?? (await ensureId(alias!, {}));
            const current = await getBlob(r, id);
            await putBlob(r, id, writeThroughObject(current, chain, val));
        });
    };

    return { read, write };
}

// ---- public API ----

function serviceConfig(config: JsonBlobConfig | undefined, name: ServiceName): JsonBlobServiceConfig | undefined {
    return config?.[name];
}

/**
 * Build `{ jsonblob, superjsonblob }` read handlers for use with
 * assign-gingerly's `resolveValues` / `assignFrom` / `assignFromAsync`.
 * Pure — no global registration. Use {@link configureJsonBlob} for `get`/`set`.
 */
export function jsonBlobProtocols(config?: JsonBlobConfig): Record<ServiceName, ProtocolHandler> {
    const out = {} as Record<ServiceName, ProtocolHandler>;
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
export function configureJsonBlob(config?: JsonBlobConfig): Record<ServiceName, ProtocolHandler> {
    const out = {} as Record<ServiceName, ProtocolHandler>;
    for (const name of KNOWN) {
        const svc = makeService(name, serviceConfig(config, name));
        registerProtocol(name, svc);
        out[name] = svc.read;
    }
    return out;
}
