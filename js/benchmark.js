/**
 * BenchmarkEngine
 * ---------------
 * High‑level orchestrator that:
 * 1. Accepts a StorageManager instance + configuration.
 * 2. Generates random data using the Web Crypto API (chunked to respect 64 KB limit).
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
        this.abortController = null;

        // Callbacks
        this.onProgress = null;   // (stats) => {}
        this.onLog = null;        // (message) => {}
        this.onComplete = null;   // () => {}
        this.onError = null;      // (error) => {}
    }

    /**
     * Start writing `targetGB` gigabytes using the given RAM buffer size.
     * @param {number} targetGB
     * @param {number} bufferMB
     */
    async start(targetGB, bufferMB) {
        if (this.isRunning) {
            this.onError?.('A benchmark is already running.');
            return;
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const targetBytes = targetGB * 1e9;
        const bufferBytes = bufferMB * 1024 * 1024;

        let bytesWrittenThisRun = 0;
        const startTime = performance.now();
        const initialStoredBytes = await this.storage.getTotalStored();

        const emitProgress = () => {
            if (typeof this.onProgress === 'function') {
                const elapsedSec = (performance.now() - startTime) / 1000;
                const speed = elapsedSec > 0 ? (bytesWrittenThisRun / elapsedSec) : 0;
                this.onProgress({
                    bytesWrittenThisRun,
                    targetBytesThisRun: targetBytes,
                    cumulativeBytes: initialStoredBytes + bytesWrittenThisRun,
                    speed,
                });
            }
        };

        const log = (msg) => {
            if (typeof this.onLog === 'function') {
                this.onLog(msg);
            }
        };

        try {
            while (bytesWrittenThisRun < targetBytes && !signal.aborted) {
                const remaining = targetBytes - bytesWrittenThisRun;
                const chunkSize = Math.min(bufferBytes, remaining);

                log(`🔑 Generating ${this._formatBytes(chunkSize)} of crypto‑random data...`);

                // 🔧 FIX: Create the buffer, then fill it in 64 KB segments
                const buffer = new Uint8Array(chunkSize);
                this._fillBufferWithRandom(buffer);   // synchronous, respects 65536 byte limit

                log(`📦 Buffer filled. Flushing ${this._formatBytes(chunkSize)} to disk...`);

                await this.storage.write(buffer);

                bytesWrittenThisRun += chunkSize;
                log(`✅ Wrote chunk. Total this run: ${this._formatBytes(bytesWrittenThisRun)} / ${this._formatBytes(targetBytes)}`);

                emitProgress();
                await this._yield();
            }

            if (signal.aborted) {
                log('⏹️ Benchmark stopped by user.');
            } else {
                log('🏁 Benchmark complete.');
            }
            emitProgress();
            this.onComplete?.();
        } catch (err) {
            log(`❌ Error: ${err.message}`);
            this.onError?.(err);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Abort the currently running benchmark.
     */
    stop() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * Fill a Uint8Array with cryptographically secure random bytes,
     * respecting the 65536‑byte limit per call.
     * @param {Uint8Array} buffer
     */
    _fillBufferWithRandom(buffer) {
        const MAX_CHUNK = 65536;
        let offset = 0;
        while (offset < buffer.byteLength) {
            const end = Math.min(offset + MAX_CHUNK, buffer.byteLength);
            const subarray = buffer.subarray(offset, end);
            crypto.getRandomValues(subarray);
            offset = end;
        }
    }

    async _yield() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

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
