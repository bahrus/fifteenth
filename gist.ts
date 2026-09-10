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
import type { IdStore, IdStoreChoice, TokenProvider } from './aliasStore.js';
import type { ProtocolHandler } from './ambient.js';

export type { IdStore, TokenProvider };

const DEFAULT_BASE = 'https://api.github.com';
const DEFAULT_RAW_BASE = 'https://gist.githubusercontent.com';
const DEFAULT_FILE = 'data.json';

export interface GistConfig {
    /** Override the API origin (GitHub Enterprise, a proxy). Default `https://api.github.com`. */
    baseURL?: string;
    /** Override the raw-file CDN origin for `gist://<owner>/<id>/raw/…` reads. Default `https://gist.githubusercontent.com`. */
    rawBaseURL?: string;
    /** Returns a GitHub token with the `gist` scope. Called per request; may be async. */
    getToken?: TokenProvider;
    /** Where alias→gist-id mappings live. Default `'locationHash'`. */
    idStore?: IdStoreChoice;
    /** Visibility of gists this module creates. Default `false` (secret, i.e. unlisted). */
    public?: boolean;
    /** File name used when a USL names only an alias. Default `data.json`. */
    defaultFile?: string;
    /** `description` set on gists this module creates. */
    description?: string;
}

interface Resolved {
    base: string;
    rawBase: string;
    store: IdStore;
    getToken?: TokenProvider;
    public: boolean;
    defaultFile: string;
    description?: string;
}

function hashKey(alias: string): string {
    return `gistID:${alias}`;
}

function resolveConfig(cfg?: GistConfig): Resolved {
    return {
        base: (cfg?.baseURL ?? DEFAULT_BASE).replace(/\/+$/, ''),
        rawBase: (cfg?.rawBaseURL ?? DEFAULT_RAW_BASE).replace(/\/+$/, ''),
        store: resolveIdStore(cfg?.idStore, hashKey),
        getToken: cfg?.getToken,
        public: cfg?.public ?? false,
        defaultFile: cfg?.defaultFile ?? DEFAULT_FILE,
        description: cfg?.description,
    };
}

// ---- HTTP ----

async function ghHeaders(r: Resolved, body: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) h['Content-Type'] = 'application/json';
    const token = await r.getToken?.();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
}

async function briefBody(resp: Response): Promise<string> {
    try {
        const t = (await resp.text()).replace(/\s+/g, ' ').trim();
        return t ? ` — ${t.slice(0, 200)}` : '';
    } catch {
        return '';
    }
}

