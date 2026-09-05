# The fifteenth competing standard


This package defines a common language for "resource management", where the resources come from:

1.  globalThis
2.  localStorage
3.  sessionStorage
4.  indexedDB
5.  cookies
6.  location.hash
7.  signals (?)
8.  imports (?)

## One-time pull of a single resource:

```JavaScript
import {get} from 'fifteenth/get.js';
const currentVal = await get('indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject');
```

Returns `null` if the resource — or any link in the `?.` accessor chain — is not
found. The chain is resolved by assign-gingerly's `getValue`, so it behaves
exactly as it would inside `resolveValues` / `assignFromAsync`.

## One-time pull of multiple resources

There is no dedicated `drawFrom` in this package — that job is now done by
[assign-gingerly's protocol resolution](https://github.com/bahrus/assign-gingerly#protocol-resolution-in-getvalues-and-assignfrom).
`fifteenth` supplies the storage-specific handlers as a ready-made `protocols`
bag; assign-gingerly owns the outer USL grammar (the `protocol://` split and the
`?.` accessor chain).

```JavaScript
import {protocols} from 'fifteenth/protocols.js';
import {resolveValues} from 'assign-gingerly/resolve/resolveValues.js';

const currentVals = await resolveValues({
    prop1:  'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject',
    prop2:  'localStorage://myKey?.mySubObject',
    prop3:  'sessionStorage://myKey?.mySubObject',
    prop4:  'globalThis://a/b',
    prop5:  'cookie://myCookieName',
    prop6:  'locationHash://myKeyName',
    prop7:  'a plain literal, passed through untouched',
}, {}, { protocols });
```

To weave the resolved values straight into a target object, hand the same bag to
`assignFrom` / `assignFromAsync`:

```JavaScript
import {protocols} from 'fifteenth/protocols.js';
import {assignFromAsync} from 'assign-gingerly/assignFromAsync.js';

await assignFromAsync(target, {
    zip:   'indexedDB://addressDB/byUser/current?.address?.zip',
    theme: 'localStorage://prefs?.theme',
}, { from: {}, protocols });
```

The single-resource `get()` above is a thin convenience wrapper over these same
pieces, so one USL and a whole pattern object resolve through one code path.

> `abcookie://` (base64 encode/decode via `atob`/`btoa`) is not yet implemented.

It will prove useful to give names to parts of the strings, just as it is useful to do with URL's:


|  Substring                                                    |   Name                        | Notes                                      |
|---------------------------------------------------------------|-------------------------------|--------------------------------------------|
|  indexedDB                                                    |  Protocol                     |                                            |
|  indexedDB://myDB/myStore                                     |  Uniform Source Root (USR)    |  Everything before the key                 |
|  indexedDB://myDB/myStore/myKey                               |  Uniform Source Path (USP)    |                                            |
|  ?.mySubject?.mySubSubObject                                  |  Chained accessor             |                                            |
|  indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject    |  Uniform Source Locator (USL) |                                            |

## One-time push of single resource

```JavaScript
import {set} from 'fifteenth/set.js';
await set('indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject', currentVal);
```

When the USL carries a `?.` accessor chain, `set` reads the stored value, merges
the chain into it and writes the whole thing back — the same create-on-write
semantics as assign-gingerly: missing intermediate objects are created, existing
ones are descended into (never replaced), and only the exact leaf is
overwritten. Without a chain, `val` is stored as-is.

On completion it broadcasts the change so subscribers can react:

```JavaScript
window.postMessage([
    'indexedDB://myDB/myStore/myKey',                              // the USP
    'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject'    // the full USL
])
```

The message is an array: `[usp]` when no accessor chain was used, `[usp, usl]`
when one was. To coalesce a batch of writes into a single broadcast, pass a
saving context — `set` then records the strings instead of posting, and the
batch driver posts once at the end:

```JavaScript
const ctx = { usls: new Set() };
await set('localStorage://prefs?.theme', 'dark', ctx);
await set('localStorage://prefs?.density', 'compact', ctx);
window.postMessage([...ctx.usls]);
```

Per protocol: `globalThis`, `localStorage`, `sessionStorage` and `indexedDB`
hold structured values and support the accessor chain; `cookie` and
`locationHash` hold plain strings and reject one. Non-string values written to
`cookie` / `locationHash` are JSON-encoded (and are *not* JSON-decoded on
`get`).

## Wait for value to appear:

```JavaScript
import {gait} from 'fifteenth/gait.js';
const currentVal = await gait('indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject');
```

This returns the value if it exists, if not, it waits for a post message matching the criteria, and returns the result then.


<!--dreg-->

## One-time push of multiple resources: [Untested]

```JavaScript
const values = {
    prop1: 'hello',
};
await stow({
    values, 
    mapping: {
        prop1:  'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject',
        prop2:  'localStorage://myKey?.mySubObject',
        prop3:  'sessionStorage://myKey?.mySubObject'
    }
});
```



## Integration with assign-gingerly

`fifteenth` depends on [assign-gingerly](https://github.com/bahrus/assign-gingerly)
and is designed to be used *through* it:

| Layer | Example | Owner |
|---|---|---|
| Outer USL grammar | `‹protocol›://‹key›?.‹chain›`, sync vs async, `?.` resolution | assign-gingerly |
| Per-protocol key | `myDB/myStore/myKey`, later `[7]`, `[7..17]`, `{…filter…}` | **fifteenth** |

assign-gingerly exposes the outer-grammar primitives (`parseProtocolRef`,
`hasProtocol`) from `assign-gingerly/resolve/getValues.js`; `fifteenth` imports
them rather than re-implementing the split, and ships:

- **`protocols`** (`fifteenth/protocols.js`) — the handler bag for
  `resolveValues` / `assignFrom` / `assignFromAsync`.
- **`ambientProtocols`** (`fifteenth/ambient.js`) — just the synchronous
  handlers (`globalThis`, `localStorage`, `sessionStorage`, `cookie`,
  `locationHash`), for use with the synchronous `getValues` / `assignFrom`.
- **`get`** (`fifteenth/get.js`) — the single-USL convenience wrapper.
- **`IDBObjectStore`** (`fifteenth/idb.js`) — the minimal IndexedDB object-mode
  wrapper backing the `indexedDB` handler.

Dependency direction is `fifteenth → assign-gingerly`, never the reverse.

## IndexedDB -- Object mode vs Tabular mode [WIP]

IndexedDB supports at least two fundamental variations -- storing key/value pairs, similar to a JavaScript Object, vs numerically indexed objects, which is more like a table.

The distinguishing characteristic, as far as the underlying API, that sets the agenda for which scenario we are in, is the (overly subtle?) DB option:

```JavaScript
{ keyPath: 'key'}
```

vs.

```JavaScript
{ keyPath: 'id', autoIncrement: true }
```


So far, we've seen examples that exclusively draw from the former case:

```JavaScript
const nameValPointer = 'indexedDB://myDB/myStore/myKey';
```
  
In the latter case, we introduce [] into the mix:

```JavaScript
const rowPointer = 'indexedDB://myDB/myStore[7]';
```

To request all rows:

```JavaScript
const allRows = 'indexedDB://myDB/myStore[]';
```

To request range of rows:

```JavaScript
const someRows = 'indexedDB://myDB/myStore[7..17]';
```

## Filtering IndexedDB rows based on criteria [TODO]

Use MongoDB syntax (or something more standardized?)

```JavaScript
const filteredRows = 'indexedDB://myDB/myTODOList{"start_date": {$gt: new Date('2020-07-04')}}[7]';
```

This would probably be best to implement with the help of a worker that does the filtering off the main thread.  and need to add indexes.

## Watchful, remote, asynchronous properties (wrappers)   [WIP]

Often we want (part of) a class's properties to expose key values from a remote store location.  One obstacle to this is that we can't define asynchronous getters.  And there's a fair amount of boiler plate in managing this synchronization.  This package provides some utilities to make it easier.

```JavaScript
MyClass extends HTMLElement{
    usp = 'indexedDB://myDB/myStore/myList[3]';

    @source({
        usp: 'usp',,
        accessorChain: '?.person?.address?.zip' 
        cache: true,
        maxStaleness: 1000,
        beVigilant: false,
        ro: false,
    })
    get zipCode(): Wrapper {
        isStale: boolean,
        cachedVal: any, //applicable if cache is true,
        asOf: number, //date.valueOf()
        async value(newValue?: any){
            ...
        }
    }
}

const currentVal = await myClassInstance.zipCode.value();
await myClassInstance.zipCode.value(newValue);//updates indexedDB
```


Anytime any of these resources change, myObj will be automatically updated.  If twoWay is true, then the synchronization goes in the opposite direction as well.

The universal subscription is done via postMessage / addEventListener('message'), where the message is precisely the USP, e.g. 'indexedDB://myDB/myStore/myKey'