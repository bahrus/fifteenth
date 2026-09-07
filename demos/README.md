# demos

Live, un-stubbed checks of the remote-protocol persistence paths
(`jsonblob://` / `superjsonblob://`, `gist://`). The unit tests
(`tests/test-*.html`) stub `fetch` for determinism; these hit real servers.

## `jsonblob.html` — browser, jsonblob.com

```
npm run serve
# open http://localhost:8000/demos/jsonblob.html
```

Loads the real `fifteenth/jsonblob.js`, calls `configureJsonBlob()`, and runs a
create → read → merge → read round-trip against **jsonblob.com**. Shows the
server-assigned blob id (also stored in the page URL hash) with links to inspect
the blob on jsonblob.com. There's a manual `set()` / `get()` panel too.

jsonblob.com sends `Access-Control-Allow-Origin: *`, so this works from any
origin — **in a normal browser on a normal connection**. Cloudflare bot-blocks
POST/PUT from many datacenter / CI IP ranges; from such a host the page reports a
fetch failure (surfacing as a CORS error, because the 403 page carries no CORS
header).

## `jsonblob-node.mjs` — Node, no browser

```
npm run demo:jsonblob                 # superjsonblob.com  (default)
node demos/jsonblob-node.mjs jsonblob # jsonblob.com
```

Same round-trip against the compiled module from Node. Defaults to
**superjsonblob** because it answers from anywhere (no Cloudflare bot wall);
it has no CORS headers so a browser can't drive it cross-origin, but Node
doesn't enforce CORS and the two services are wire-compatible, so the
persistence logic exercised is identical. Uses an in-memory id-store (the
`locationHash` default needs `window`) and a `SavingContext` (keeps `set()`'s
change broadcast off `window.postMessage`).

## `gist.html` — browser, GitHub Gist

```
npm run serve
# open http://localhost:8000/demos/gist.html
```

Loads the real `fifteenth/gist.js`, calls `configureGist({ getToken })`, and
runs a create → read → merge → read round-trip against a real **secret gist**
on `api.github.com`. Paste a GitHub token with the **gist** scope into the page
first — the page has step-by-step instructions for both token types. Quickest is
a **classic token**: open
<https://github.com/settings/tokens/new?scopes=gist> (that's *Tokens (classic)*,
with the one `gist` scope pre-ticked), set an expiration, **Generate token**,
copy the `ghp_…` value. (The fine-grained equivalent is *Account permissions →
Gists → Read and write*, but that section only appears once you pick a Resource
owner and sits below the whole Repository-permissions list.) The token is kept
in `localStorage` and sent only to `api.github.com`.
The gist id lands in the page URL hash (`#gistID:<alias>=<id>`); reload reuses
the same gist, **Forget id** starts a new one. `api.github.com` sends permissive
CORS and there's no bot wall, so this works from any origin with no proxy — the
only thing a browser can't do cross-origin is the OAuth `code`→token exchange,
which the pasted PAT sidesteps.
