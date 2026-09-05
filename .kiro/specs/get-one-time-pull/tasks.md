# Tasks: One-time Pull of a Single Resource

> **Recalibrated (2026-09-05).** This package no longer owns the outer USL
> grammar. assign-gingerly now exports `parseProtocolRef` / `hasProtocol` from
> `assign-gingerly/resolve/getValues.js`, and `get()` is a thin wrapper over
> those plus the `protocols` handler bag. See `Chats/Tasks.md` for the full
> implementation notes and `Chats/Strategy.md` for the rationale.

## Task 1: ~~Create parse module (parse.js + parse.ts)~~ — REVERSED
- [x] Deleted `parse.ts`; the outer split is imported from assign-gingerly
      (`parseProtocolRef`, `hasProtocol`). Per-protocol inner parsing (the `/`
      split of the key) now lives in each handler.

## Task 2: IndexedDB helper (idb.ts) — DONE
- [x] `IDBObjectStore` class with open/get/put/close
- [x] Version-incrementing loop for store creation
- [x] Promise wrappers for IDB operations
- [x] `indexedDBHandler` async protocol handler (`dbName/storeName/key`)

## Task 3: Handler bag + get module — DONE
- [x] `ambient.ts` — sync handlers: globalThis, localStorage, sessionStorage,
      cookie, locationHash (+ `ambientProtocols` export)
- [x] `protocols.ts` — `{ ...ambientProtocols, indexedDB: indexedDBHandler }`
- [x] `get.ts` — `get(usl)` = `parseProtocolRef` + bag + `getValue` for the `?.` tail
- [x] `index.ts` — top-level re-exports
- [x] Accessor chain now resolved by assign-gingerly's `getValue` (no bespoke
      traversal; `globalThis://a/b?.c` no longer throws)

## Task 4: Test page and Playwright spec — DONE
- [x] `tests/test-get.html` — in-browser tests; import map now also maps
      `assign-gingerly/`
- [x] `tests/get.spec.ts` — Playwright spec
- [x] Added `protocols`-bag tests exercising `resolveValues`
- [x] Chromium green (18/18). Firefox/WebKit need `npx playwright install`.

## Task 5: tsconfig / packaging — DONE
- [x] `tsc` clean (`*.ts` include already covers the new root files)
- [x] `.gitignore` updated for the new compiled outputs
- [x] `package.json` `main`/`homepage`/`repository` fixed (`xvth` -> `fifteenth`),
      `exports` map added

## Still open (future specs)
- [ ] Tabular IndexedDB: `[7]`, `[]`, `[7..17]`, `{filter}` row syntax
- [ ] `set` / `stow` (write side) — port from `legacy/XV`
- [ ] `gait` (wait-for-value) — port from `legacy/XV`
- [ ] `abcookie://` base64 variant
