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
 * ### Raw form: `gist://<owner>/<id>/raw[/<sha>]/<file>`
 *
 * The tail of a `gist.githubusercontent.com` URL, addressed directly. **Reads**
 * hit that CDN (`https://gist.githubusercontent.com/<owner>/<id>/raw[/<sha>]/<file>`)
 * — no token, no `/gists` JSON envelope, no 5000/h API rate limit, and a `<sha>`
 * pins an immutable revision. **Writes** without a `<sha>` `PATCH` the gist
 * through the API as usual (needs `getToken`); a write to a pinned `<sha>`
 * throws. `configureGist({ rawBaseURL })` overrides the CDN origin. This is the
 * shape a future import-map bare specifier (`<owner>/<id>/raw/<sha>/<file>`)
 * would resolve to.
 *
 * ### Reading an alias / id via the CDN: `configureGist({ readVia: 'raw' })`
 *
 * Makes the ordinary alias reads fetch `gist.githubusercontent.com/<owner>/<id>/raw/<file>`
 * instead of `GET api.github.com/gists/<id>`. Same win as the raw form (no
 * token, no rate limit), and it *is* the owner-qualified URL: the id-store
 * remembers `owner/id` (the owner comes free on the response of the `POST` that
 * created the gist), not just `id`. A mapping from before this existed, or one
 * this instance never created, has no owner on file yet — the very next
 * `readVia:'raw'` read for it does one `GET /gists/<id>` to learn `owner.login`,
 * records it, and every read after that (including a page reload) uses the
 * pretty CDN url. A bare id with truly no discoverable owner falls back to the
 * owner-less `…/raw/<id>/<file>` form, which GitHub also serves. Writes are
 * unaffected — always the API. Default `'api'`.
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
 * - A gist file cannot be empty. A write whose content serializes to `''`
 *   (`''`, `undefined`) throws rather than issuing a request GitHub would `422`
 *   on create — and, worse, silently interpret as "delete this file" on update.
 * - Rate limit: 5000 requests/hour (authenticated).
 */
