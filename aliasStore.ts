/**
 * aliasStore.ts — the alias→id mapping shared by the opt-in remote-protocol
 * modules (`jsonblob.js`, `gist.js`).
 *
 * A USL `key` for those protocols is a *local alias* (`gist://prefs`), not the
 * real server-assigned id. The alias is resolved to an id here; the first write
 * to an unmapped alias creates the remote resource and records its id.
 *
 * Three back-ends, all keyed by a caller-supplied `keyFor(alias)` string:
 * - `'locationHash'` (default) — a `#key=id` pair written with
 *   `history.replaceState` (no Back-button entry, no `hashchange`). The pointer
 *   travels with the URL, so sharing the link shares the data.
 * - `'localStorage'` — per-origin, survives navigation, invisible in the URL.
 * - a custom `{ get, set, delete? }` object — anything else (in-memory, a
 *   server round-trip, …).
 */

/** Called per request; a truthy result becomes `Authorization: Bearer <token>`. */
export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

/** Maps a local alias to a server-assigned resource id. */
export interface IdStore {
    get(alias: string): string | null | undefined | Promise<string | null | undefined>;
    set(alias: string, id: string): void | Promise<void>;
    delete?(alias: string): void | Promise<void>;
}

export type IdStoreChoice = 'locationHash' | 'localStorage' | IdStore;

function readHashParams(): URLSearchParams {
    return new URLSearchParams(location.hash.replace(/^#/, ''));
}

function writeHashParams(params: URLSearchParams): void {
    const hash = params.toString();
    const url = `${location.pathname}${location.search}${hash ? '#' + hash : ''}`;
    history.replaceState(history.state, '', url);
}

export function locationHashStore(keyFor: (alias: string) => string): IdStore {
    return {
        get: (alias) => readHashParams().get(keyFor(alias)),
        set: (alias, id) => {
            const p = readHashParams();
            p.set(keyFor(alias), id);
            writeHashParams(p);
        },
        delete: (alias) => {
            const p = readHashParams();
            p.delete(keyFor(alias));
            writeHashParams(p);
        },
    };
}

export function localStorageStore(keyFor: (alias: string) => string): IdStore {
    return {
        get: (alias) => localStorage.getItem(keyFor(alias)),
        set: (alias, id) => localStorage.setItem(keyFor(alias), id),
        delete: (alias) => localStorage.removeItem(keyFor(alias)),
    };
}

/** Turn an {@link IdStoreChoice} (or `undefined` → `'locationHash'`) into an {@link IdStore}. */
export function resolveIdStore(choice: IdStoreChoice | undefined, keyFor: (alias: string) => string): IdStore {
    const c = choice ?? 'locationHash';
    if (c === 'locationHash') return locationHashStore(keyFor);
    if (c === 'localStorage') return localStorageStore(keyFor);
    return c;
}

/**
 * A tiny per-key serializer: `enqueue(k, task)` runs `task` after the previous
 * task queued under `k`, so a burst of writes to one alias does
 * read-modify-write in order instead of each reading the same snapshot and
 * clobbering the others. Cross-tab / cross-device writes still race — inherent
 * to the transport.
 */
export function makeQueue(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
    const queues = new Map<string, Promise<unknown>>();
    return <T>(key: string, task: () => Promise<T>): Promise<T> => {
        const prev = queues.get(key) ?? Promise.resolve();
        const next = prev.then(() => {}, () => {}).then(task);
        queues.set(key, next);
        next.then(() => {}, () => {}).then(() => {
            if (queues.get(key) === next) queues.delete(key);
        });
        return next;
    };
}
