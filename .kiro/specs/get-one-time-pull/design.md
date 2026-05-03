# Design: One-time Pull of a Single Resource

## Architecture

The implementation consists of three modules:

```
fifteenth/
├── parse.js      # USL string parser
├── parse.ts      # Type declarations for parse
├── get.js        # One-time pull dispatcher
├── get.ts        # Type declarations for get
├── idb.js        # IndexedDB helper (object mode)
├── idb.ts        # Type declarations for idb
└── tests/
    ├── get.spec.ts          # Playwright test spec
    └── test-get.html        # In-browser test page
```

## Module Design

### parse.js — USL Parser

Parses a USL string into its components. Caches results for performance.

```
Input:  "indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject"
Output: {
  protocol: "indexedDB",
  usp: "indexedDB://myDB/myStore/myKey",
  uspParts: ["myDB", "myStore", "myKey"],
  accessorChain: "mySubject?.mySubSubObject"   // undefined if not present
}
```

**Parsing algorithm:**
1. Split on `://` (first occurrence only) → protocol + rest
2. Split rest on `?.` (first occurrence only) → path portion + accessor chain
3. Split path portion on `/` → uspParts
4. Reconstruct usp as `protocol://pathPortion`

**Cache:** Uses a `Map<string, ParsedUSL>` to avoid re-parsing.

**Helper — splitOnce(str, separator):** Splits a string on the first occurrence of separator, returning `[before, after]`. If separator not found, returns `[str, undefined]`.

### get.js — One-time Pull Dispatcher

Async function that:
1. Parses the USL via `parse()`
2. Switches on protocol to retrieve the base value
3. Applies accessor chain traversal if present
4. Returns the value (or null if not found)

**Protocol handlers** (inline, no separate modules for simple ones):

| Protocol | Implementation |
|---|---|
| globalThis | Traverse `uspParts` as property chain on `globalThis` |
| localStorage | `localStorage.getItem(uspParts[0])`, try JSON.parse |
| sessionStorage | `sessionStorage.getItem(uspParts[0])`, try JSON.parse |
| indexedDB | Open DB, read from store, return `.value` |
| cookie | Regex match on `document.cookie` |
| locationHash | Parse key-value from `location.hash` |

### idb.js — IndexedDB Helper

Minimal IndexedDB wrapper for object-mode stores (`{ keyPath: 'key' }`).

**Key design decisions from legacy code:**
- Version incrementing loop to handle stores that don't exist yet
- Promise-based wrapper around IDB request/transaction APIs
- Returns the full record; caller extracts `.value`

### Accessor Chain Traversal

Shared utility function `getProp(obj, parts)`:
- Takes an object and an array of property names
- Traverses each property, returning null if any intermediate is nullish
- Used by get.js after retrieving the base value

This will live in `get.js` as a local helper since it's small and only used there for now.

## Type Declarations

### parse.ts
```typescript
export type Protocol = 'globalThis' | 'localStorage' | 'sessionStorage' | 'indexedDB' | 'cookie' | 'locationHash';

export interface ParsedUSL {
  protocol: Protocol;
  usp: string;
  uspParts: string[];
  accessorChain: string | undefined;
}

export function parse(usl: string): ParsedUSL;
```

### get.ts
```typescript
export function get(usl: string): Promise<any>;
```

## Testing Strategy

Following the project's established pattern:
1. **test-get.html** — An HTML page that includes an import map, runs tests in-browser using the actual storage APIs, and writes results to a `#test-complete` element
2. **get.spec.ts** — Playwright spec that navigates to the test page and asserts on the result element

### Test Cases
- globalThis: set a global, read it back
- localStorage: setItem, read via USL
- sessionStorage: setItem, read via USL
- localStorage with JSON object: store JSON, verify parsed object returned
- cookie: set a cookie, read via USL
- locationHash: set hash, read via USL
- indexedDB: store a value, read via USL
- Accessor chain: store nested object, read deep property
- Not found: read non-existent key, expect null
- Accessor chain on null: read non-existent key with accessor, expect null

## Hash Encoding

The legacy code uses a custom `Hashit` class with open/close delimiters to encode key-value pairs in `location.hash`. For simplicity, the new implementation will use a straightforward approach:
- Encode: `#key=JSON.stringify(value)` (URL-encoded)
- Decode: Parse `location.hash` as key-value pairs separated by `&`

This is simpler and more standard than the legacy approach. If the legacy encoding is needed for compatibility, it can be added later.