import { registerProtocol } from './protocolRegistry.js';
import { writeThroughObject } from './set.js';
import { resolveIdStore, makeQueue } from './aliasStore.js';
const DEFAULT_BASE = 'https://api.github.com';
const DEFAULT_RAW_BASE = 'https://gist.githubusercontent.com';
const DEFAULT_FILE = 'data.json';
function hashKey(alias) {
    return `gistID:${alias}`;
}
function resolveConfig(cfg) {
    return {
        base: (cfg?.baseURL ?? DEFAULT_BASE).replace(/\/+$/, ''),
        rawBase: (cfg?.rawBaseURL ?? DEFAULT_RAW_BASE).replace(/\/+$/, ''),
        readVia: cfg?.readVia ?? 'api',
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
/**
 * Serialize `value` for storage, rejecting a result GitHub's Gist API cannot
 * accept: a file whose `content` is the empty string. On **create** that is a
 * `422 {"field":"files","code":"missing_field"}`; on **update** GitHub reads an
 * empty `content` as "delete this file" — a silent data loss. In every such
 * case the caller passed something meaningless (`''`, `undefined`, a value that
 * `JSON.stringify`s to `undefined`), so fail loudly here instead of at — or
 * after — the network.
 */
function gistContent(value) {
    const content = serialize(value);
    if (typeof content !== 'string' || content === '') {
        throw new Error('gist write: a gist file cannot be empty — refusing to write ' +
            (value === undefined ? 'undefined' : JSON.stringify(value)) +
            ' (GitHub 422s an empty create and treats an empty update as deleting the file)');
    }
    return content;
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
/**
 * Read one file straight off the raw CDN — unauthenticated, no `/gists`
 * envelope. `null` on 404; parsed JSON when it parses, the raw text otherwise
 * (same tolerance as {@link fileValue}).
 *
 * With an `owner` it's `…/<owner>/<id>/raw[/<sha>]/<file>` (the explicit
 * `gist://<owner>/…` form). Without one — `readVia: 'raw'` on an alias/id — it's
 * the owner-less `…/raw/<id>[/<sha>]/<file>`, which GitHub also serves.
 */
async function readRaw(r, raw, file) {
    const rev = raw.sha ? raw.sha + '/' : '';
    const url = raw.owner
        ? `${r.rawBase}/${raw.owner}/${raw.id}/raw/${rev}${file}`
        : `${r.rawBase}/raw/${raw.id}/${rev}${file}`;
    const resp = await fetch(url);
    if (resp.status === 404)
        return null;
    if (!resp.ok)
        throw new Error(`gist raw GET ${url} → ${resp.status}${await briefBody(resp)}`);
    const text = await resp.text();
    if (text === '')
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
async function patchGist(r, id, file, value) {
    const resp = await fetch(`${r.base}/gists/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: await ghHeaders(r, true),
        body: JSON.stringify({ files: { [file]: { content: gistContent(value) } } }),
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
            files: { [file]: { content: gistContent(value) } },
        }),
    });
    if (!resp.ok)
        throw new Error(`gist POST → ${resp.status}${await briefBody(resp)}` + authHint(resp.status));
    const parsed = await resp.json().catch(() => null);
    if (parsed && typeof parsed.id === 'string') {
        const owner = typeof parsed.owner?.login === 'string' ? parsed.owner.login : null;
        return { id: parsed.id, owner };
    }
    const loc = resp.headers.get('Location');
    const fromLoc = loc?.match(/\/gists\/([^/?#]+)/)?.[1];
    if (fromLoc)
        return { id: fromLoc, owner: null };
    throw new Error('gist POST: could not determine the new gist id from the response');
}
function authHint(status) {
    return status === 401 || status === 403
        ? ' (a GitHub token with the "gist" scope is required to write a gist — set config.getToken)'
        : '';
}
// ---- id-store value shape: bare "<id>", or "<owner>/<id>" once the owner is known ----
function packId(id, owner) {
    return owner ? `${owner}/${id}` : id;
}
/** Gist ids are hex with no `/`, so splitting on the first one is unambiguous. */
function unpackId(stored) {
    const slash = stored.indexOf('/');
    return slash === -1
        ? { id: stored, owner: null }
        : { owner: stored.slice(0, slash), id: stored.slice(slash + 1) };
}
function parseKey(key, defaultFile) {
    // Raw-CDN form: <owner>/<id>/raw[/<sha>]/<file> (3rd segment is literally "raw").
    const segs = key.split('/');
    if (segs.length >= 4 && segs[2] === 'raw') {
        const [owner, id, , shaOrFile, ...rest] = segs;
        const sha = rest.length > 0 ? shaOrFile : null;
        const file = (rest.length > 0 ? rest.join('/') : shaOrFile) || defaultFile;
        return { alias: null, literalId: id, file, raw: { owner, id, sha } };
    }
    const slash = key.indexOf('/');
    const head = slash === -1 ? key : key.slice(0, slash);
    const file = slash === -1 ? defaultFile : key.slice(slash + 1) || defaultFile;
    if (head.startsWith('='))
        return { alias: null, literalId: head.slice(1), file, raw: null };
    return { alias: head, literalId: null, file, raw: null };
}
// ---- handler construction ----
function makeGist(cfg) {
    const r = resolveConfig(cfg);
    const pendingCreate = new Map();
    const enqueue = makeQueue();
    /** Existing `{id, owner}` for `alias`, or create one seeded with `seed` and remember it. */
    async function ensureId(alias, file, seed) {
        const existing = await r.store.get(alias);
        if (existing)
            return unpackId(existing);
        let p = pendingCreate.get(alias);
        if (!p) {
            p = (async () => {
                const created = await createGist(r, file, seed);
                await r.store.set(alias, packId(created.id, created.owner));
                return created;
            })();
            pendingCreate.set(alias, p);
            p.catch(() => { }).finally(() => pendingCreate.delete(alias));
        }
        return p;
    }
    const read = async (key) => {
        const { alias, literalId, file, raw } = parseKey(key, r.defaultFile);
        if (raw)
            return readRaw(r, raw, file);
        let id;
        let owner = null;
        if (literalId !== null) {
            id = literalId; // a bare id from `=<id>` — no alias entry to learn/remember an owner in
        }
        else {
            const stored = await r.store.get(alias);
            if (!stored)
                return null;
            ({ id, owner } = unpackId(stored));
        }
        if (r.readVia === 'raw') {
            if (owner === null && literalId === null) {
                // Legacy/foreign mapping with no owner on file yet: one API GET
                // learns it and upgrades the stored value to "owner/id" so every
                // read after this one — including across a reload — uses the
                // pretty, owner-qualified CDN url instead of the owner-less one.
                const gist = await fetchGist(r, id);
                if (gist === null) {
                    await r.store.delete?.(alias);
                    return null;
                }
                const login = typeof gist.owner?.login === 'string' ? gist.owner.login : null;
                if (login)
                    await r.store.set(alias, packId(id, login));
                return fileValue(r, gist, file);
            }
            return readRaw(r, { owner, id, sha: null }, file);
        }
        const gist = await fetchGist(r, id);
        if (gist === null) {
            if (literalId === null)
                await r.store.delete?.(alias); // purged → drop stale mapping
            return null;
        }
        return fileValue(r, gist, file);
    };
    const write = (key, chain, val) => {
        const { alias, literalId, file, raw } = parseKey(key, r.defaultFile);
        if (raw?.sha) {
            const unpinned = raw.owner
                ? `gist://${raw.owner}/${raw.id}/raw/${file}`
                : `gist://=${raw.id}/${file}`;
            return Promise.reject(new Error(`gist write: cannot write to a pinned revision (${raw.sha}) — drop the sha: ${unpinned}`));
        }
        return enqueue(literalId ?? alias, async () => {
            if (chain.length === 0) {
                if (literalId !== null) {
                    await patchGist(r, literalId, file, val);
                    return;
                }
                const existing = await r.store.get(alias);
                if (existing)
                    await patchGist(r, unpackId(existing).id, file, val);
                else
                    await ensureId(alias, file, val); // seed the new gist file with the value
                return;
            }
            const id = literalId ?? (await ensureId(alias, file, {})).id;
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
