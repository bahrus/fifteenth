# Tasks: One-time Pull of a Single Resource

## Task 1: Create parse module (parse.js + parse.ts)
- [ ] Implement `splitOnce(str, separator)` helper
- [ ] Implement `parse(usl)` function with caching
- [ ] Create `parse.ts` type declarations
- [ ] Update `tsconfig.json` include to cover new files

## Task 2: Create IndexedDB helper (idb.js + idb.ts)
- [ ] Implement `IDBObjectStore` class with open/get methods
- [ ] Version-incrementing loop for store creation
- [ ] Promise wrappers for IDB operations
- [ ] Create `idb.ts` type declarations

## Task 3: Create get module (get.js + get.ts)
- [ ] Implement `get(usl)` async function
- [ ] Protocol dispatch: globalThis, localStorage, sessionStorage
- [ ] Protocol dispatch: indexedDB (using idb.js)
- [ ] Protocol dispatch: cookie, locationHash
- [ ] Accessor chain traversal
- [ ] Create `get.ts` type declarations

## Task 4: Create test page and Playwright spec
- [ ] Create `tests/test-get.html` with import map and in-browser tests
- [ ] Create `tests/get.spec.ts` Playwright spec
- [ ] Verify all tests pass across browsers

## Task 5: Update tsconfig.json
- [ ] Ensure all new `.ts` files are included in compilation
- [ ] Verify no type errors with `npx tsc --noEmit`
