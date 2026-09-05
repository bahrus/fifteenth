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

## Bruce's Response

> - Confirm whether assign-gingerly will expose its USL tokenizer as an importable primitive — that decision determines whether `parse.ts` stays here.

Can you please outline below what existing (or slightly enhanced existing) code that assign-gingerly currently has that could be made exportable, that would be helpful to this package?  I will then take that recommendation to the assign-gingerly package and make it so.

## Claude's Response (re: exportable primitives)

I read through `resolve/getValues.ts` and `resolve/resolveValues.ts` on the `baseline` branch. The outer-grammar logic fifteenth would otherwise duplicate already exists there — but it's trapped inside two private, near-identical functions: `getProtocolValue` (sync, in `getValues.ts`) and `resolveProtocolValue` (async, in `resolveValues.ts`). Both do the same three-line dance:

```ts
const protoEnd = value.indexOf('://');
const protocol = value.substring(0, protoEnd);
const rest    = value.substring(protoEnd + 3);
const pathStart = rest.indexOf('?.');
const key  = pathStart === -1 ? rest : rest.substring(0, pathStart);
const path = pathStart === -1 ? null : rest.substring(pathStart);
```

### 1. (Must) Extract that into one exported pure function

New tiny module, e.g. `resolve/parseProtocolRef.ts`:

```ts
export interface ParsedProtocolRef {
    protocol: string;        // '' when there is no '://'
    key: string;             // between '://' and the first '?.'
    path: string | null;     // from '?.' onward (starts with '?.'), or null
}

export function parseProtocolRef(value: string): ParsedProtocolRef;
export function hasProtocol(value: string): boolean;   // value.includes('://')
```

Then refactor `getProtocolValue` and `resolveProtocolValue` to *call* it (dedupes them — pure win for assign-gingerly too), and re-export `parseProtocolRef` / `hasProtocol` from `index.ts`.

**Why fifteenth needs it:** when fifteenth is used *through* `assignFrom({ protocols })` it never parses anything — it just supplies handlers. But fifteenth also ships its own sugar (`get(usl)`, `set(usl)`, `gait(usl)`, `Wrapper`, `@source`) that takes a full USL string. Those entry points should split the outer grammar with assign-gingerly's exact rules, not a private `parse.ts` copy that silently drifts. It's only ~8 lines of logic, but making it the single source of truth means if the delimiter ever changes or `?.`-escaping gets added, fifteenth inherits it for free.

### 2. (Should) Export named types for the protocol bag

Right now the handler map is typed inline as `Record<string, (key: string) => any | Promise<any>>` in both files. Give it a name so fifteenth can type its exported bag against assign-gingerly's own definition:

```ts
export type ProtocolHandler  = (key: string) => any | Promise<any>;
export type ProtocolHandlers = Record<string, ProtocolHandler>;
```

Keep `GetValuesOptions` / `ResolveValuesOptions` exported as types (they already are).

### 3. (Nice) Export the async single-value resolver

`resolveValue` is exported today, but it's just `getValue` — sync, and it does **not** handle protocols. There is no exported "resolve one protocol string (possibly async) to one value." That is exactly fifteenth's `get(usl)`. Two ways:

- assign-gingerly exports `resolveProtocolValue(value, protocols, options)` as-is, or
- fifteenth builds `get()` from `parseProtocolRef` + its own bag + `getValue` for the `?.` tail (~10 lines).

Either is fine. If item 1 lands, fifteenth doing it itself is trivial, so treat this as optional.

### 4. (Confirm only — no change) `getValue` / `getValues` deep import

The `getValues.ts` JSDoc already advertises `import { getValues, getValue } from 'assign-gingerly/getValues.js'`. fifteenth will use `getValue` to resolve the `?.` tail inside its own `get()`. Just confirm that deep path stays a supported public entry point.

### 5. (Optional — probably skip) Write-side path traversal

`evaluatePathWithAsyncMethods` walks a `?.` path, creates missing intermediate objects, and returns `{ target, lastKey }` so a caller can do `target[lastKey] = value`. That is what fifteenth's `set()` needs for the "write into a sub-property of a stored object" case (`localStorage://myKey?.mySubObject`). But it's currently entangled with `withMethods` / `withAsyncMethods` / `permissionProcessor` machinery fifteenth has no use for, and the fallback is ~6 hand-rolled lines. Only worth exporting a clean sync `evaluatePathWithMethods` → `{ target, lastKey }` if you want byte-identical create-on-write semantics across both packages. Otherwise skip.

### Bottom line for the assign-gingerly ask

Just **item 1** (`parseProtocolRef` + `hasProtocol`, exported, with the two internal call sites refactored to use it) plus **item 2** (named `ProtocolHandler(s)` types). Those two together let fifteenth delete its `parse.ts` and define the outer USL grammar in exactly one place. Everything else fifteenth can do locally.
