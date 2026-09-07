/**
 * gist.ts — opt-in `gist://` protocol support: a GitHub Gist as a JSON store.
 *
 * A gist is a small, git-versioned bundle of named files. This module treats
 * **one file inside a gist** as a JSON document and maps the USL grammar onto
 * the GitHub REST API (`api.github.com/gists`). Not part of the default
 * `protocols` bag — turn it on explicitly:
 *
 * ```js
 * import { configureGist } from 'fifteenth/gist.js';
 * import { get, set } from 'fifteenth';
 *
 * configureGist({ getToken: () => localStorage.getItem('ghGistToken') });
 *
 * await set('gist://prefs?.theme', 'dark');   // creates a secret gist the first time
 * const theme = await get('gist://prefs?.theme');
 * ```
 *
 * ### Addressing: `gist://<alias>[/<file>]`
 *
 * `<alias>` is a *local* name, not the gist id — the real id lives in an
 * id-store (the URL hash by default, keyed `gistID:<alias>`). The first `set`
 * to an unmapped alias `POST`s a new gist and records its id; later `set`s
 * `PATCH`. `<file>` selects the file inside the gist, defaulting to
 * `data.json`. Prefix the alias with `=` (`gist://=<id>/data.json`) to address
 * a gist id directly and skip the id-store.
 *
 * ### Auth
 *
 * Reads of a public gist need no token. **Creating or updating a gist needs a
 * GitHub token with the `gist` scope** — a fine-grained PAT with the *Gists:
 * Read and write* account permission, or a classic PAT with the `gist` scope.
 * Supply it via `getToken` (called per request; may be async). GitHub's REST
 * API sends `Access-Control-Allow-Origin: *` and allows `Authorization`, so
 * this works from any browser origin with no proxy. The one thing a browser
 * cannot do cross-origin is the OAuth `code`→token exchange
 * (`github.com/login/oauth/access_token` sends no CORS header); a pasted PAT
 * sidesteps that entirely.
 *
 * ### Notes
 *
 * - A "secret" gist is unlisted, not private — anyone with the id can read it.
 * - GitHub can't merge one JSON key server-side, so an accessor-chain write is
 *   read-modify-write (`GET` gist → merge the file → `PATCH`), same semantics
 *   as the other stores. Concurrent writes in one tab are serialized per alias.
 * - Rate limit: 5000 requests/hour (authenticated).
 */
