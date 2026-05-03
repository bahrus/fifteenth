# Requirements: One-time Pull of a Single Resource

## Overview

Implement the `get()` function that performs a one-time pull of a single resource from various browser storage backends using a Uniform Source Locator (USL) string.

## USL Format

A USL string follows this pattern:
```
protocol://path/parts?.accessorChain?.nested
```

### Terminology

| Substring | Name | Notes |
|---|---|---|
| `indexedDB` | Protocol | Storage backend identifier |
| `indexedDB://myDB/myStore` | Uniform Source Root (USR) | Everything before the key |
| `indexedDB://myDB/myStore/myKey` | Uniform Source Path (USP) | Full path including key |
| `?.mySubject?.mySubSubObject` | Chained accessor | Optional deep property access |
| `indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject` | Uniform Source Locator (USL) | Complete locator string |

## Supported Protocols

1. **globalThis** — `globalThis://a/b` — traverses global object properties
2. **localStorage** — `localStorage://myKey` — reads from localStorage, JSON-parses if possible
3. **sessionStorage** — `sessionStorage://myKey` — reads from sessionStorage, JSON-parses if possible
4. **indexedDB** — `indexedDB://dbName/storeName/key` — reads from IndexedDB object store
5. **cookie** — `cookie://cookieName` — reads a cookie value
6. **locationHash** — `locationHash://keyName` — reads a value encoded in location.hash

## Functional Requirements

### REQ-1: USL Parsing
- Parse a USL string into: protocol, USP parts (path segments), and optional accessor chain
- Cache parsed results for repeated lookups of the same USL
- The accessor chain starts after `?.` and segments are separated by `?.`

### REQ-2: get() Function
- `get(usl: string): Promise<any>` — async function that returns the value at the given USL
- Returns `null` if the resource is not found
- Traverses the accessor chain (if present) on the retrieved value using optional chaining semantics (return null/undefined if any segment is missing)

### REQ-3: globalThis Protocol
- Path parts are traversed as nested properties on `globalThis`
- Example: `globalThis://a/b` returns `globalThis.a.b`
- No accessor chain support needed (throw if provided, matching legacy behavior)

### REQ-4: localStorage Protocol
- First path part is the storage key
- Retrieves the value via `localStorage.getItem(key)`
- Attempts JSON.parse on the result; returns raw string if parse fails
- Returns `null` if key doesn't exist

### REQ-5: sessionStorage Protocol
- Same behavior as localStorage but reads from `sessionStorage`

### REQ-6: indexedDB Protocol
- Path parts: `[dbName, storeName, key]`
- All three must be provided (throw/error if not)
- Opens the database, reads the value from the object store
- Uses key-value object mode (`{ keyPath: 'key' }`) — returns the `.value` property

### REQ-7: cookie Protocol
- First path part is the cookie name
- Returns the decoded cookie value, or `undefined` if not found

### REQ-8: locationHash Protocol
- First path part is the key name
- Parses key-value pairs from `location.hash`

### REQ-9: Accessor Chain Traversal
- After retrieving the base value, traverse the accessor chain
- Each segment accesses a property on the current value
- If the current value is null/undefined at any point, return null

## Non-Functional Requirements

### NFR-1: Module Format
- ES modules with `.js` extension for browser code
- Type declarations in companion `.ts` files
- Importable as `fifteenth/get.js` and `fifteenth/parse.js`

### NFR-2: No External Dependencies
- Implementation should be self-contained (no npm runtime dependencies)
- Only browser APIs

### NFR-3: Testing
- Playwright tests with HTML test pages
- Test each protocol's get behavior
- Test accessor chain traversal
- Test null/not-found cases
