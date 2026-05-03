/**
 * Minimal IndexedDB wrapper for object-mode stores ({ keyPath: 'key' }).
 */
export class IDBObjectStore {
    #db: IDBDatabase | null = null;

    constructor(public dbName: string, public storeName: string) {}

    /** Opens the database, incrementing version until the store exists. */
    async open(): Promise<void> {
        let version = 1;
        while (true) {
            try {
                await this.#openVersion(version);
                return;
            } catch {
                version++;
            }
        }
    }

    #openVersion(version: number): Promise<IDBDatabase> {
        const { dbName, storeName } = this;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, version);

            request.onupgradeneeded = (event) => {
                const db: IDBDatabase = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                const db: IDBDatabase = (event.target as IDBOpenDBRequest).result;
                if (db.objectStoreNames.contains(storeName)) {
                    this.#db = db;
                    resolve(db);
                } else {
                    db.close();
                    reject();
                }
            };

            request.onerror = (event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    /** Gets a record by key, returning the stored value. */
    async get(key: string): Promise<any> {
        const db = this.#db;
        if (!db) throw new Error('Database not open');
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result !== undefined ? result.value : null);
            };

            request.onerror = (event) => {
                reject((event.target as IDBRequest).error);
            };
        });
    }

    /** Puts a record (key + value) into the store. */
    async put(key: string, value: any): Promise<void> {
        const db = this.#db;
        if (!db) throw new Error('Database not open');
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                reject((event.target as IDBRequest).error);
            };
        });
    }

    close(): void {
        if (this.#db) {
            this.#db.close();
            this.#db = null;
        }
    }
}