import { registerProtocol } from './protocolRegistry.js';
import { writeThroughObject } from './set.js';
import { resolveIdStore, makeQueue } from './aliasStore.js';
const DEFAULT_BASE = 'https://api.github.com';
const DEFAULT_FILE = 'data.json';
function hashKey(alias) {
    return `gistID:${alias}`;
}
function resolveConfig(cfg) {
    return {
        base: (cfg?.baseURL ?? DEFAULT_BASE).replace(/\/+$/, ''),
        store: resolveIdStore(cfg?.idStore, hashKey),
        getToken: cfg?.getToken,
        public: cfg?.public ?? false,
        defaultFile: cfg?.defaultFile ?? DEFAULT_FILE,
        description: cfg?.description,
    };
}
// ---- HTTP ----
async function ghHeaders(r, body) {
    const h = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body)
        h['Content-Type'] = 'application/json';
    const token = await r.getToken?.();
    if (token)
        h['Authorization'] = `Bearer ${token}`;
    return h;
}
async function briefBody(resp) {
    try {
        const t = (await resp.text()).replace(/\s+/g, ' ').trim();
        return t ? ` — ${t.slice(0, 200)}` : '';
    }
    catch {
        return '';
    }
}
function serialize(value) {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
/** The whole gist object, or `null` on 404 (gist absent / purged). */
async function fetchGist(r, id) {
    const resp = await fetch(`${r.base}/gists/${encodeURIComponent(id)}`, {
        headers: await ghHeaders(r, false),
    });
    if (resp.status === 404)
        return null;
    if (!resp.ok)
        throw new Error(`gist GET ${id} → ${resp.status}${await briefBody(resp)}`);
    return resp.json();
}
/** Parsed JSON of one file within an already-fetched gist; `null` if the file is absent/empty. */
async function fileValue(r, gist, file) {
    const entry = gist?.files?.[file];
    if (!entry)
        return null;
    let content = entry.content ?? '';
    if (entry.truncated && entry.raw_url) {
        const raw = await fetch(entry.raw_url, { headers: await ghHeaders(r, false) });
        if (!raw.ok)
            throw new Error(`gist raw ${file} → ${raw.status}`);
        content = await raw.text();
    }
    if (content === '')
        return null;
    try {
        return JSON.parse(content);
    }
    catch {
        return content; // tolerate a non-JSON file, same as the web-storage handler
    }
}
async function patchGist(r, id, file, value) {
    const resp = await fetch(`${r.base}/gists/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: await ghHeaders(r, true),
        body: JSON.stringify({ files: { [file]: { content: serialize(value) } } }),
    });
    if (!resp.ok)
        throw new Error(`gist PATCH ${id} → ${resp.status}${await briefBody(resp)}` + authHint(resp.status));
}
async function createGist(r, file, value) {
    const resp = await fetch(`${r.base}/gists`, {
        method: 'POST',
        headers: await ghHeaders(r, true),
        body: JSON.stringify({
            ...(r.description !== undefined ? { description: r.description } : {}),
            public: r.public,
            files: { [file]: { content: serialize(value) } },
        }),
    });
    if (!resp.ok)
        throw new Error(`gist POST → ${resp.status}${await briefBody(resp)}` + authHint(resp.status));
    const parsed = await resp.json().catch(() => null);
    if (parsed && typeof parsed.id === 'string')
        return parsed.id;
    const loc = resp.headers.get('Location');
    const fromLoc = loc?.match(/\/gists\/([^/?#]+)/)?.[1];
    if (fromLoc)
        return fromLoc;
    throw new Error('gist POST: could not determine the new gist id from the response');
}
function authHint(status) {
    return status === 401 || status === 403
        ? ' (a GitHub token with the "gist" scope is required to write a gist — set config.getToken)'
        : '';
}
function parseKey(key, defaultFile) {
    const slash = key.indexOf('/');
    const head = slash === -1 ? key : key.slice(0, slash);
    const file = slash === -1 ? defaultFile : key.slice(slash + 1) || defaultFile;
    if (head.startsWith('='))
        return { alias: null, literalId: head.slice(1), file };
    return { alias: head, literalId: null, file };
}
// ---- handler construction ----
function makeGist(cfg) {
    const r = resolveConfig(cfg);
    const pendingCreate = new Map();
    const enqueue = makeQueue();
    /** Existing gist id for `alias`, or create one seeded with `seed` and remember it. */
    async function ensureId(alias, file, seed) {
        const existing = await r.store.get(alias);
        if (existing)
            return existing;
        let p = pendingCreate.get(alias);
        if (!p) {
            p = (async () => {
                const id = await createGist(r, file, seed);
                await r.store.set(alias, id);
                return id;
            })();
            pendingCreate.set(alias, p);
            p.catch(() => { }).finally(() => pendingCreate.delete(alias));
        }
        return p;
    }
    const read = async (key) => {
        const { alias, literalId, file } = parseKey(key, r.defaultFile);
        const id = literalId ?? (await r.store.get(alias)) ?? null;
        if (!id)
            return null;
        const gist = await fetchGist(r, id);
        if (gist === null) {
            if (literalId === null)
                await r.store.delete?.(alias); // purged → drop stale mapping
            return null;
        }
        return fileValue(r, gist, file);
    };
    const write = (key, chain, val) => {
        const { alias, literalId, file } = parseKey(key, r.defaultFile);
        return enqueue(literalId ?? alias, async () => {
            if (chain.length === 0) {
                if (literalId !== null) {
                    await patchGist(r, literalId, file, val);
                    return;
                }
                const existing = await r.store.get(alias);
                if (existing)
                    await patchGist(r, existing, file, val);
                else
                    await ensureId(alias, file, val); // seed the new gist file with the value
                return;
            }
            const id = literalId ?? (await ensureId(alias, file, {}));
            const gist = await fetchGist(r, id);
            const current = gist ? await fileValue(r, gist, file) : null;
            await patchGist(r, id, file, writeThroughObject(current, chain, val));
        });
    };
    return { read, write };
}
// ---- public API ----
/**
 * Build a `{ gist }` read handler for assign-gingerly's `resolveValues` /
 * `assignFrom` / `assignFromAsync`. Pure — no global registration. Use
 * {@link configureGist} for `get`/`set`.
 */
export function gistProtocols(config) {
    return { gist: makeGist(config).read };
}
/**
 * Register `gist://` with `get()` / `set()`, using `config` (all fields
 * optional; `getToken` is needed for writes). Call again to reconfigure.
 * Returns the same read bag {@link gistProtocols} produces.
 */
export function configureGist(config) {
    const svc = makeGist(config);
    registerProtocol('gist', svc);
    return { gist: svc.read };
}
