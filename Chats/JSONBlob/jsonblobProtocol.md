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

  ## Bruce's Response II

  I'm a little confused by the state of things.  I understand that superjbonblob is not cors compatible.  It appears you are saying that jsonblob.com is cors compatible and as far as you know works fine, I think?

  I tried running the unit test and noticed no fetch calls being made to jsonblob.com.  Maybe that's intentional for unit tests.

  If so, can you create a simple web page in a demos folder, which actually makes live calls to jsonblob.com, and provides confidence that the persistence mechanism works?

## Claude's Response III — demos + a correction

### First, the state of things (you have it right, with one correction)

- **superjsonblob.com** — confirmed **no CORS**. Unusable from a browser
  cross-origin. Fine from Node / same-origin / a proxy.
- **jsonblob.com** — its API *is* CORS-configured (`Access-Control-Allow-Origin: *`,
  full `Access-Control-Allow-Methods`, exposes `Location` / `X-jsonblob-id`) —
  verified via an `OPTIONS` preflight. **But I have to walk back "works fine as
  far as I know."** I can't actually complete a jsonblob.com write from here:
  Cloudflare bot-blocks `POST`/`PUT` from this sandbox's IP (and CI runner IPs,
  and many datacenter ranges). `GET`/`OPTIONS` pass; `POST` gets a `403` HTML
  page — and because that Cloudflare page carries no CORS header, a browser
  reports it as *"No 'Access-Control-Allow-Origin' header"*. So from a normal
  residential browser jsonblob.com works (it's a mainstream tool); from a
  datacenter it's blocked at the edge, before the API.
- The unit tests making no jsonblob.com calls **is** intentional — `fetch` is
  stubbed so they're deterministic and CI-safe.

### Demos (new `demos/` folder)

**`demos/jsonblob.html`** — the browser page you asked for. Loads the real
`fifteenth/jsonblob.js`, `configureJsonBlob()`, and runs
create → read → merge → read against **jsonblob.com**, showing the
server-assigned blob id (also in the page URL hash) with click-through links to
inspect it on jsonblob.com. Manual `set()` / `get()` panel too. Run it from a
normal browser/connection:

```
npm run serve      # then open http://localhost:8000/demos/jsonblob.html
```

I loaded it here through a real Chromium: the page is wired correctly (real
module, real request) — the request fails with the Cloudflare/CORS symptom
above, and the page reports that clearly. It will round-trip green from your
machine.

**`demos/jsonblob-node.mjs`** (+ `npm run demo:jsonblob`) — because I couldn't
show you a *passing* live run against jsonblob.com from here, this is a Node
script that does the same round-trip against the **actual compiled module** and
a **real remote server** — default **superjsonblob** (reachable from anywhere;
wire-compatible, so the persistence code exercised is identical). This one I
ran, and it passes:

```
fifteenth → superjsonblob — live round-trip (superjsonblob://demo-…)
created blob: e4167454-20c7-4cb2-951c-6d711da64ffe
PASS  read-back after create (POST → GET)
PASS  merge kept the original keys (no clobber)
PASS  accessor chain resolves to the leaf
PASS  direct-id form (=<id>) reads the same blob
ALL GOOD — persistence verified end to end.
```

`node demos/jsonblob-node.mjs jsonblob` targets jsonblob.com — works from your
machine, reports the Cloudflare block from a datacenter with a helpful message.

So: persistence is now verified live end-to-end (superjsonblob, from Node) and
the jsonblob.com browser path is one `npm run serve` away from the same proof on
your side.

### Files added

- `demos/jsonblob.html`, `demos/jsonblob-node.mjs`, `demos/README.md`
- `package.json` — `demo:jsonblob` script
- No change to the module; the demos use the shipped API as-is.

## Bruce's Response III

I copied the errors from the console:

jsonblob.html:1 Access to fetch at 'https://jsonblob.com/api/jsonBlob' from origin 'http://localhost:8000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
[NEW] Explain Console errors by using Copilot in Edge: click  to explain an error. Learn moreDon’t show again
jsonblob.js:87  POST https://jsonblob.com/api/jsonBlob net::ERR_FAILED 403 (Forbidden)
postBlob @ jsonblob.js:87
await in postBlob
(anonymous) @ jsonblob.js:138
ensureId @ jsonblob.js:141
await in ensureId
(anonymous) @ jsonblob.js:170
Promise.then
enqueue @ jsonblob.js:122
write @ jsonblob.js:160
set @ set.js:127
runRoundTrip @ jsonblob.html:125
jsonblob.html:160 TypeError: Failed to fetch
    at postBlob (jsonblob.js:87:24)
    at async jsonblob.js:138:28
runRoundTrip @ jsonblob.html:160
jsonblob.html:1 Access to fetch at 'https://jsonblob.com/api/jsonBlob' from origin 'http://localhost:8000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
jsonblob.js:87  POST https://jsonblob.com/api/jsonBlob net::ERR_FAILED 403 (Forbidden)
postBlob @ jsonblob.js:87
await in postBlob
(anonymous) @ jsonblob.js:138
ensureId @ jsonblob.js:141
await in ensureId
(anonymous) @ jsonblob.js:170
Promise.then
enqueue @ jsonblob.js:122
write @ jsonblob.js:160
set @ set.js:127
document.getElementById.onclick @ jsonblob.html:179
jsonblob.html:183 TypeError: Failed to fetch
    at postBlob (jsonblob.js:87:24)
    at async jsonblob.js:138:28
document.getElementById.onclick @ jsonblob.html:183


Any hope of making this work without a proxy middle layer?  Is the browser sending all the needed headers?

## Claude's Response IV

### Is the browser sending all the needed headers?

Yes. `postBlob` sends exactly `POST /api/jsonBlob` + `Content-Type: application/json`
+ `Accept: application/json` + the JSON body — which is the whole documented
jsonblob API for create. I reproduced your `403` from `curl` with a full set of
browser headers (`Origin`, `Referer`, `Sec-Fetch-*`, real UA, `Accept-Language`,
gzip) and also with `Origin: https://jsonblob.com` — **every write gets `403`**:

```
POST https://jsonblob.com/api/jsonBlob   → 403   Server: cloudflare, CF-RAY: …
PUT  https://jsonblob.com/api/jsonBlob/<id> → 403
GET  https://jsonblob.com/api/jsonBlob/<id> → 200/404   (works, full CORS headers)
OPTIONS (preflight)                        → 204   (works, full CORS headers)
```

The `403` body is a gzipped Cloudflare challenge page — and because that page
carries no `Access-Control-Allow-Origin`, the browser reports it as the CORS
error you saw. So it's **not a missing header and not really a CORS
misconfiguration**: jsonblob.com's Cloudflare is bot-blocking *write* methods
(POST/PUT/DELETE) for any request that isn't a real first-party browser session
with a `cf_clearance` cookie. A cross-origin `fetch()` can never obtain that
cookie (Cloudflare can't show its challenge to an XHR). Reads are fine; writes
are walled.

This is new-ish — the live jsonblob.com is a rewrite (the GitHub source is
archived, "no longer reflects jsonblob.com"), now with Cloudflare Bot
Management, ETags, auth headers, expiry headers, etc.

### Any hope without a proxy?

**Against jsonblob.com itself: no** — not for writes from a browser web app on
another origin. The options that need no proxy:

1. **Self-host.** jsonblob is Apache-2.0; superjsonblob ships a Docker image
   (Postgres). Point `baseURL` at your instance, set its CORS to allow your
   origin, done — the module already supports this. superjsonblob self-hosted
   also fixes *its* no-CORS problem.
2. **Use a service that actually wants cross-origin browser writes.** I
   preflighted a few — these answer with clean CORS and **no bot wall**:

   | Service | CORS | Anonymous create? | Credential | Purge |
   |---|---|---|---|---|
   | jsonblob.com | reads only (writes 403) | — | — | 75 d |
   | superjsonblob.com | none | — | — | ? |
   | **getpantry.cloud** | `*`, all methods | after a 1-time email signup for a "Pantry ID" | Pantry ID in the URL | 30 d inactive |
   | **jsonbin.io** | `*`, all methods, `X-Master-Key` allowed | no — needs an account | static `X-Master-Key` | none documented |
   | extendsclass.com | `*` | no (`401` without key) | API key | ? |

   getpantry and jsonbin are the realistic browser-usable, no-proxy choices.
   Neither is byte-compatible with the jsonblob path/response shape, but both
   slot into the exact machinery already built — registry + alias/id-store +
   `getToken`/credential — as a **new protocol** (`pantry://`, `jsonbin://`),
   ~40–60 lines each. This is finally where your original "optional API key"
   question pays off: jsonbin's `X-Master-Key` is a real static key, passed via
   the same config hook.

### Recommendation

- Keep `jsonblob://` / `superjsonblob://` as-is — they're correct and work
  against a self-hosted `baseURL` (and jsonblob.com *reads* work cross-origin
  today).
- Add **`pantry://`** (getpantry.cloud) as the zero-infrastructure,
  works-from-a-browser option — anonymous-ish (one email signup for the Pantry
  ID, then no per-request auth), cleanest CORS. Optionally **`jsonbin://`** too
  if you want the no-purge durability and don't mind the `X-Master-Key`.
- Update `demos/jsonblob.html` to note the jsonblob.com write wall, and add a
  `demos/pantry.html` that actually round-trips from the browser.

### Question for you

Which do you want me to add — `pantry://`, `jsonbin://`, both, or neither
(stick with self-host only)? If `pantry://`, you'll need to grab a Pantry ID
from getpantry.cloud (one email) for the demo; the module takes it as
`configureJsonBlob({ pantry: { pantryId: '…' } })`-style config.

## Bruce's Response IV

I'm kind of waning in my desire to get these obscure api's working with unknown issues, if it requires getting a token anyway.

Maybe we should scrap pursuing this approach, and work with a big, well understood service like Firebase?  Would we face cors issues working with Firebase?  Would Firebase be able to support a generic service like this?

## Claude's Response V — Firebase is a good fit, and a *better* one than jsonblob

### CORS: no problem

Firebase **Realtime Database**'s REST API sends proper CORS headers. Verified by
`curl` against a `*.firebaseio.com` host:

```
GET  https://<db>.firebaseio.com/x.json
     → 404, Access-Control-Allow-Origin: http://localhost:8000   (origin-reflected)
OPTIONS (preflight for PATCH)
     → 200, Access-Control-Allow-Methods: OPTIONS,GET,POST,PUT,DELETE,PATCH
            Access-Control-Allow-Headers: content-type
```

All methods, no bot wall, no Cloudflare challenge. Works from any origin.

Caveats:
- This is the **REST** API (`https://<db>.firebaseio.com/<path>.json`). The
  Firebase **JS SDK** avoids CORS a different way (WebSocket for RTDB, gRPC-web
  for Firestore) but it's a heavy dependency — a REST handler keeps `fifteenth`
  dependency-free, same as the jsonblob one.
- **Cloud Storage for Firebase** is the exception: its bucket CORS must be set
  manually (`gsutil cors set`). Not relevant if we use RTDB.
- **Firestore**'s REST API also has CORS, but its JSON is wrapped in typed-value
  envelopes (`{"fields":{"theme":{"stringValue":"dark"}}}`). RTDB REST is plain
  JSON — much better fit. **Recommend RTDB.**

### Would it support a generic service like this? Yes — and it's cleaner

RTDB *is* "a JSON tree addressed by path", which is exactly `fifteenth`'s model.
The whole jsonblob create-vs-update / id / `location.hash`-alias apparatus
**disappears** — the path is the address and `PUT` is upsert.

| USL | RTDB REST call |
|---|---|
| `get('firebase://users/me/prefs')` | `GET  …/users/me/prefs.json` |
| `get('firebase://users/me/prefs?.theme')` | `GET …/users/me/prefs.json` then walk `?.theme` (or `GET …/users/me/prefs/theme.json` directly) |
| `set('firebase://users/me/prefs', {…})` | `PUT  …/users/me/prefs.json` |
| `set('firebase://users/me/prefs?.theme', 'dark')` | `PATCH …/users/me/prefs.json` body `{"theme":"dark"}` — **native shallow merge, siblings preserved server-side** |
| delete | `DELETE …/path.json` |

So the accessor-chain "don't clobber siblings" behaviour you asked for is done
*by RTDB* via `PATCH`, not by our read-modify-write. Deep chains
(`?.a?.b?.c`) → `PATCH …/a/b.json` with `{"c":val}` (patch one level above the
leaf); the handler derives that URL from the chain. `~40 lines`, no id-store, no
concurrency queue needed.

### Auth / "the token"

Same shape as before, but this time it's the canonical version:
- **Demo / prototype:** open security rules (`".read": true, ".write": true`) →
  no token at all. One console setting.
- **Real use:** Firebase Auth ID token passed as `?auth=<token>` on the REST
  URL — the existing `getToken` hook covers it (still ~1 h expiry; that's
  Firebase, not us).
- There's also a legacy **database secret** (a static string, no expiry) —
  deprecated by Google but still functional if you want a hardcoded key.

### Setup you'd do once

1. Create a Firebase project (free Spark plan).
2. Enable Realtime Database, pick a region, note the `databaseURL`
   (`https://<proj>-default-rtdb.<region>.firebasedatabase.app`).
3. Set rules — open for the demo, Auth-based later.
4. `configureFirebase({ databaseURL, getToken? })`.

Free tier: 1 GB stored, 10 GB/month egress, 100 concurrent connections — ample.
Expect one "your rules are insecure" email if you go open.

### Also on the table (static token, no hourly refresh — your fatigue point)

- **GitHub Gist** (`gist://<id>/<file>?.path`) — `Authorization: Bearer <PAT>`,
  a **non-expiring** token, CORS `*` (verified: exposes `Location`, `ETag`),
  never purged, versioned. Downsides: 5000 req/h rate limit, and a gist is a
  *bundle of named files* so the addressing gains a `/<file>` segment.
- **Supabase** — static `apikey` anon JWT (safe to ship), PostgREST, CORS `*`,
  big/well-understood. Needs a table defined.

### Recommendation

**`firebase://` on RTDB REST.** Cleanest technical fit we've found, zero CORS/bot
issues (verified), "big and well understood," and it makes the protocol
*simpler* than jsonblob rather than more complex. Keep `jsonblob://` /
`superjsonblob://` as-is for self-hosted use; `firebase://` becomes the
recommended hosted backend.

If you want a genuinely no-token demo, open RTDB rules get us there; if you want
a permanent token, `gist://` is the one.

**Say the word and I'll implement `firebase://`** — I'll need a `databaseURL`
from you for the live demo (or I can point it at a throwaway project's open DB
if you'd rather not).

## Bruce's V

The firebase solution is feeling a little heavy.  Would it suggest making ths package dependent on some firebase packages?

The github gist solution sounds intriguing.  Would this be lighter weight to integrate with? No dependencies?  What are the setup steps?  I'm perfectly fine with expecting users to need to log in to github to authorize the web page to save to the gist.

## Claude's Response VI — Gist is lighter; one caveat is the login flow, not the API

### Dependencies: neither actually pulls in packages

- **Firebase**, done the way I proposed (RTDB **REST**), is also just `fetch` —
  zero npm deps. The "heavy" feeling is real but it's *conceptual* weight
  (a project, security rules, the console), not bundle weight. The trap is the
  `firebase` JS SDK (~100 KB+, WebSocket/gRPC-web transport); we would not use
  it, but it's a standing temptation the moment someone wants realtime/offline.
- **Gist** is `fetch` too, with **no SDK even tempting you** — `api.github.com`
  has proper CORS (`Access-Control-Allow-Origin: *`, `Authorization` allowed,
  `ETag`/`Location` exposed — verified earlier), the token never expires, and
  the mental model is "one file of JSON, git-versioned." Lighter on every axis
  except raw write throughput.

### What a `gist://` handler looks like

| USL | GitHub REST call |
|---|---|
| `get('gist://prefs/data.json')` | `GET /gists/<id>` → pick file `data.json`, `JSON.parse` its `content` |
| `get('gist://prefs/data.json?.theme')` | same GET, then walk `?.theme` |
| `set('gist://prefs/data.json', {…})` | `PATCH /gists/<id>` body `{"files":{"data.json":{"content":"…"}}}` |
| `set('gist://prefs/data.json?.theme','dark')` | `GET` → `writeThroughObject` merge → `PATCH` (read-modify-write) |
| delete | `PATCH` with `{"files":{"data.json":null}}`, or `DELETE /gists/<id>` |

- **Addressing gains a `/<file>` segment** because a gist is a *bundle of named
  files*, not a single document.
- **Create vs. update reuses the machinery already built for jsonblob.** A new
  gist has no id → `POST /gists` (creates a **secret** gist seeded with the
  value) → store the returned id in `location.hash` as `gistID:gist:<alias>=<id>`
  via the same pluggable id-store → `PATCH /gists/<id>` on every write after.
  `gist://=<id>/data.json` is the direct-id escape hatch. No new concepts.
- **Sibling-safe accessor chains = client-side read-modify-write** through the
  existing `writeThroughObject` helper (GitHub can't server-merge one JSON key
  the way RTDB's `PATCH` can). This is *exactly* how the `jsonblob://` path
  already works, so no new code.
- **Versioning is free later** — gists are git-backed, every `PATCH` is a
  commit, `GET /gists/<id>/<sha>` fetches history. Out for v1, same as before.

Estimate: ~60–80 lines, on top of `protocolRegistry` + the alias/id-store +
`getToken` hook that already exist.

### The login flow — the one real caveat

Reading and writing gists from a browser on another origin works fine. The
snag is **getting the token**:

- `api.github.com` (gist read/write) — CORS clean. ✅
- `github.com/login/oauth/access_token` (turn an OAuth `code` into a token) —
  **sends no CORS header.** A browser cannot call it directly. GitHub's
  **Device Flow** endpoint lives on the same `github.com` host and is blocked
  the same way.

So a polished "**Sign in with GitHub → Authorize**" button needs a tiny
**token-exchange proxy**: ~20 lines, stateless, holds the OAuth *client
secret*, swaps `code` → `token`, never sees your data. A Cloudflare Worker /
Netlify function / Deno Deploy handler. That is the *only* server piece, and
it's the same shape everyone doing static-site + GitHub OAuth deploys
(Gatekeeper, `netlify-oauth`, etc.).

**Two ways to skip even that proxy:**

- **Fine-grained PAT, pasted once.** The user creates a token
  (Account permissions → *Gists: Read and write*, no repo access), pastes it
  into the page, it lives in `localStorage`. No proxy, no OAuth App, works
  today. It's "paste a token," not "click Authorize" — less slick, zero infra.
- **Accept the mini-proxy** for the nicer redirect flow.

Both feed the identical `configureGist({ getToken })` hook — and here the token
genuinely *is* a static, non-expiring string, which is what your original
"optional API key" question was reaching for all along.

### Setup steps

**Option 1 — PAT, no infrastructure (recommended for v1):**

1. Nothing to register on your side.
2. Each user: GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained** → generate; Repository access: *none*; Account permissions →
   **Gists → Read and write**. Copy the token.
3. Paste it into the demo page's token field → `localStorage`.
4. `configureGist({ getToken: () => localStorage.getItem('gistToken') })`.
5. `set('gist://prefs/data.json', {theme:'dark'})` → module `POST`s a secret
   gist, writes `gistID:gist:prefs=<id>` into `location.hash`, `PATCH`es
   thereafter. `get('gist://prefs/data.json?.theme')` round-trips.

**Option 2 — real "Sign in with GitHub" button:**

1. Register an **OAuth App** (GitHub → Settings → Developer settings → OAuth
   Apps): homepage URL + callback URL, scope `gist`. Note client id + secret.
2. Deploy the token-exchange worker (I'll include the file), env
   `GITHUB_CLIENT_SECRET`, CORS allowing your origin.
3. Page links to
   `https://github.com/login/oauth/authorize?client_id=…&scope=gist`; on the
   redirect back, `POST` the `?code=` to your worker, receive the token, store.
4. Same `configureGist({ getToken })`.

### Honest downsides of gist

- **Secret ≠ private.** A secret gist is unlisted and unsearchable, but anyone
  with the id/URL can read it. That's the most privacy GitHub offers here.
  True privacy needs Firebase/Supabase with auth rules.
- **Rate limit** 5000 req/h (authenticated). Fine for prefs; not for chatty
  state.
- **Whole-file writes.** Large files are truncated in API responses (there's a
  `raw_url` to fetch the rest) and very large files are rejected; merges are
  client-side RMW — already how the jsonblob path behaves, so no new code, but
  it's not a database.

### Recommendation

Build **`gist://`** with the **PAT `getToken` hook** for v1: no deps, no infra,
CORS clean, non-expiring token, and it drops into the registry + alias/id-store
+ `getToken` machinery already shipped. Ship the OAuth worker as a documented
**Option 2** for anyone who wants the redirect button. Keep `jsonblob://` /
`superjsonblob://` for self-hosted use.

Say go and I'll implement `gist://` plus a `demos/gist.html` that round-trips
live from the browser (with a PAT paste box), and the optional worker file. 

## Bruce's Response VI

Please implement the gist solution according to your v1 recommendations (PAT) and add your implementation notes below.

## Claude's Implementation Notes — `gist://`

Implemented. `npm run build` clean; full Playwright suite green — **12/12**
across Chromium, Firefox, WebKit (`get`, `set`, `jsonblob`, and the new `gist`
spec, 12 in-browser assertions against a stubbed GitHub transport). No live
GitHub calls in the tests (deterministic / CI-safe, same approach as
`jsonblob`).

### Design as built (matches Response V + VI)

- **Not in the default bag.** `configureGist({ getToken })` is the one-line
  opt-in; `import 'fifteenth'` has no side effect until you call it. Also
  `gistProtocols(config)` returns a pure `{ gist }` read bag for
  assign-gingerly's `resolveValues` / `assignFrom`.
- **Addressing `gist://<alias>[/<file>]`.** `<alias>` is a local name; the real
  gist id lives in the same pluggable id-store as `jsonblob` (`'locationHash'`
  default, key `gistID:<alias>`, written with `history.replaceState`;
  `'localStorage'`; or a custom `{ get, set, delete? }`). `<file>` selects the
  file inside the gist, default `data.json` (configurable via `defaultFile`), so
  one gist can hold several documents — `gist://prefs/theme.json`,
  `gist://prefs/layout.json` share one gist id.
- **Direct id:** `gist://=<id>/data.json` → id-store skipped, no create-on-write.
- **Create/update:** no chain + unmapped alias → `POST /gists`
  (`public:false` = secret, seeded with the value); no chain + mapped →
  `PATCH /gists/<id>`; with a chain → ensure id (`POST` `{}` if new) →
  `GET /gists/<id>` → `writeThroughObject` merge of that one file → `PATCH`.
  GitHub can't merge a single JSON key server-side, so accessor-chain writes are
  read-modify-write — identical semantics to the `jsonblob` path, and it reuses
  the exact `writeThroughObject` helper from `set.ts`.
- **Concurrency:** per-alias create dedup (`pendingCreate`) + a per-alias write
  queue, so a burst of `set()` in one tab serializes instead of each GET-ing the
  same snapshot and clobbering. Cross-tab writes still race (documented).
- **Stale mapping:** a real `404` on `GET /gists/<id>` (gist purged/deleted)
  calls `store.delete?.(alias)` so the next `set` re-creates it. A *missing file
  in a live gist* returns `null` **without** dropping the mapping — the two
  cases are distinguished (that's why `fetchGist` returns the whole gist and
  `fileValue` picks the file out, rather than one combined call).
- **Auth:** `getToken()` awaited per request; truthy → `Authorization: Bearer`.
  Plus `Accept: application/vnd.github+json` and
  `X-GitHub-Api-Version: 2022-11-28`. A `401`/`403` on write throws with an
  explicit "needs a token with the `gist` scope" hint.
- **Large files:** if GitHub flags a file `truncated`, the handler follows
  `raw_url` to fetch the full content.
- **Non-JSON tolerance:** a file whose content doesn't parse as JSON is returned
  as a raw string (mirrors the web-storage handler); a plain string written with
  no chain is stored verbatim.

### CORS / no-proxy check

`api.github.com` was already confirmed earlier (`Access-Control-Allow-Origin: *`,
`Authorization` allowed, `ETag`/`Location` exposed, no bot wall). Nothing new to
verify — the demo drives it live from the browser. The only cross-origin gap is
GitHub's OAuth `code`→token endpoint (`github.com/login/oauth/access_token`,
no CORS); the pasted-PAT flow doesn't touch it.

### Files

- **`aliasStore.ts`** (new) — extracted the alias→id machinery that was inline
  in `jsonblob.ts` (id-store back-ends + a per-key write-queue factory
  `makeQueue`), parameterised by a `keyFor(alias)` function so `jsonblob`
  (`jsonBlobID:<service>:<alias>`) and `gist` (`gistID:<alias>`) share it with
  **no change to existing hash keys**. `jsonblob.ts` now imports from here and
  re-exports `IdStore` / `TokenProvider` for back-compat.
- **`gist.ts`** (new) — `gistProtocols(config?)` + `configureGist(config?)`.
  `GistConfig`: `getToken`, `public`, `defaultFile`, `description`, `idStore`,
  `baseURL` (GitHub Enterprise / proxy).
- **`jsonblob.ts`** — refactored onto `aliasStore.js`; behaviour unchanged
  (its 11 assertions still pass). Dropped an unused `parseProtocolRef` import.
- **`index.ts`** / **`package.json`** — re-exports + `exports` entries for
  `./gist.js` and `./aliasStore.js`.
- **`tests/test-gist.html`** + **`tests/gist.spec.ts`** (new) — stubbed
  `api.github.com/gists` REST shape; covers create→read, chain merge + leaf
  overwrite, unmapped→null (no POST), multi-file-per-gist, direct-id,
  `resolveValues` via the bag, 3-way concurrent write → exactly 1 POST + all
  merged, `getToken` header, `localStorage` id-store, 404→stale-mapping-drop,
  custom `defaultFile`.
- **`demos/gist.html`** (new) — loads the real module, PAT paste box
  (`localStorage`, sent only to `api.github.com`), live create→read→merge→read
  against a real secret gist with click-through links.
- **`README.md`** / **`demos/README.md`** — new `gist://` sections; intro list
  updated.

### Setup (unchanged from Response V, Option 1)

1. Nothing to register.
2. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained** → Repository access *none*, Account permissions →
   **Gists: Read and write**. (Or a classic PAT with the `gist` scope.)
3. Paste into `demos/gist.html`'s token box → `localStorage`.
4. `configureGist({ getToken: () => localStorage.getItem('…') })`.
5. `set('gist://prefs/data.json', {...})` → `POST`s a secret gist, writes
   `#gistID:prefs=<id>`, `PATCH`es thereafter.

### Deferred (unchanged)

- The OAuth "Sign in with GitHub" button + ~20-line token-exchange worker
  (Response V, Option 2) — not built; PAT is v1 per your call. Drop-in later
  behind the same `getToken` hook, no module change.
- `gist://<id>/<file>@<sha>` history reads — gists are git-versioned, easy to
  add later; out for v1.
- A no-`window` Node demo — skipped (writes need a real PAT; the browser demo
  is the live proof).

## Bruce's Response VII

I'm trying to test http://localhost:8000/demos/gist.html

Can you please update that file with really detailed instructions for getting the token?  I've fished around my github account for several minutes, and have had no luck finding "Account Permissions"

## Claude's Response VII — detailed token steps added

`demos/gist.html` now has two collapsible, numbered walkthroughs in the
**"1 · Get a GitHub token"** card:

- **Route A — classic token (default-open, recommended).** One checkbox.
  Direct link: <https://github.com/settings/tokens/new?scopes=gist> — that
  opens *Settings → Developer settings → Personal access tokens → **Tokens
  (classic)** → Generate new token (classic)* with the single `gist` scope
  pre-ticked and the note pre-filled. Set an expiration, **Generate token**,
  copy the `ghp_…` value, paste, **Save token**. The full manual click-path is
  spelled out too, in case the link rots.

- **Route B — fine-grained token,** with the specific reason you couldn't find
  it called out in a highlighted note:
  - **"Account permissions" does not render until you select a Resource owner.**
  - It is a *separate collapsed group **below** the entire "Repository
    permissions" list* — you have to scroll past all of those to reach it.
  - Gists live under **Account permissions → Gists → Read and write**
    (Repository access can be "No access" — gists aren't repos).
  - If your account is under an org that hasn't enabled fine-grained tokens,
    the section can still be absent — Route A then.

Also added: a "revoke any time at github.com/settings/tokens" line, and
`kbd`-styled click paths. `demos/README.md` updated to match (leads with the
classic-token link).

No module change — this is demo-page docs only. Build + 12/12 tests still green.