function serialize(value: any): string {
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
function gistContent(value: any): string {
    const content = serialize(value);
    if (typeof content !== 'string' || content === '') {
        throw new Error(
            'gist write: a gist file cannot be empty — refusing to write ' +
            (value === undefined ? 'undefined' : JSON.stringify(value)) +
            ' (GitHub 422s an empty create and treats an empty update as deleting the file)',
        );
    }
    return content;
}

/** The whole gist object, or `null` on 404 (gist absent / purged). */
async function fetchGist(r: Resolved, id: string): Promise<any> {
    const resp = await fetch(`${r.base}/gists/${encodeURIComponent(id)}`, {
        headers: await ghHeaders(r, false),
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`gist GET ${id} → ${resp.status}${await briefBody(resp)}`);
    return resp.json();
}

/** Parsed JSON of one file within an already-fetched gist; `null` if the file is absent/empty. */
async function fileValue(r: Resolved, gist: any, file: string): Promise<any> {
    const entry = gist?.files?.[file];
    if (!entry) return null;
    let content: string = entry.content ?? '';
    if (entry.truncated && entry.raw_url) {
        const raw = await fetch(entry.raw_url, { headers: await ghHeaders(r, false) });
        if (!raw.ok) throw new Error(`gist raw ${file} → ${raw.status}`);
        content = await raw.text();
    }
    if (content === '') return null;
    try {
        return JSON.parse(content);
    } catch {
        return content; // tolerate a non-JSON file, same as the web-storage handler
    }
}

/**
 * Read one file straight off the raw CDN (`gist://<owner>/<id>/raw[/<sha>]/<file>`)
 * — unauthenticated, no `/gists` envelope. `null` on 404; parsed JSON when it
 * parses, the raw text otherwise (same tolerance as {@link fileValue}).
 */
async function readRaw(r: Resolved, raw: RawRef, file: string): Promise<any> {
    const url = `${r.rawBase}/${raw.owner}/${raw.id}/raw/${raw.sha ? raw.sha + '/' : ''}${file}`;
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`gist raw GET ${url} → ${resp.status}${await briefBody(resp)}`);
    const text = await resp.text();
    if (text === '') return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function patchGist(r: Resolved, id: string, file: string, value: any): Promise<void> {
    const resp = await fetch(`${r.base}/gists/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: await ghHeaders(r, true),
        body: JSON.stringify({ files: { [file]: { content: gistContent(value) } } }),
    });
    if (!resp.ok) throw new Error(`gist PATCH ${id} → ${resp.status}${await briefBody(resp)}` + authHint(resp.status));
}

async function createGist(r: Resolved, file: string, value: any): Promise<string> {
    const resp = await fetch(`${r.base}/gists`, {
        method: 'POST',
        headers: await ghHeaders(r, true),
        body: JSON.stringify({
            ...(r.description !== undefined ? { description: r.description } : {}),
            public: r.public,
            files: { [file]: { content: gistContent(value) } },
        }),
    });
    if (!resp.ok) throw new Error(`gist POST → ${resp.status}${await briefBody(resp)}` + authHint(resp.status));

    const parsed = await resp.json().catch(() => null);
    if (parsed && typeof parsed.id === 'string') return parsed.id;

    const loc = resp.headers.get('Location');
    const fromLoc = loc?.match(/\/gists\/([^/?#]+)/)?.[1];
    if (fromLoc) return fromLoc;

    throw new Error('gist POST: could not determine the new gist id from the response');
}

function authHint(status: number): string {
    return status === 401 || status === 403
        ? ' (a GitHub token with the "gist" scope is required to write a gist — set config.getToken)'
        : '';
}

// ---- alias resolution ----

/** Parsed `gist://<owner>/<id>/raw[/<sha>]/<file>` reference. */
interface RawRef {
    owner: string;
    id: string;
    /** Pinned revision sha, or `null` for "latest". */
    sha: string | null;
}

interface Addr {
    /** `null` when the key is a literal id or a raw ref. */
    alias: string | null;
    /** Set when the key is `=<id>` or a raw ref (the gist id, for the write path). */
    literalId: string | null;
    /** File within the gist. */
    file: string;
    /** Set for the `gist://<owner>/<id>/raw[/<sha>]/<file>` form. */
    raw: RawRef | null;
}

function parseKey(key: string, defaultFile: string): Addr {
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
    if (head.startsWith('=')) return { alias: null, literalId: head.slice(1), file, raw: null };
    return { alias: head, literalId: null, file, raw: null };
}

// ---- handler construction ----

function makeGist(cfg?: GistConfig) {
    const r = resolveConfig(cfg);
    const pendingCreate = new Map<string, Promise<string>>();
    const enqueue = makeQueue();

    /** Existing gist id for `alias`, or create one seeded with `seed` and remember it. */
    async function ensureId(alias: string, file: string, seed: any): Promise<string> {
        const existing = await r.store.get(alias);
        if (existing) return existing;

        let p = pendingCreate.get(alias);
        if (!p) {
            p = (async () => {
                const id = await createGist(r, file, seed);
                await r.store.set(alias, id);
                return id;
            })();
            pendingCreate.set(alias, p);
            p.catch(() => {}).finally(() => pendingCreate.delete(alias));
        }
        return p;
    }

    const read: ProtocolHandler = async (key: string) => {
        const { alias, literalId, file, raw } = parseKey(key, r.defaultFile);
        if (raw) return readRaw(r, raw, file);
        const id = literalId ?? (await r.store.get(alias!)) ?? null;
        if (!id) return null;

        const gist = await fetchGist(r, id);
        if (gist === null) {
            if (literalId === null) await r.store.delete?.(alias!); // purged → drop stale mapping
            return null;
        }
        return fileValue(r, gist, file);
    };

    const write = (key: string, chain: string[], val: any): Promise<void> => {
        const { alias, literalId, file, raw } = parseKey(key, r.defaultFile);
        if (raw?.sha) {
            return Promise.reject(new Error(
                `gist write: cannot write to a pinned revision (${raw.sha}) — ` +
                `drop the sha: gist://${raw.owner}/${raw.id}/raw/${file}`,
            ));
        }
        return enqueue(literalId ?? alias!, async () => {
            if (chain.length === 0) {
                if (literalId !== null) {
                    await patchGist(r, literalId, file, val);
                    return;
                }
                const existing = await r.store.get(alias!);
                if (existing) await patchGist(r, existing, file, val);
                else await ensureId(alias!, file, val); // seed the new gist file with the value
                return;
            }

            const id = literalId ?? (await ensureId(alias!, file, {}));
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
export function gistProtocols(config?: GistConfig): { gist: ProtocolHandler } {
    return { gist: makeGist(config).read };
}

/**
 * Register `gist://` with `get()` / `set()`, using `config` (all fields
 * optional; `getToken` is needed for writes). Call again to reconfigure.
 * Returns the same read bag {@link gistProtocols} produces.
 */
export function configureGist(config?: GistConfig): { gist: ProtocolHandler } {
    const svc = makeGist(config);
    registerProtocol('gist', svc);
    return { gist: svc.read };
}
