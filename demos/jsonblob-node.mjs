/**
 * Live end-to-end check of the jsonblob / superjsonblob persistence path,
 * from Node — no browser, no stubs. Exercises the *actual* compiled module
 * (`../jsonblob.js` + `../get.js` + `../set.js`) against a real remote service.
 *
 *   node demos/jsonblob-node.mjs                # superjsonblob.com (default)
 *   node demos/jsonblob-node.mjs jsonblob      # jsonblob.com
 *
 * Notes
 * -----
 * - Default target is **superjsonblob** because it answers from anywhere,
 *   including CI / datacenter IPs. It has no CORS headers, so it can't be
 *   driven from a browser cross-origin — but Node doesn't enforce CORS, so
 *   this script reaches it fine and the persistence logic under test is the
 *   same for both services (they're wire-compatible).
 * - **jsonblob.com** works great from a normal browser / residential IP
 *   (`Access-Control-Allow-Origin: *`), but Cloudflare bot-blocks POST/PUT
 *   from many datacenter IP ranges — from such a host this script will report
 *   a fetch failure on write. Run `demos/jsonblob.html` in a real browser for
 *   the jsonblob.com round-trip.
 * - A Node run uses an in-memory id-store (the `locationHash` default needs
 *   `window`/`history`) and passes a SavingContext to `set()` so the change
 *   broadcast doesn't touch `window.postMessage`.
 */
import { configureJsonBlob } from '../jsonblob.js';
import { get } from '../get.js';
import { set } from '../set.js';

const target = process.argv[2] === 'jsonblob' ? 'jsonblob' : 'superjsonblob';

const mem = new Map();
configureJsonBlob({
    [target]: {
        idStore: {
            get: (a) => mem.get(a) ?? null,
            set: (a, id) => void mem.set(a, id),
            delete: (a) => void mem.delete(a),
        },
    },
});

const ctx = () => ({ usls: new Set() }); // keeps set()'s broadcast off window.postMessage

// order-insensitive deep compare (remote may reorder object keys)
const canon = (v) =>
    JSON.stringify(v, (_k, val) =>
        val && typeof val === 'object' && !Array.isArray(val)
            ? Object.fromEntries(Object.entries(val).sort())
            : val,
    );

let ok = true;
function check(actual, expected, label) {
    const pass = canon(actual) === canon(expected);
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
    if (!pass) console.log(`      want ${canon(expected)}\n      got  ${canon(actual)}`);
}

const alias = `demo-${Date.now().toString(36)}`;
const usl = `${target}://${alias}`;

console.log(`\nfifteenth → ${target} — live round-trip (${usl})\n`);

try {
    const base = { hello: 'world', when: new Date().toISOString() };

    await set(usl, base, ctx()); // no mapping yet → POST
    const id = mem.get(alias);
    console.log(`created blob: ${id}`);
    if (!id) throw new Error('no blob id recorded after set()');

    check(await get(usl), base, 'read-back after create (POST → GET)');

    const n = Math.floor(Math.random() * 1000);
    await set(`${usl}?.nested?.count`, n, ctx()); // read-modify-write → PUT
    check(await get(usl), { ...base, nested: { count: n } }, 'merge kept the original keys (no clobber)');
    check(await get(`${usl}?.nested?.count`), n, 'accessor chain resolves to the leaf');

    check(await get(`${target}://=${id}`), { ...base, nested: { count: n } }, 'direct-id form (=<id>) reads the same blob');

    console.log(`\n${ok ? 'ALL GOOD — persistence verified end to end.' : 'FAILED — see above.'}`);
    process.exitCode = ok ? 0 : 1;
} catch (e) {
    console.error(`\nERROR: ${e?.message || e}`);
    if (target === 'jsonblob') {
        console.error('If this is a fetch/network failure, this host is likely Cloudflare-blocked ' +
            'for jsonblob.com writes. Try `demos/jsonblob.html` in a browser, or run without args ' +
            '(superjsonblob).');
    }
    process.exitCode = 1;
}
