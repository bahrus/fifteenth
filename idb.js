/**
 * Minimal IndexedDB wrapper for object-mode stores ({ keyPath: 'key' }).
 */
export class IDBObjectStore {
    dbName;
    storeName;
    #db = null;
    constructor(dbName, storeName) {
        this.dbName = dbName;
        this.storeName = storeName;
    }
    /** Opens the database, incrementing version until the store exists. */
    async open() {
        let version = 1;
        while (true) {
            try {
                await this.#openVersion(version);
                return;
            }
            catch {
                version++;
            }
        }
    }
    #openVersion(version) {
        const { dbName, storeName } = this;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, version);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'key' });
                }
            };
            request.onsuccess = (event) => {
                const db = event.target.result;
                if (db.objectStoreNames.contains(storeName)) {
                    this.#db = db;
                    resolve(db);
                }
                else {
                    db.close();
                    reject();
                }
            };
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    /** Gets a record by key, returning the stored value. */
    async get(key) {
        const db = this.#db;
        if (!db)
            throw new Error('Database not open');
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => {
                const result = request.result;
                resolve(result !== undefined ? result.value : null);
            };
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    /** Puts a record (key + value) into the store. */
    async put(key, value) {
        const db = this.#db;
        if (!db)
            throw new Error('Database not open');
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    close() {
        if (this.#db) {
            this.#db.close();
            this.#db = null;
        }
    }
}
/**
 * Async protocol handler for `indexedDB://‹dbName›/‹storeName›/‹key›`.
 *
 * Receives only the key portion (`dbName/storeName/key`); the outer USL grammar
 * and any trailing `?.` accessor chain are handled by assign-gingerly. Returns
 * `null` when the record is absent.
 *
 * Object-mode stores only for now — the tabular `[]` / `[a..b]` / `{filter}`
 * row syntax described in the README is separate, still-unbuilt work.
 */
export const indexedDBHandler = async (key) => {
    const [dbName, storeName, propName] = key.split('/');
    if (!dbName || !storeName || !propName) {
        throw new Error(`indexedDB key requires "dbName/storeName/key", got "${key}"`);
    }
    const store = new IDBObjectStore(dbName, storeName);
    await store.open();
    try {
        return await store.get(propName);
    }
    finally {
        store.close();
    }
};
