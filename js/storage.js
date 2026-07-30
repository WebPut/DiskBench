/**
 * StorageManager
 * Unified interface for writing random data chunks to disk via IndexedDB or the
 * File System Access API.
 */
export class StorageManager {
    constructor() {
        this.backend = null;
        this.db = null;
        this.fileHandle = null;
        this.writableStream = null;
        this.totalBytesWritten = 0;
    }

    // ========== PUBLIC API ==========

    async init(backendType) {
        this.backend = backendType;
        if (backendType === 'indexeddb') {
            await this._initIndexedDB();
        } else if (backendType === 'filesystem') {
            await this._initFileSystem();
        }
        this.totalBytesWritten = await this.getTotalStored();
    }

    async write(data) {
        if (this.backend === 'indexeddb') {
            await this._writeToIndexedDB(data);
        } else if (this.backend === 'filesystem') {
            await this._writeToFileSystem(data);
        }
        this.totalBytesWritten += data.byteLength;
    }

    async getTotalStored() {
        if (this.backend === 'indexeddb' && this.db) {
            return await this._getIndexedDBTotalSize();
        } else if (this.backend === 'filesystem' && this.fileHandle) {
            return await this._getFileSystemTotalSize();
        }
        return 0;
    }

    async deleteAll() {
        // 1. Close everything and delete IndexedDB
        try {
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            await this._deleteIndexedDBGlobal();
        } catch (e) {
            console.warn('IndexedDB delete:', e.message);
        }

        // 2. Close stream and delete file system file
        try {
            await this._closeFileSystemStream();
            if (this.fileHandle) {
                await this.fileHandle.remove();
                this.fileHandle = null;
            }
        } catch (e) {
            console.warn('FileSystem delete:', e.message);
        }

        // 3. Reset everything
        this.totalBytesWritten = 0;
        this.backend = null;
    }

    // ========== PRIVATE: IndexedDB ==========

    _initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('StorageBenchmark', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('chunks')) {
                    db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = () => reject(new Error('IDB open failed'));
        });
    }

    _writeToIndexedDB(data) {
        if (!this.db) throw new Error('IDB not init');
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('chunks', 'readwrite');
            const store = tx.objectStore('chunks');
            const blob = new Blob([data], { type: 'application/octet-stream' });
            const req = store.add({ data: blob });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    _getIndexedDBTotalSize() {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(0);
            const tx = this.db.transaction('chunks', 'readonly');
            const store = tx.objectStore('chunks');
            let total = 0;
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    // Only read the 'size' property, NOT the blob data
                    total += cursor.value.data.size || 0;
                    cursor.continue();
                } else {
                    resolve(total);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    _deleteIndexedDBGlobal() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase('StorageBenchmark');
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ========== PRIVATE: File System ==========

    async _initFileSystem() {
        if (!('showSaveFilePicker' in window)) {
            throw new Error('File System API not supported');
        }

        // Close any previous stream/handle before opening a new one
        await this._closeFileSystemStream();
        if (this.fileHandle) {
            try { await this.fileHandle.remove(); } catch(e) {}
            this.fileHandle = null;
        }

        this.fileHandle = await window.showSaveFilePicker({
            suggestedName: 'benchmark-data.bin',
            types: [{ description: 'Binary', accept: { 'application/octet-stream': ['.bin'] } }]
        });

        this.writableStream = await this.fileHandle.createWritable({ keepExistingData: true });
    }

    async _writeToFileSystem(data) {
        if (!this.writableStream) throw new Error('Stream not open');
        // FIX: Write WITHOUT 'position' – it appends automatically
        await this.writableStream.write(data);
    }

    async _getFileSystemTotalSize() {
        if (!this.fileHandle) return 0;
        const file = await this.fileHandle.getFile();
        return file.size;
    }

    async _closeFileSystemStream() {
        if (this.writableStream) {
            try { await this.writableStream.close(); } catch(e) {}
            this.writableStream = null;
        }
    }

    // This is called internally by deleteAll()
    async _deleteFileSystemData() {
        await this._closeFileSystemStream();
        if (this.fileHandle) {
            await this.fileHandle.remove();
            this.fileHandle = null;
        }
    }
}
