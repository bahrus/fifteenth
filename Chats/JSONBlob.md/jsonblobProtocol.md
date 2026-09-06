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

The code checks if the hash portion of the current url has an embedded "jsonBlobID=..." in it, which doesn't interfere with other hash portion name value pairs (use & delimiter?).

If no id found, first 

