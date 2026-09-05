# Tasks

## Bruce's Ask

As we [discussed earlier](./Strategy.md), assign-gingerly has now been modified in order to share the parsing of protocols.  And I added a dependency to assign-gingerly to this package that wasn't there before.  We deviated a bit from the script in the previously linked document -- the parsing helpers are available as exports from assign-gingerly/resolve/getValues.js, rather than a dedicated helper module.

There is a [tasks document](../.kiro/specs/get-one-time-pull/tasks.md) that may or may not be inaccurate.  I do see an idb.ts file.  This was done a long time ago, and I didn't maintain histories of chats like I'm doing now, so I just don't recall how far we got.  I almost wonder if we should "start over".  

I do see a tests directory, which seems to suggest we made good progress, we just need to recalibrate things to work closely with assign-gingerly package.

Do you have enough to go on to do this recalibration?  If so, please implement, and add your implementation notes below (and update the README.md accordingly)

If not, please add clarifications needed below.

## Claude's Implementation Notes

Yes — there was enough to go on. The recalibration is done and the existing
tests (plus new ones) are green on Chromium.

### What changed

| Before | After |
|---|---|
| `parse.ts` re-implemented the `://` + `?.` split | **Deleted.** `get.ts` imports `parseProtocolRef` from `assign-gingerly/resolve/getValues.js` |
| `get.ts` was a big `switch` that also did accessor-chain traversal | `get.ts` is now ~15 lines: `parseProtocolRef` → look up handler in the `protocols` bag → `await handler(key)` → `getValue(path, base)` for the `?.` tail |
| No handler bag; nothing consumable by assign-gingerly | `protocols` bag exported from `fifteenth/protocols.js` |
| `idb.ts` had only the `IDBObjectStore` class | Added `indexedDBHandler` (async protocol handler) alongside the class |
| `package.json` `main: xv.js`, urls said `xvth` | `main: index.js` (+ new `index.ts`), urls fixed to `fifteenth`, `exports` map added |

### New / changed files

- **`ambient.ts`** (new) — synchronous handlers for the five trivial stores
  (`globalThis`, `localStorage`, `sessionStorage`, `cookie`, `locationHash`),
  exported both individually-assembled as `ambientProtocols` and re-exported
  through `protocols.ts`. Also defines the local `ProtocolHandler` /
  `ProtocolHandlers` type aliases (see "Deviations" below).
- **`idb.ts`** (changed) — unchanged `IDBObjectStore`; added
  `indexedDBHandler: ProtocolHandler` which splits the key on `/` into
  `dbName/storeName/key`, opens the store, reads, and always closes.
- **`protocols.ts`** (new) — `export const protocols = { ...ambientProtocols, indexedDB: indexedDBHandler }`.
  This is the headline export.
- **`get.ts`** (rewritten) — thin wrapper; one code path shared with
  `resolveValues`/`assignFromAsync`.
- **`index.ts`** (new) — top-level re-exports (`protocols`, `get`,
  `IDBObjectStore`, `indexedDBHandler`, `ambientProtocols`, the types).
- **`parse.ts`** — deleted.
- **`tests/test-get.html`** — import map now also maps `assign-gingerly/` to
  `/node_modules/assign-gingerly/`; added three tests: a `globalThis` accessor
  chain, a multi-store `resolveValues` pull through the bag, and an async
  `indexedDB` pull through the bag.
- **`.gitignore`** — swapped the `parse.*` ignore entries for
  `index.*` / `ambient.* `/ `protocols.*`.
- **`.kiro/specs/get-one-time-pull/tasks.md`** — rewritten to match reality.
- **README.md** — "One-time pull of multiple resources" now shows the
  `protocols` bag with `resolveValues` / `assignFromAsync` instead of
  `drawFrom`; the old `trans-render/weave` integration section is replaced with
  an "Integration with assign-gingerly" section drawing the grammar boundary.

### Deviations from Strategy.md

1. **Flat layout, not a `protocols/` subdirectory.** Strategy §3 sketched
   `protocols/{ambient,idb,index}.js`. The repo keeps everything at the root
   (and `tsconfig` `include` is `*.ts`, non-recursive), so a subdirectory would
   have meant extra config churn for no real gain. Files are `ambient.ts`,
   `idb.ts`, `protocols.ts` at the root. Easy to fold into a folder later.
2. **Local handler types.** `assign-gingerly/resolve/getValues.js` exports the
   *functions* (`parseProtocolRef`, `hasProtocol`, `getValue`) but not the
   *type* names `ProtocolHandler` / `ProtocolHandlers` (they live in
   `types/assign-gingerly/types.d.ts`, which isn't in assign-gingerly's
   `exports` map). So `ambient.ts` defines its own one-line aliases. If
   assign-gingerly ever re-exports those types from `resolve/getValues.js`,
   switch the aliases to `import type`.
3. **`globalThis://a/b?.c` no longer throws.** The old code special-cased
   `globalThis` to reject an accessor chain. Under the shared grammar the `?.`
   tail is just resolved against the handler's result like every other
   protocol, so the restriction was dropped for consistency with bag usage.
4. **`get()` built locally, not from an assign-gingerly export.** There's still
   no exported "resolve one (possibly async) protocol string to one value" in
   assign-gingerly (`resolveValue` is sync `getValue` and skips protocols), so
   `get()` composes `parseProtocolRef` + bag + `getValue` itself — ~15 lines,
   exactly as Strategy §3 anticipated.

### assign-gingerly asks — status

Items 1 and 2 from "Claude's Response (re: exportable primitives)" are **already
in** `assign-gingerly@0.0.96`: `parseProtocolRef` / `hasProtocol` are exported
from `resolve/getValues.js` (and the package index), and `ProtocolHandler` /
`ProtocolHandlers` / `SyncProtocolHandler(s)` / `ParsedProtocolRef` are defined
in its types. The only remaining nicety: **re-export those handler type names
from `resolve/getValues.js`** (or the index) so downstream packages can
`import type` them instead of hand-rolling aliases (deviation #2).

### Verification

- `npm run build` — clean (`typescript@7.0.2`).
- `npx playwright test --project=chromium` — 1 spec / 18 in-browser assertions,
  all pass.
- Firefox / WebKit not run here — browsers aren't installed in this
  environment (`npx playwright install` needed); nothing browser-specific
  changed.

### Not done (out of scope for this pass)

`set` / `stow` / `gait` and the tabular/`{filter}` IndexedDB syntax are still
legacy-only. The write and subscribe side is, per Strategy §5, where this
package's real weight should eventually go — worth its own spec session.