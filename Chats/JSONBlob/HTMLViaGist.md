# HTML Via Gist

## Bruce's Ask

I'm really impressed by the github gist persistence approach so far.

Ibe thing though.  Technically, is there a way to store HTML (or markdown) to a gist, and make some sort of "API" call to github that returns a stream of the HTML that wa saved to the gist?

Please provide your findings below.

## Claude's Findings

**Short answer:** yes, you can store HTML/Markdown in a gist and read it back as
a byte stream over a plain `GET` — the `fifteenth` `gist://` handler already
returns it as a string today. What you *cannot* get is GitHub serving that file
as a **rendered, browser-navigable HTML page from its own domain**: every gist
file is forced to `Content-Type: text/plain` with `nosniff` and
`X-Frame-Options: deny`. Rendering-as-a-page means either injecting the fetched
text yourself (`iframe.srcdoc`) or going through a third-party proxy CDN.

### Three ways to read the content back

**1 — Inline in the REST response.**
`GET https://api.github.com/gists/<id>` returns, per file:

```jsonc
"files": {
  "page.html": {
    "type": "text/html",          // stored MIME (informational)
    "language": "HTML",
    "raw_url": "https://gist.githubusercontent.com/<user>/<id>/raw/<sha>/page.html",
    "size": 20480,
    "truncated": false,
    "content": "<!doctype html>…"  // the whole file, inline
  }
}
```

One request, `Access-Control-Allow-Origin: *`, `Authorization: Bearer <token>`
for a secret gist. Limit: `content` is inlined **up to 1 MB**; past that
`truncated: true` and you must fall back to `raw_url` (which serves up to
~10 MB; bigger still → `git clone` the gist, it's a real repo).

**2 — The raw file URL** (`files[...].raw_url`). Verified headers today:

| Header | Value |
|---|---|
| `Content-Type` | `text/plain; charset=utf-8` — **always, even for `.html`** |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `deny` |
| `Access-Control-Allow-Origin` | `*` |
| `Cache-Control` | `max-age=300` |

`fetch(raw_url)` → `response.body` is a `ReadableStream`; that is your "stream of
the HTML." The `raw_url` from the API embeds the **commit SHA**, so it is an
immutable permalink to that exact revision. Strip the SHA
(`…/raw/page.html`) to get an "always latest" URL that 302-redirects to the
current revision (with the 5-minute cache above).

Because of `text/plain` + `nosniff` + `X-Frame-Options: deny`, you **cannot**
`<iframe src>` a raw gist URL and see it render, nor use it as
`<script src>` / `<link href>`. You *can* `fetch()` it (CORS is open) and then
`iframe.srcdoc = text` or feed it to a renderer.

**3 — A rendering proxy** (only when you need a URL that renders as a page):

- **jsDelivr** — `https://cdn.jsdelivr.net/gist/<user>/<gist-id>[/<file>]`.
  Serves with a real extension-based `Content-Type` and `Access-Control-Allow-Origin: *`,
  so an `.html` file loads as a page and `.mjs` as a module. **Public gists
  only**, ~20 MB/file, cached ~12 h (purgeable via their API). Gist support was
  added in 2021 (jsdelivr/jsdelivr#18276); my probes from this datacenter IP
  404'd, so confirm the exact path from a real browser.
- **githack** — `https://gist.githack.com/<user>/<id>/raw/<file>` (dev, no
  cache) or `raw.githack.com` (prod, cached). Proxies with the correct
  `Content-Type`; works for **secret** gists too. (Returned 403 from this
  sandbox's IP — an edge bot-block, not a URL problem; fine from a normal
  browser.)

Both execute your HTML in *their* origin — fine for your own content, worth a
second thought before rendering someone else's gist HTML that way.
(GitHub's own `gist.github.com/<user>/<id>` page renders `.md`, and shows `.html`
as source, but it's a full GitHub-chrome page, not cleanly embeddable. GitHub
**Pages** is the "serve rendered HTML" product — but that's a repo, not a gist.)

### Markdown specifically

- **GitHub Markdown API**: `POST https://api.github.com/markdown`, body
  `{"text": "...", "mode": "gfm"}` → rendered HTML string. CORS `*`; counts
  against the 60/h unauth or 5000/h authenticated budget. Flow: store `.md` in
  the gist → read it (way 1 or 2) → POST to `/markdown` → inject.
- Or render client-side with a Markdown JS lib — no extra request, no rate
  limit, works offline-ish.

### How this lands in `fifteenth`

- **Reading already works.** `get('gist://mypage/index.html')` returns the HTML
  as a string right now: `fileValue()` attempts `JSON.parse`, it throws, and the
  raw string is returned. The `truncated` → `raw_url` fallback is already in
  `fileValue()`, so >1 MB HTML is handled too.
- **Writing already works.** `set('gist://mypage/index.html', '<!doctype html>…')`
  stores the string verbatim (`serialize()` passes strings through; the new
  `gistContent()` guard only rejects an *empty* string).
- **What the module deliberately doesn't give you:** a `raw_url` or a
  `ReadableStream` — it's a *value* store, not a blob server. If you want the
  streaming/servable-URL half, a ~15-line companion helper could expose e.g.
  `gistRawURL(alias, file)` and `gistStream(alias, file)` by doing the
  `GET /gists/<id>` and returning / re-fetching `files[file].raw_url`. Optional
  follow-up, no change to the protocol handler.

### Gotchas

- **"Secret" ≠ private.** The `raw_url` (and a public-gist jsDelivr URL) is
  reachable by anyone who has the link.
- **No `text/html` ever** from `gist.githubusercontent.com`, and `X-Frame-Options: deny`
  — plan on `srcdoc` or a proxy, not a direct `iframe src`.
- **Raw URLs are separately abuse-rate-limited** (not the documented API
  60/5000). Fine for personal use; don't build a CDN on raw gist URLs.
- **`raw_url` SHA changes on every edit;** the SHA-less URL propagates "latest"
  within the ~5-minute `max-age`.

