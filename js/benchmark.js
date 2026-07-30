/**
 * BenchmarkEngine
 */
export class BenchmarkEngine {
    constructor(storageManager) {
        this.storage = storageManager;
        this.isRunning = false;
        this.abortController = null;

        this.onProgress = null;
        this.onLog = null;
        this.onComplete = null;
        this.onError = null;
    }

    async start(targetGB, bufferMB) {
        if (this.isRunning) {
            this.onError?.('Already running.');
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
            if (this.onProgress) {
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

        try {
            while (bytesWrittenThisRun < targetBytes && !signal.aborted) {
                const remaining = targetBytes - bytesWrittenThisRun;
                const chunkSize = Math.min(bufferBytes, remaining);

                // Generate random data in chunks to keep UI responsive
                const buffer = await this._generateRandomBuffer(chunkSize, signal);

                if (signal.aborted) break;

                await this.storage.write(buffer);
                bytesWrittenThisRun += chunkSize;

                emitProgress();
                await this._yield(); // let UI breathe
            }

            if (signal.aborted) {
                this.onLog?.('⏹️ Stopped.');
            } else {
                this.onLog?.('✅ Done.');
            }
            emitProgress();
            this.onComplete?.();

        } catch (err) {
            this.onError?.(err);
        } finally {
            this.isRunning = false;
        }
    }

    stop() {
        this.abortController?.abort();
    }

    // ========== HELPERS ==========

    async _generateRandomBuffer(size, signal) {
        const buffer = new Uint8Array(size);
        const MAX_CHUNK = 65536; // 64KB per crypto call
        const YIELD_EVERY = 1024 * 1024; // yield every 1MB to keep UI alive

        let offset = 0;
        let nextYield = YIELD_EVERY;

        while (offset < size) {
            if (signal?.aborted) {
                throw new Error('Aborted');
            }

            const end = Math.min(offset + MAX_CHUNK, size);
            const sub = buffer.subarray(offset, end);
            crypto.getRandomValues(sub);
            offset = end;

            // If we've passed the yield threshold, let the event loop run
            if (offset >= nextYield) {
                await this._yield();
                nextYield += YIELD_EVERY;
            }
        }
        return buffer;
    }

    async _yield() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }
}
