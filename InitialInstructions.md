# Initial Instructions

Please don't create any documents in the root folder. The root folder is a temporary folder containing two projects managed by Kiro. A mature one -- assign-gingerly, and a spanking new one -- fifteenth.

Please begin by getting a sense of what fifteenth is trying to accomplish via the README.md, then adopt all the steering guidance from assign-gingerly that is applicable to fifteenth. The dependencies should be the same -- two dependencies for the web server and playwright tests. Please adopt the same testing approach, including config file, etc.

At that point, I will switch out of this root folder and open Kiro to just the fifteenth folder. Feel free to add any notes, whatever to InitialInstructions.md or some other file in the fifteenth folder to make the transition easier.

Notice that fifteenth has a legacy folder that has a previous implementation of much of what the README describes, including a library to make integration with IDB easier, etc. I'm hoping that code can at the minimum provide clarification where the README.md is ambiguous, name suggestions, even code to draw from, but don't feel bound by it. I think it makes sense to do this via spec session, as it is a rather large amount of functionality. However, I'd like to go in baby steps. Only spec out and implement "One-time pull of a single resource" for the first session.

---

## Transition Notes (for when fifteenth is opened standalone)

### What was set up

1. **Steering files** adopted from assign-gingerly:
   - `.kiro/steering/coding-best-practices.md` — localName preference, JS module conventions
   - `.kiro/steering/markdown-changes.md` — skip build/test for markdown-only changes

2. **Testing infrastructure** matching assign-gingerly's approach:
   - `playwright.config.ts` — same config (3 browsers, spa-ssi on port 8000, html reporter)
   - `tests/` directory is where HTML test pages + `.spec.ts` files go
   - Pattern: HTML page runs tests in-browser, Playwright reads results from a `#test-complete` element

3. **devDependencies** (same as assign-gingerly):
   - `@playwright/test` — browser testing
   - `spa-ssi` — local dev server
   - `@types/node` — Node type definitions
   - `typescript` — TypeScript compiler

4. **tsconfig.json** — ESNext target/module, strict mode, `declaration: true` for auto-generated `.d.ts`
   - Source is TypeScript (`.ts`), compiled to `.js` via `tsc`
   - Compiled output is gitignored
   - Excludes `legacy/`, `tests/`, and `playwright.config.ts`

5. **package.json scripts**:
   - `npm run build` — compiles TypeScript to JavaScript
   - `npm run serve` — starts spa-ssi dev server
   - `npm test` — builds then runs playwright tests
   - `npm run update` — updates all deps via ncu

### Project overview

fifteenth provides a unified API for reading/writing to browser storage backends (globalThis, localStorage, sessionStorage, indexedDB, cookies, location.hash) using URL-like strings called Uniform Source Locators (USLs).

Example: `indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject`

### Legacy code reference

The `legacy/XV/` folder contains a previous implementation. Key files:
- `parse.ts` — USL string parser (protocol, path, accessor chain)
- `get.ts` — one-time pull dispatcher (switches on protocol)
- `set.ts` — one-time push dispatcher
- `Storage.ts` — localStorage/sessionStorage adapter
- `Cookie.ts` — cookie adapter
- `hash.ts` — location.hash adapter
- `BaseIndexedDB.ts` / `IndexedDBObject.ts` — IndexedDB wrapper

### First spec session scope

**"One-time pull of a single resource"** — the `get()` function:
```js
import {get} from 'fifteenth/get.js';
const currentVal = await get('indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject');
```

This involves:
1. Parsing the USL string into protocol, path parts, and accessor chain
2. Dispatching to the appropriate storage backend
3. Traversing the accessor chain on the result
4. Returning null if not found

The `types/` submodule is a git submodule with shared type definitions across projects.
