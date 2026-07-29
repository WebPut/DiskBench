/**
 * BenchmarkEngine
 * ---------------
 * High‑level orchestrator that:
 * 1. Accepts a StorageManager instance + configuration.
 * 2. Generates random data using the Web Crypto API.
 * 3. Fills a RAM buffer and flushes it to disk.
 * 4. Repeats until the target GB is written or the user stops.
 * 5. Emits progress, speed, and log events via callbacks.
 */
export class BenchmarkEngine {
    /**
     * @param {import('./storage.js').StorageManager} storageManager
     */
    constructor(storageManager) {
        this.storage = storageManager;

        // Run state
        this.isRunning = false;
        this.abortController = null;   // allows external stop

        // Callbacks (set after instantiation)
        this.onProgress = null;   // (stats) => {}
        this.onLog = null;        // (message) => {}
        this.onComplete = null;   // () => {}
        this.onError = null;      // (error) => {}
    }

    /**
     * Start writing `targetGB` gigabytes using the given RAM buffer size.
     * @param {number} targetGB   - e.g. 1
     * @param {number} bufferMB   - e.g. 64
     */
    async start(targetGB, bufferMB) {
        if (this.isRunning) {
            this.onError?.('A benchmark is already running.');
            return;
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const targetBytes = targetGB * 1e9;           // 1 GB = 1,000,000,000 bytes
        const bufferBytes = bufferMB * 1024 * 1024;   // 1 MB = 1,048,576 bytes

        let bytesWrittenThisRun = 0;
        const startTime = performance.now();

        // Snapshot current on‑disk total so we can report cumulative usage
        const initialStoredBytes = await this.storage.getTotalStored();

        // Helper to emit progress
        const emitProgress = () => {
            if (typeof this.onProgress === 'function') {
                const elapsedSec = (performance.now() - startTime) / 1000;
                const speed = elapsedSec > 0 ? (bytesWrittenThisRun / elapsedSec) : 0; // bytes/sec
                this.onProgress({
                    bytesWrittenThisRun,
                    targetBytesThisRun: targetBytes,
                    cumulativeBytes: initialStoredBytes + bytesWrittenThisRun,
                    speed,             // bytes per second
                });
            }
        };

        // Log helper
        const log = (msg) => {
            if (typeof this.onLog === 'function') {
                this.onLog(msg);
            }
        };

        try {
            // Main loop
            while (bytesWrittenThisRun < targetBytes && !signal.aborted) {
                const remaining = targetBytes - bytesWrittenThisRun;
                const chunkSize = Math.min(bufferBytes, remaining);

                log(`🔑 Generating ${this._formatBytes(chunkSize)} of crypto‑random data...`);

                // 1. Generate random buffer
                const buffer = new Uint8Array(chunkSize);
                crypto.getRandomValues(buffer);   // synchronous, fills immediately

                log(`📦 Buffer filled. Flushing ${this._formatBytes(chunkSize)} to disk...`);

                // 2. Write to storage (async)
                await this.storage.write(buffer);

                bytesWrittenThisRun += chunkSize;
                log(`✅ Wrote chunk. Total this run: ${this._formatBytes(bytesWrittenThisRun)} / ${this._formatBytes(targetBytes)}`);

                emitProgress();

                // Yield to the UI (non‑blocking, just a tick)
                await this._yield();
            }

            // Finished normally (or aborted)
            if (signal.aborted) {
                log('⏹️ Benchmark stopped by user.');
            } else {
                log('🏁 Benchmark complete.');
            }
            emitProgress();           // final update
            this.onComplete?.();
        } catch (err) {
            log(`❌ Error: ${err.message}`);
            this.onError?.(err);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Abort the currently running benchmark (if any).
     */
    stop() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * Tiny async pause so the browser can breathe between chunks.
     */
    async _yield() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    /**
     * Format bytes into a human‑readable string (up to GB).
     * @param {number} bytes
     * @returns {string}
     */
    _formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(2)} KB`;
        const mb = kb / 1024;
        if (mb < 1024) return `${mb.toFixed(2)} MB`;
        const gb = mb / 1024;
        return `${gb.toFixed(2)} GB`;
    }
}
