# demos

Live, un-stubbed checks of the `gist://` persistence path. The unit tests
(`tests/test-*.html`) stub `fetch` for determinism; this one hits a real server.

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
