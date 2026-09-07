# demos

Live, un-stubbed checks of the `jsonblob://` / `superjsonblob://` persistence
path. The unit tests (`tests/test-jsonblob.html`) stub `fetch` for determinism;
these hit real servers.

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
