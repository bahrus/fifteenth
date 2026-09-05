# Strategy

## Bruce's Ask

This package began with the intention of moving the a significant part of the overloaded trans-render package into this standalone package.  As such, I copied in the relevant files from trans-render and placed them in the legacy/XV folder.

The conversion process began, but was far from complete.

In the meantime, a significant development relevant to this package arose with the introduction of [protocols in the assign-gingerly package](https://github.com/bahrus/assign-gingerly#protocol-resolution-in-getvalues-and-assignfrom).

If I'm not mistaken, the documented (but not implemented) [drawFrom](/README.md#one-time-pull-of-multiple-resources) is now "eclipsed" by assign-gingerly's [resolveValues](https://github.com/bahrus/assign-gingerly#protocol-resolution-in-getvalues-and-assignfrom) function.  Can you confirm?

So from the point of view of reading values from these protocols, this package should just focus on implementing the core lookup, before the question mark markers, not on parsing the string before the :// or starting at the first ?. .  Does that make sense?

Some of what is in this package, then becomes quite trivial (globalThis, localStorage, sessionStorage).  Perhaps those could just be placed on one module with an appropriate name (tbd).

Then a natural question becomes:

>  If it made more sense for assign-gingerly to provide the foundation for pulling in values from various places, leaving the particulars to packages like this one, does it make sense for assign-gingerly to provide the foundation for stowing values as well?

I *think* that would mean allowing the lhs of assign-gingerly or at least assign-from to support protocol paths, which it currently doesn't do, I believe.

But I'm leaning against that a bit.  It feels like we are really veering away from the idea that the assign-* is merging things into a single object.  But I would be interested in hearing your honest take.

Are we on the same page at all?  Do you have any alternative thoughts on what the scope of this package should be?


## Claude's Take

Short version: yes, we're on the same page. `drawFrom` is eclipsed by `resolveValues`. The right move is to narrow this package to *protocol handlers plus the write/subscribe side*, and to **not** push the write side into assign-gingerly.

### 1. `drawFrom` is eclipsed — confirmed

`resolveValues(pattern, source, { protocols })` takes exactly the shape `drawFrom` took: a map of keys to protocol strings, resolved (async) into an object. assign-gingerly already owns:

- detecting `://` and matching the prefix against a `protocols` bag
- slicing out the key portion (between `://` and the first `?.`)
- resolving a trailing `?.` chain against the handler's result via `getValue`
- the sync/async split (`getValues`/`assignFrom` vs `resolveValues`/`assignFromAsync`)

What it deliberately does *not* ship is the handler functions themselves — `(key) => ...`. That's the hole this package fills. So `drawFrom` as a standalone function is dead weight. What fifteenth should export in its place is a **ready-made `protocols` object**:

```js
import { protocols } from 'fifteenth/protocols.js';
import { assignFromAsync } from 'assign-gingerly/assignFromAsync.js';

await assignFromAsync(target, source, { protocols });
```

The README's "One-time pull of multiple resources" section should be rewritten to show that, not `draw({...})`.

### 2. Draw the grammar boundary explicitly

Your instinct — "focus on the core lookup, before the `?.` markers, not the string before `://`" — is the right line, with one refinement. There are **two** grammars in a USL:

| Layer | Example | Owner |
|---|---|---|
| Outer | `‹protocol›://‹key›?.‹chain›`, sync vs async | assign-gingerly |
| Inner (per protocol) | `myDB/myStore/myKey`, `[7]`, `[7..17]`, `[]`, `{…filter…}` | **fifteenth** |

assign-gingerly hands your handler everything between `://` and the first `?.`. For `indexedDB://myDB/myStore[7..17]` that's `myDB/myStore[7..17]` — and parsing *that* (the `/` splitting, the bracket row-syntax, the Mongo-ish filters) is genuinely fifteenth's job and nobody else's. So fifteenth still has a parser, just a smaller, protocol-specific one. It should **not** re-implement the outer split — ideally assign-gingerly factors its USL tokenizer into a tiny shared module (or a sibling in the `types` submodule) that fifteenth imports. If it won't, keeping ~20 lines of `parse.ts` here is a cheap fallback.

One wrinkle to flag: for the tabular/filter cases the handler returns an **array**, and assign-gingerly then resolves `?.foo` against that array with `getValue`, which almost certainly won't "map over rows." So the clean boundary holds for scalar reads but gets fuzzy for `[]`/`[a..b]` + accessor chain. Worth deciding early whether array-result protocols consume their own accessor chain.

### 3. Yes, collapse the trivial protocols into one module

`globalThis`, `localStorage`, `sessionStorage`, `cookie`, `locationHash` are all one-liners once the outer parsing is gone. Put them in a single module (`ambient.js`? `stores.js`? — name TBD) exporting the sync handlers. `indexedDB` is the only one that needs real code; keep it separate (`idb.js`). Then `protocols.js` just assembles the bag:

```
protocols/
  ambient.js      globalThis, localStorage, sessionStorage, cookie, locationHash
  idb.js          the real IndexedDB wrapper
  index.js        { ...ambient, indexedDB }
```

A thin `get(usl)` convenience wrapper is still worth keeping for the single-resource case — implement it on top of the shared parser + the bag so there's exactly one code path.

### 4. Don't put the write side in assign-gingerly — you're right to lean against it

Here's the sharper reason. `assignGingerly` / `assignFrom` has one coherent mental model: **there is a single target object, and you are building it up.** RHS protocol resolution fits that perfectly — the *sources* can be anywhere, the *target* is still a plain object in memory that gets returned.

Protocol paths on the LHS break that model. "Assign" would suddenly mean "scatter these values out to six different browser stores" — that's not a merge, it's a **router / demultiplexer**. Different everything:

- no meaningful return value (vs. the merged object)
- partial-failure and cross-store transaction semantics
- fire-and-forget lifecycle plus the `postMessage` broadcast of changed USPs
- batching / grouping wants that the read path never needs

Cramming that into `assignGingerly`'s options bloats a primitive whose whole appeal is that it's small.

So: **`set` / `stow` stay here, as first-class exports.** The symmetry with assign-gingerly is "same grammar, opposite direction," not "same function." Share the parser, not the entry point. If assign-gingerly ever wants a symmetric `assignTo(target, source, { protocols })` where the *target* keys are protocol strings, I'd still argue the storage-specific write logic lives in fifteenth and assign-gingerly only does the routing dispatch — its job ends at "produce the object," fifteenth's `stow` begins at "take an object and distribute it."

### 5. What fifteenth's scope becomes (the positive definition)

Reframe the package as **the protocol-handler library for the USL grammar**, owning four things:

1. **Per-protocol source addressing** — the indexedDB db/store/key triple, row brackets and ranges, filters; cookie encoding variants (`cookie` vs `abcookie`); hash key/value encoding.
2. **A drop-in `protocols` bag** for assign-gingerly's `resolveValues` / `assignFrom` / `assignFromAsync`.
3. **The write side** — `set` / `stow`. No equivalent exists elsewhere and shouldn't.
4. **The reactive / subscription side** — `gait`, `Wrapper`, the `@source` decorator, the `postMessage` protocol keyed by USP. *Nothing else does this.* It's the strongest reason the package exists and it's currently buried at the bottom of the README as "[WIP]". It deserves to be the headline.

What fifteenth explicitly does **not** own: the outer USL string grammar, object-merge semantics, the `?.` accessor-chain resolver. Dependency direction is fifteenth → assign-gingerly (never the reverse); assign-gingerly stays storage-agnostic with zero knowledge of fifteenth, and a consumer wires the two together.

### 6. Housekeeping / open questions

- `package.json` still points `main` at a non-existent `xv.js`, and `homepage`/`repository` say `xvth`. Pick the name.
- Decide the array-result + accessor-chain question from §2 before building the tabular protocols.
- Confirm whether assign-gingerly will expose its USL tokenizer as an importable primitive — that decision determines whether `parse.ts` stays here.
- The `legacy/XV` code still imports types from `trans-render/XV/types.js`. If those types (`USL`, `ParsedUSL`, `SavingContext`, `WrapperConfig`) are part of the migration, they should land in this package or the `types` submodule, not stay pointed back at trans-render.
