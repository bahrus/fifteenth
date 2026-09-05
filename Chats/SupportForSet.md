# Support For Set

## Bruce's Ask

As I understand where things stand, we've not yet implemented:

One-time push of single resource:

```JS
import {set} from 'fifteenth/set.js';
await set('indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject', currentVal);
```

which fires
Fires:

window.postMessage([
    'indexedDB://myDB/myStore/myKey',
    'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject'
])

Similar to the assign-gingerly package, this will automatically create empty objects, if the sub paths aren't yet found, and will not replace existing sub objects if they all ready exist, unless the path exactly matches.

Let me know if further clarity is needed before implemented below.  If not, please implement, and add your implementation notes below.

## Claude's Implementation Notes

Implemented. `npm run build` clean, `set.spec.ts` green on Chromium (17
in-browser assertions), `get.spec.ts` still green.

### New / changed files

- **`set.ts`** (new) — `set(usl, val, ctx?)` plus the `SavingContext` type.
- **`index.ts`** — re-exports `set` and `type SavingContext`.
- **`package.json`** — added the `./set.js` entry to `exports`.
- **`tests/test-set.html`** + **`tests/set.spec.ts`** (new) — same in-browser /
  Playwright pattern as `get`.
- **`README.md`** — "One-time push of single resource" rewritten to describe the
  implemented merge semantics, the broadcast shape, and the saving-context
  batch path.
- **`set.js`** compiled alongside (committed, like the others).

### How it works

`parseProtocolRef(usl)` (from assign-gingerly) splits the outer grammar into
`{ protocol, key, path }`; `path` (`?.a?.b` or `null`) becomes `['a','b']` / `[]`.
A `switch` on `protocol` dispatches to a small per-protocol writer. When a chain
is present, the structured stores (`globalThis`, `localStorage`,
`sessionStorage`, `indexedDB`) do read → merge → write:

```
root = (stored value is an object) ? stored value : {}
walk root along parts[0..n-2], creating {} at any missing / non-object segment
root<...>[parts[n-1]] = val
write root back
```

`evaluatePath` is the ~6-line local hand-roll of assign-gingerly's create-on-write
path walk (Strategy §6 item 5 — the exported `evaluatePathWithAsyncMethods` is
entangled with `withMethods` / permission machinery `set` has no use for). It
descends into existing intermediate objects and only ever overwrites the exact
leaf, which is the "don't replace existing sub objects unless the path exactly
matches" behavior you asked for.

### Change broadcast

`window.postMessage(msgs)` where `msgs` is an **array**: `[usp]` with no chain,
`[usp, usl]` with one (`usp = ${protocol}://${key}`). This follows the array
shown in the README rather than the `Set` the legacy `XV/set.ts` used — worth
knowing when `gait` gets ported (it should accept the array form, or we
normalize at the boundary).

Passing `ctx: { usls: Set<string> }` switches `set` from broadcasting to
collecting: every `usp` / `usl` it would have posted is added to `ctx.usls`, and
the batch driver (a future `stow`) posts once. That's the seam `stow` will build
on.

### Decisions worth your eye

1. **`globalThis` is writable** (`set('globalThis://a/b/c', v)` → creates
   `a`,`b`, sets `c`). Legacy `XV/set.ts` didn't handle `globalThis` at all, but
   `get` does, so `set` matches it for symmetry. Say the word if you'd rather it
   throw.
2. **No special `null` handling.** `set(usl, null)` stores the literal `null`
   everywhere (round-trips cleanly through `get` for the structured stores).
   Legacy `XV/Storage.set` treated `null` as "removeItem"; I dropped that so
   `set` never secretly means *delete*. A dedicated `del(usl)` / `unset(usl)` is
   the cleaner home for removal if you want it.
3. **`cookie` / `locationHash` reject an accessor chain** (they hold scalar
   strings). Non-string values are `JSON.stringify`-encoded on write; `get`
   returns them as the raw string (no decode), matching the existing ambient
   read handlers. The legacy `Hashit` open/close-delimiter hash encoding is not
   used — `locationHash` read & write are both plain `URLSearchParams` now.
4. **`indexedDB` object-mode only** (`{ keyPath: 'key' }`), via the existing
   `IDBObjectStore`. Tabular `[]` / `[a..b]` / `{filter}` writes are still
   unbuilt.
5. **Web Storage cache layer skipped.** Legacy `XV/Storage` kept an in-`window`
   object cache gated on `navigator.deviceMemory`. Left out — it's an
   optimization that belongs with the subscription/`gait` work, not `set`.

### Not done (out of scope)

`stow` (multi-push), `gait` (wait-for-value / subscription), and the tabular
IndexedDB write syntax. `set` deliberately leaves the `SavingContext` seam for
`stow`.