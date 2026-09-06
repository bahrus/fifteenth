# JsonBlob and superjsonblob support

## Bruce's Ask

I would like to request a separate module file that supports both [JSONBlob](https://jsonblob.com/) and [superjsonblob](https://superjsonblob.com/api-docs)

This [table](https://superjsonblob.com/vs/jsonblob) may be helpful that compares the two.

I'm thinking the protocols could simply look like:

jsonblob://...
and
superjsonblob://...

Please investigate these api's and make sure it is compatible with what is needed for a protocol to work, and add any clarifications needed below.

One area where I think I would seek your guidance is how to provide an optional api key?

## Claude's Findings

I investigated both APIs. Short version: **reads map onto the protocol contract
cleanly; writes need one decision from you (how a *new* blob gets created), and
the "API key" question has a different answer for each service.** No code
written yet — clarifications first.

### 1. The two APIs

Both expose the same REST shape under `/api/jsonBlob`:

| | jsonblob.com | superjsonblob.com |
|---|---|---|
| Create | `POST /api/jsonBlob` — body is the JSON; new id comes back in the **`Location`** response header (jsonblob.com also echoes it in an **`X-jsonblob`** header) | `POST /api/jsonBlob` — `201` with body `{"id":"…","versionNumber":1}` **and** a `Location` header |
| Read | `GET /api/jsonBlob/<id>` → `200` + JSON body | same, plus `?version=N` for history |
| Update | `PUT /api/jsonBlob/<id>` — replaces the blob → `200` | same, but every PUT is kept as an immutable version |
| Delete | `DELETE /api/jsonBlob/<id>` → `200` (`405` if disabled) | `DELETE` → `204` (soft delete) |
| Headers | `Content-Type: application/json`; examples also send `Accept: application/json` | identical |
| Auth | **none** — every blob is public-by-URL, editable/deletable by anyone with the id | **optional** `Authorization: Bearer <firebase-id-token>` → blob is "owned", private-visibility + dashboard |
| Retention | blob removed after **~75 days** with no access (was 30 historically) | undocumented; append-only version history, presumably longer for owned blobs |
| Size limit | undocumented | undocumented |
| CORS | not documented in text, but the service exists for browser client/server mocking and is used cross-origin everywhere — almost certainly `Access-Control-Allow-Origin: *`. **Needs a `curl -I` confirm before we rely on it.** | claims path/method/response parity with jsonblob.com → likely same; also needs confirming |
| `X-jsonblob` header | id may be supplied in this header instead of the path, letting the path be anything under `/api/` | not mentioned; assume path-only |

Sources: [jsonblob.com/api](https://jsonblob.com/api),
[JSONBlob Core API (Postman)](https://documenter.getpostman.com/view/33232/jsonblob-core-api/4pg),
[jsonblob mirror](https://jsonblob.iiif.arthistoricum.net/api),
[tburch/jsonblob (archived)](https://github.com/tburch/jsonblob),
[superjsonblob API docs](https://superjsonblob.com/api-docs),
[superjsonblob vs jsonblob](https://superjsonblob.com/vs/jsonblob).

### 2. Fit with the protocol contract

A protocol handler is `(key: string) => value | Promise<value>` where `key` is
the text between `://` and the first `?.`; assign-gingerly resolves any `?.`
chain against the result. So:

- **`get('jsonblob://<id>?.a?.b')`** → handler does `GET …/api/jsonBlob/<id>`,
  returns the parsed JSON, assign-gingerly walks `?.a?.b`. Clean, async is
  fine. ✅
- **`set('jsonblob://<id>', val)`** → a new `case 'jsonblob'` in `set.ts` doing
  `PUT …/api/jsonBlob/<id>`. With a `?.` chain it's read-modify-write
  (`GET` → merge via the existing `evaluatePath` → `PUT`), exactly like the
  `indexedDB` case already works. ✅
- **change broadcast** — `set` would still `postMessage([usp])` /
  `[usp, usl]`. Fine, though cross-tab/cross-client sync over a shared remote
  blob is a bigger topic (that's `gait` territory).

Network specifics that don't quite fit and want a ruling:

**(a) Creating a new blob has no id yet.** `POST /api/jsonBlob` returns a
server-assigned id in `Location`. But a USL always carries a key, and `set`
returns `Promise<void>`, so there's nowhere for a caller to receive the new id.
Options:

  - **A — reads/writes only against a known id.** You create the blob elsewhere
    (the website, a one-off `curl`, or a separate `fifteenth` helper like
    `createBlob(value): Promise<string>`), then use `jsonblob://<id>` forever
    after. `set` only ever does `PUT`. Simplest, keeps `set`'s signature.
    *Recommended.*
  - **B — `set('jsonblob://', val)` (empty key) means POST**, and `set` returns
    the created id/URL when the key was empty (loosen the return type to
    `Promise<void | string>`). Convenient but muddies the signature and the
    "one code path" story.
  - **C — a dedicated `stow`-style creator** in the jsonblob module, separate
    from `set`.

**(b) `PUT` to a non-existent id.** jsonblob.com 404s (no upsert). So `set` on a
fresh random id won't "create" it — reinforces option A.

**(c) Should these live in the default `protocols` bag?** I'd say **no** — put
them in an opt-in module (`fifteenth/jsonblob.js`) that exports handlers you
spread into your own bag, the way `idb` is kept separate. Network latency,
failure modes, and the auth story are different enough from `localStorage` that
silent inclusion would surprise people.

### 3. The "optional API key" question

The two services answer this differently, and neither is a plain static key:

- **jsonblob.com — there is no key.** Nothing to pass. Every blob is world-
  readable and world-writable by id. If you need privacy you pick
  superjsonblob or self-host.
- **superjsonblob — a Firebase ID token, not an API key.** It's
  `Authorization: Bearer <token>`, where the token is minted by the Firebase
  Auth SDK for a signed-in user and **expires in ~1 hour**. You can't hardcode
  it; you need a *token provider* the library calls on each request.

Since a protocol handler's signature (`(key) => value`) has no options
parameter, the credential has to be baked in when the bag is assembled. Three
shapes, in order of how well they fit the existing package:

  - **Factory export (recommended).** The module exports a function, not a
    static handler:

    ```js
    import { jsonBlobProtocols } from 'fifteenth/jsonblob.js';

    const protocols = {
      ...ambientProtocols,
      ...jsonBlobProtocols({
        // all optional
        jsonblob:      { baseURL: 'https://jsonblob.com' },
        superjsonblob: {
          baseURL: 'https://superjsonblob.com',
          getToken: () => firebaseUser.getIdToken(),   // called per request; may be async
        },
      }),
    };
    ```

    `getToken` absent → requests go out unauthenticated (fine for
    jsonblob.com and for anonymous superjsonblob blobs). This also cleanly
    covers self-hosted instances via `baseURL`.

  - **Module-level config setter** — `configureJsonBlob({ getToken })` mutating
    a module singleton. Less boilerplate at the call site, but global mutable
    state and hard to run two configs at once.

  - **Well-known `globalThis` slot** — handler reads
    `globalThis.__fifteenthJsonBlobToken?.()`. Zero wiring, very implicit,
    easy to get wrong. Not recommended.

I'd go with the factory, and have `set`/`get` sugar (`get('jsonblob://…')`)
fall back to an unauthenticated default so the zero-config case still works.

### 4. What I need from you before implementing

1. **New-blob creation**: option A (known-id only; separate `createBlob` helper
   if you want one), B (empty-key POST returning the id), or C?
2. **Credential wiring**: factory `jsonBlobProtocols({...})` as above — OK? And
   should `getToken` be the only auth hook, or do you also want a raw
   `headers` / `fetch` override for self-hosted / proxy setups?
3. **Bag placement**: separate opt-in `fifteenth/jsonblob.js` (my rec), or fold
   into the default `protocols`?
4. **Scope now**: just the two hosted services, or design `baseURL` in from the
   start for self-hosted superjsonblob / forks?
5. **Versioning** (`superjsonblob` `?version=N`): ignore for v1, or reserve
   syntax now (e.g. `superjsonblob://<id>@<n>` for reads)?
6. I'll `curl -I` both endpoints to confirm CORS + capture the real
   `Location`/`X-jsonblob` behavior before writing the handler — flagging in
   case you already know the CORS answer.

## Bruce's Response I

Thanks for the thorough discussion.  I wasn't aware about the purging od data after ~75 days.

Are you aware of any services that explicitly say they will never purge the data?

> Creating a new blob has no id yet.

Here's what I propose:

1.  The user specifies a path:

   ```JS
   set('jsonBlob://myPath', '{hello: 'world'});
   ```

2.  The code checks if the hash portion of the current url has an embedded "jsonBlobID:myPath=..." in it, which doesn't interfere with other hash portion name value pairs (use & delimiter?).

    1.  If no id found, do a POST to create the blob.  Update the location.hash to specify the returned id.

    2.  If an id is found, use Update with the id.

Would this work?

I like the factory approach.

>  or do you also want a raw headers / fetch override for self-hosted / proxy setups

The factory approach seems pretty open ended.  Can we add this support as needs arise?

Let's ignore versioning for v1.

## Claude's Response II

### Never-purge services

I couldn't find a **free, no-signup** blob service that puts "we never delete
your data" in writing. jsonblob.com's ~75-day sweep is, if anything, generous
for that tier:

| Service | Purge policy | Credential |
|---|---|---|
| jsonblob.com | deleted ~75 days after last access | none |
| [jsonbox.io](https://github.com/mklilley/jsonbox) | records older than **1 year** auto-deleted | none |
| Pantry (getpantry.cloud) | basket deleted after ~30 days of inactivity | none (per-account UUID) |
| [JSONBin.io](https://jsonbin.io/) | no documented auto-purge — bins live while the account does; deleted only by you | **account + static key** (`X-Master-Key`) |
| [npoint.io](https://www.npoint.io/) | no documented auto-purge; account-scoped (Google sign-in) | account |
| [jsonsilo.com](https://jsonsilo.com/policy) | retained "as long as your account is active" | account + key |

So the pattern holds: **durability comes with an account/key.** The services
that effectively never purge are the ones you sign into. JSONBin.io is the
closest fit to your "optional api key" idea — its credential is a genuine
static key (`X-Master-Key: <key>`), which drops straight into the factory's
auth hook, unlike superjsonblob's hourly-expiring Firebase token.

If "never purge" is a hard requirement, the honest answer is a real backend
that happens to speak HTTP+JSON — a **GitHub Gist** (permanent, versioned,
`Authorization: Bearer <PAT>`), Cloudflare KV, Supabase, etc. Those aren't
"jsonblob-shaped" but a `gist://` handler is about the same size as a
`jsonblob://` one if you want it later.

Recommendation: build `jsonblob` + `superjsonblob` now (they're the request),
keep the factory's auth hook general enough that `jsonbin` / `gist` are a
follow-up module, not a redesign.

### The hash-stored-id scheme — yes, with refinements

It works. The important consequence to be deliberate about: **`jsonBlob://myPath`
becomes a local *alias*, not the blob's real id.** The alias→id map lives in
`location.hash`, and `get` has to read that same map:

- `get('jsonBlob://myPath')` resolves `myPath`→id via the hash, then GETs.
  No mapping yet → return `null` (matches `get`'s "missing → null"; a read
  can't POST).
- `set('jsonBlob://myPath', v)` → no mapping → POST, then record the id; have
  a mapping → PUT. `set` still returns `Promise<void>` — the id is a hash
  side effect, callers never touch it.

Refinements I'd fold in:

1. **Multi-path, namespaced encoding.** Your line-178 update
   (`jsonBlobID:myPath=<id>`) already covers this — one reserved hash pair per
   alias, `&`-joined with whatever else is in the hash. Works for me; only
   nits: (a) these keys are also visible to the `locationHash://` protocol, so
   `jsonBlobID:` is documented as a reserved prefix; (b) URL-encode the alias
   in case it contains `&`/`=`/`#`.
2. **Write the hash via `history.replaceState`,** not `location.hash = …`.
   The latter pushes a Back-button entry and fires `hashchange` on every
   `set`. `replaceState(null, '', url)` updates the URL silently.
3. **Serialize the first write per alias.** Two `set('jsonBlob://x', …)` calls
   before the first POST returns → two blobs, one orphaned. An in-module
   `Map<aliasKey, Promise<id>>` makes the second await the first.
4. **Pluggable id-store, defaulting to the hash:**
   ```js
   jsonBlobProtocols({
     jsonblob: {
       baseURL: 'https://jsonblob.com',
       idStore: 'locationHash',            // default — exactly your proposal
       //        | 'localStorage'          // survives navigation, shared across tabs
       //        | { get(alias), set(alias, id) }   // anything else
     },
   })
   ```
   Cheap seam; lets someone who doesn't want `set` mutating the URL opt out,
   and answers the multi-tab point below without complicating the default.
5. **Direct-id escape hatch.** Someone holding an existing blob id should be
   able to skip the alias indirection — `jsonBlob://=<id>` (leading `=`) means
   "this *is* the id, don't consult the id-store."
6. **Stale mapping.** If a GET 404s (blob was purged), drop the alias entry so
   the next `set` re-POSTs a fresh blob. Decide: silent re-create (my lean) vs
   surface the error.

One inherent property to call out, not a bug: with the hash as id-store, two
tabs / two devices that each `set('jsonBlob://x', …)` from a bare URL create
**different** blobs. If the hash-carrying URL is the thing you share/reopen,
they converge — which is a fine model *if it's intentional* (URL carries the
pointers to remote state). `idStore: 'localStorage'` is the escape if you want
per-origin stability without passing URLs around.

### Confirmed from your reply

- Factory approach — locked in.
- Raw `headers` / `fetch` overrides — deferred; add when a self-host/proxy case
  actually shows up.
- Versioning — out for v1.

### Remaining before I implement

- **id encoding**: going with your `jsonBlobID:<alias>=<id>` hash pairs
  (alias URL-encoded, `jsonBlobID:` reserved). Shout if you'd rather one
  JSON-encoded param.
- **direct-id sigil**: `jsonBlob://=<id>` acceptable, or prefer something else?
- **stale/purged blob on read**: silent re-create on next `set`, or throw?
- I'll still `curl -I` both hosts to confirm CORS + capture real
  `Location` / `X-jsonblob` behavior before writing the fetch code.

## Bruce's Response

I agree with all your recommendations.  Please proceed with implementation and add your implementation notes below.

## Claude's Implementation Notes

Implemented. `npm run build` clean; `jsonblob.spec.ts` green on Chromium (10
in-browser assertions against a stubbed transport); `get` / `set` specs still
green.

### CORS check (the `curl -I` I promised) — one real surprise

| | jsonblob.com | superjsonblob.com |
|---|---|---|
| `Access-Control-Allow-Origin` | `*` | **absent** — on GET, on collection `OPTIONS`, on item `OPTIONS` |
| `Access-Control-Allow-Methods` | `GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS` | absent |
| `Access-Control-Allow-Headers` | `Content-Type,Authorization,X-jsonblob-id,If-Match,…` | absent |
| `Access-Control-Expose-Headers` | `Location,X-jsonblob-id,X-jsonblob-expires-at,…` | absent |
| Preflight cache | `Access-Control-Max-Age: 86400` | — |

**superjsonblob has no CORS at all right now.** From a browser it's only
reachable same-origin, via a proxy, or against a self-hosted `baseURL`. The
code path is identical to jsonblob's (it *is* wire-compatible — verified
`POST`→201 `{id,versionNumber}`, `PUT`→200, `DELETE`→204, and `Location` is a
*relative* `/api/jsonBlob/<id>`), so it "just works" the moment they add CORS
or behind your own instance. Flagged prominently in the README and the module
JSDoc.

Other findings baked in:
- New-blob id header on jsonblob.com is **`X-jsonblob-id`** (not `X-jsonblob`),
  and `Location` — both in `Access-Control-Expose-Headers`, so a cross-origin
  browser can read them. `postBlob` tries `Location` → `X-jsonblob-id` →
  `X-jsonblob` → body `.id`, then throws a CORS-hinting error.
- jsonblob.com now also advertises `Authorization`, `If-Match`/ETag,
  `X-jsonblob-expires-at`, `X-jsonblob-generate` — it has grown auth/ownership
  and optimistic-concurrency features well beyond the archived `tburch` source.
  Not used in v1 beyond passing `Authorization` when `getToken` is set.
- Couldn't exercise `POST`/`PUT` from this environment — Cloudflare 403s the
  datacenter IP for write methods (GET/OPTIONS pass). Browser use from a normal
  IP is unaffected; the tests stub `fetch` regardless (see below).

### Files

- **`protocolRegistry.ts`** (new) — `registerProtocol(name, { read, write })`
  + `getProtocolReader` / `getProtocolWriter`. The seam that lets `get`/`set`
  learn a scheme without touching the default `protocols` bag.
- **`jsonblob.ts`** (new) — `jsonBlobProtocols(config?)` (pure read bag for
  assign-gingerly) and `configureJsonBlob(config?)` (registers read+write for
  `get`/`set`; call again to reconfigure; returns the same read bag).
- **`get.ts`** — falls back to `getProtocolReader(protocol)` when the bag has no
  handler.
- **`set.ts`** — checks `getProtocolWriter(protocol)` before the built-in
  `switch`; still emits the `postMessage` broadcast itself. Exported
  `writeThroughObject` so the network writer reuses the exact merge helper.
- **`index.ts`** / **`package.json`** — re-exports + `exports` entries for
  `./jsonblob.js` and `./protocolRegistry.js`.
- **`tests/test-jsonblob.html`** + **`tests/jsonblob.spec.ts`** (new).
- **`README.md`** — new "Remote JSON blobs" section; protocol list updated.

### Design as built (matches what we agreed)

- **Not in the default bag.** `configureJsonBlob()` is the one-line opt-in;
  `import 'fifteenth'` has no side effect until you call it.
- **`key` = local alias.** Resolved to a real blob id via a **pluggable
  id-store**: `'locationHash'` (default — `history.replaceState`, key
  `jsonBlobID:<service>:<alias>`, so `jsonblob` and `superjsonblob` don't
  collide and it survives alongside other hash pairs), `'localStorage'`, or a
  custom `{ get, set, delete? }`.
- **Direct id escape hatch:** `jsonblob://=<id>` → `parseKey` strips the `=`,
  the id-store is never consulted, no create-on-write.
- **Create/update:** no chain + unmapped alias → `POST` seeded with the value;
  no chain + mapped → `PUT`; with chain → ensure id (`POST {}` if new) →
  `GET` → `writeThroughObject` merge → `PUT`.
- **Concurrency:** per-alias `POST` dedup (`pendingCreate`) *and* a per-alias
  write queue (`enqueue`) so a burst of `set()` in one tab serializes instead
  of each GET-ing the same snapshot and clobbering. The write-queue was a real
  bug the concurrency test caught — the `POST`-dedup alone still lost two of
  three concurrent chained writes. Cross-tab writes still race (documented;
  jsonblob.com's `If-Match` is the eventual fix, out of scope).
- **Stale mapping:** a `404` on read calls `store.delete?.(alias)` so the next
  `set` re-creates the blob. (Silent re-create — your pick.)
- **Auth:** `getToken()` awaited per request; truthy → `Authorization: Bearer`.
  jsonblob.com needs none.

### Testing approach

Live services can't be hit reliably from CI (jsonblob.com Cloudflare-403s the
runner IP on writes; superjsonblob has no CORS for a browser test page). So
`test-jsonblob.html` installs an **in-memory `fetch` stub** implementing the
`/api/jsonBlob` REST shape (with the jsonblob-vs-superjsonblob `Location`-header
difference) and exercises the module through it: create-then-read, chain merge +
leaf overwrite, unmapped→null (no POST), direct-id, `resolveValues` via the bag,
3-way concurrent write → exactly 1 POST + all merged, `getToken` header,
`localStorage` id-store, 404→stale-mapping-drop, and superjsonblob body-id
resolution. Deterministic, no network.

### Open / deferred

- Raw `headers` / `fetch` override — deferred per your call; the `idStore`
  custom-object seam already covers a lot.
- superjsonblob `?version=N` reads — out for v1.
- `If-Match`/ETag optimistic concurrency for cross-tab safety — future.
- A `createBlob()` helper that returns the id — not needed given the
  alias/id-store model; add later if a "just give me an id" use case appears.




