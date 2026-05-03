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

returns null if not found.

## One-time pull of multiple resources: 

```JavaScript
import {draw} from 'fifteenth/drawFrom.js';
const currentVals = await drawFrom({
    prop1:  'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject',
    prop2:  'localStorage://myKey?.mySubObject',
    prop3:  'sessionStorage://myKey?.mySubObject',
    prop4:  'globalThis://a/b',
    prop5:  'cookie://myCookieName',
    prop6:  'abcookie://myCookieName', //TODO encode with atob, btoa
    prop7:  'locationHash://myKeyName' 
});
```

It will prove useful to give names to parts of the strings, just as it is useful to do with URL's:


|  Substring                                                    |   Name                        | Notes                                      |
|---------------------------------------------------------------|-------------------------------|--------------------------------------------|
|  indexedDB                                                    |  Protocol                     |                                            |
|  indexedDB://myDB/myStore                                     |  Uniform Source Root (USR)    |  Everything before the key                 |
|  indexedDB://myDB/myStore/myKey                               |  Uniform Source Path (USP)    |                                            |
|  ?.mySubject?.mySubSubObject                                  |  Chained accessor             |                                            |
|  indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject    |  Uniform Source Locator (USL) |                                            |

## One-time push of single resource:

```JavaScript
import {set} from 'fifteenth/set.js';
await set('indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject', currentVal);
```

Fires:

```JavaScript
window.postMessage([
    'indexedDB://myDB/myStore/myKey',
    'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject'
])
```

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



## One-time pull of multiple resources

##  Integration with assignGingerly 

[Previously](II.--Signals-vs-Roundabouts#merging-traffic-via-assigngingerly-wip), we described the *assignGingerly* utility function that can merge one object into another, with more merging abilities than what Object.assign provides.  We can also weave USP's into the target object as part of the assignGingerly function/method:

```JavaScript
(await import('trans-render/lib/weave.js')).weave({
    prop1:  'indexedDB://myDB/myStore/myKey?.mySubject?.mySubSubObject',
    prop2:  'localStorage://myKey?.mySubObject',
    prop3:  'sessionStorage://myKey?.mySubObject'
}).into('mvJ1LScYN0KZKrjSP5ChWQ');

await (await import('trans-render/lib/assignGingerly.js')).assignGingerly(obj, {
    '...': 'mvJ1LScYN0KZKrjSP5ChWQ'
});
```



In the example above, we made use of a guid ('mvJ1LScYN0KZKrjSP5ChWQ').  This value doesn't have to be a guid.  It can be a number or a symbol, or a shorter, meaningful string.  The intention is it should be unique throughout the application, at least in the context of weave / assignGingerly.


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