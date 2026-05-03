import { parse } from './parse.js';

/**
 * Traverses a chain of properties on an object.
 * Returns null if any intermediate value is nullish.
 */
function getProp(obj: any, parts: string[]): any {
    let current = obj;
    for (const part of parts) {
        if (current == null) return null;
        current = current[part];
    }
    return current ?? null;
}

/**
 * Reads a value from localStorage or sessionStorage.
 * Attempts JSON.parse; returns raw string on failure.
 */
function getFromWebStorage(key: string, protocol: 'localStorage' | 'sessionStorage'): any {
    const raw = window[protocol].getItem(key);
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/**
 * Reads a cookie value by name.
 */
function getCookie(name: string): string | undefined {
    const escaped = name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(
        new RegExp('(?:^|; )' + escaped + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Reads a value from location.hash.
 * Expects hash format: #key1=value1&key2=value2
 */
function getFromHash(key: string): string | undefined {
    const hash = location.hash.substring(1);
    if (!hash) return undefined;
    const params = new URLSearchParams(hash);
    return params.get(key) ?? undefined;
}

/**
 * One-time pull of a single resource from a browser storage backend.
 */
export async function get(usl: string): Promise<any> {
    const { protocol, accessorChain, uspParts } = parse(usl);
    let value: any;

    switch (protocol) {
        case 'globalThis': {
            if (accessorChain !== undefined) throw new Error('Accessor chain not supported for globalThis protocol');
            return getProp(globalThis, uspParts);
        }

        case 'indexedDB': {
            const [dbName, storeName, propName] = uspParts;
            if (!dbName || !storeName || !propName) {
                throw new Error('indexedDB USL requires dbName/storeName/key');
            }
            const { IDBObjectStore } = await import('./idb.js');
            const store = new IDBObjectStore(dbName, storeName);
            await store.open();
            value = await store.get(propName);
            store.close();
            break;
        }

        case 'localStorage':
        case 'sessionStorage': {
            const [key] = uspParts;
            value = getFromWebStorage(key, protocol);
            break;
        }

        case 'cookie': {
            const [name] = uspParts;
            value = getCookie(name) ?? null;
            break;
        }

        case 'locationHash': {
            const [key] = uspParts;
            value = getFromHash(key) ?? null;
            break;
        }

        default:
            throw new Error(`Unsupported protocol: ${protocol}`);
    }

    if (accessorChain !== undefined && value != null) {
        const parts = accessorChain.split('?.');
        value = getProp(value, parts);
    }

    return value;
}
