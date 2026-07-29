/**
 * StorageManager
 
 * Unified interface for writing random data chunks to disk via IndexedDB or the
 * File System Access API. The rest of the app doesn't need to know which backend
 * is in use—it just calls write(), getTotalStored(), and deleteAll().
 */
export class StorageManager {
    constructor() {
        this.backend = null;          // 'indexeddb' or 'filesystem'
        this.db = null;               // IndexedDB database instance
        this.fileHandle = null;       // FileSystemFileHandle (for FS API)
        this.writableStream = null;   // FileSystemWritableFileStream
        this.totalBytesWritten = 0;   // running total, updated after each successful write
    }

    /**
     * Initialize the selected backend.
     * @param {'indexeddb'|'filesystem'} backendType
     */
    async init(backendType) {
        this.backend = backendType;
        if (backendType === 'indexeddb') {
            await this._initIndexedDB();
        } else if (backendType === 'filesystem') {
            await this._initFileSystem();
        }
        // Recalculate total bytes already stored from previous sessions
        this.totalBytesWritten = await this.getTotalStored();
    }

    /**
     * Write a chunk of data (Uint8Array) to the active backend.
     * @param {Uint8Array} data
     */
    async write(data) {
        if (this.backend === 'indexeddb') {
            await this._writeToIndexedDB(data);
        } else if (this.backend === 'filesystem') {
            await this._writeToFileSystem(data);
        }
        this.totalBytesWritten += data.byteLength;
    }

    /**
     * Get total bytes stored across all previous writes (even from past sessions).
     * @returns {Promise<number>}
     */
    async getTotalStored() {
        if (this.backend === 'indexeddb') {
            return await this._getIndexedDBTotalSize();
        } else if (this.backend === 'filesystem') {
            return await this._getFileSystemTotalSize();
        }
        return 0;
    }

    /**
     * Delete all benchmark data.
     */
    async deleteAll() {
        if (this.backend === 'indexeddb') {
            await this._deleteIndexedDBData();
        } else if (this.backend === 'filesystem') {
            await this._deleteFileSystemData();
        }
        this.totalBytesWritten = 0;
    }

    // ========================================================================
    // PRIVATE: IndexedDB implementation
    // ========================================================================
    async _initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('StorageBenchmark', 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('chunks')) {
                    // Each chunk stored as { id: autoIncrement, data: Blob }
                    db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                reject(new Error(`IndexedDB open failed: ${event.target.error}`));
            };
        });
    }

    async _writeToIndexedDB(data) {
        if (!this.db) throw new Error('IndexedDB not initialized');
        const transaction = this.db.transaction('chunks', 'readwrite');
        const store = transaction.objectStore('chunks');
        const blob = new Blob([data], { type: 'application/octet-stream' });
        await new Promise((resolve, reject) => {
            const request = store.add({ data: blob });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _getIndexedDBTotalSize() {
        if (!this.db) return 0;
        const transaction = this.db.transaction('chunks', 'readonly');
        const store = transaction.objectStore('chunks');
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const chunks = request.result;
                const total = chunks.reduce((sum, chunk) => sum + (chunk.data?.size || 0), 0);
                resolve(total);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async _deleteIndexedDBData() {
        if (!this.db) return;
        const transaction = this.db.transaction('chunks', 'readwrite');
        const store = transaction.objectStore('chunks');
        await new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ========================================================================
    // PRIVATE: File System Access API implementation
    // ========================================================================
    async _initFileSystem() {
        // Check for support
        if (!('showSaveFilePicker' in window)) {
            throw new Error('File System Access API not supported in this browser.');
        }
        // Ask user where to save the benchmark data file
        try {
            this.fileHandle = await window.showSaveFilePicker({
                suggestedName: 'benchmark-data.bin',
                types: [
                    {
                        description: 'Binary data',
                        accept: { 'application/octet-stream': ['.bin'] },
                    },
                ],
            });
        } catch (err) {
            // User cancelled the picker
            if (err.name === 'AbortError') {
                throw new Error('File selection cancelled.');
            }
            throw err;
        }

        // Create a writable stream that we'll keep open for appending
        this.writableStream = await this.fileHandle.createWritable({ keepExistingData: true });
    }

    async _writeToFileSystem(data) {
        if (!this.writableStream) throw new Error('File system stream not open.');
        // seek to end to append
        const file = await this.fileHandle.getFile();
        const currentSize = file.size;
        await this.writableStream.write({ type: 'write', position: currentSize, data });
    }

    async _getFileSystemTotalSize() {
        if (!this.fileHandle) return 0;
        const file = await this.fileHandle.getFile();
        return file.size;
    }

    async _deleteFileSystemData() {
        // Close stream first
        if (this.writableStream) {
            await this.writableStream.close();
            this.writableStream = null;
        }
        if (this.fileHandle) {
            // Remove the file (this will delete it from disk)
            await this.fileHandle.remove();
            this.fileHandle = null;
        }
    }
}
