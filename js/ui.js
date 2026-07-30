import { StorageManager } from './storage.js';
import { BenchmarkEngine } from './benchmark.js';

export class UIController {
    constructor() {
        this.elements = {
            storageGbInput: document.getElementById('storage-gb'),
            bufferMbInput: document.getElementById('buffer-mb'),
            backendSelect: document.getElementById('backend-select'),
            startBtn: document.getElementById('start-btn'),
            deleteBtn: document.getElementById('delete-btn'),
            totalStoredValue: document.getElementById('total-stored-value'),
            progressValue: document.getElementById('progress-value'),
            speedValue: document.getElementById('speed-value'),
            statusMessage: document.getElementById('status-message'),
            deleteStatus: document.getElementById('delete-status'),
        };

        this.storageManager = new StorageManager();
        this.benchmarkEngine = new BenchmarkEngine(this.storageManager);

        // Simplified callbacks – no logging
        this.benchmarkEngine.onProgress = (stats) => this.handleProgress(stats);
        this.benchmarkEngine.onComplete = () => this.handleComplete();
        this.benchmarkEngine.onError = (err) => this.handleError(err);

        this.startBenchmark = this.startBenchmark.bind(this);
        this.deleteAllData = this.deleteAllData.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);

        this.elements.startBtn.addEventListener('click', this.startBenchmark);
        this.elements.deleteBtn.addEventListener('click', this.deleteAllData);
        document.addEventListener('keydown', this.onKeyDown);

        this.refreshTotalStored();
    }

    /* ======================================================================
       PUBLIC ACTIONS
       ====================================================================== */

    async startBenchmark() {
        if (this.benchmarkEngine.isRunning) {
            this.elements.statusMessage.textContent = 'A benchmark is already running.';
            return;
        }

        const targetGB = parseFloat(this.elements.storageGbInput.value);
        const bufferMB = parseFloat(this.elements.bufferMbInput.value);
        const backend = this.elements.backendSelect.value;

        if (isNaN(targetGB) || targetGB <= 0) {
            this.elements.statusMessage.textContent = 'Please enter a valid target storage size (GB).';
            return;
        }
        if (isNaN(bufferMB) || bufferMB <= 0) {
            this.elements.statusMessage.textContent = 'Please enter a valid buffer size (MB).';
            return;
        }

        try {
            this.elements.statusMessage.textContent = `Initializing ${backend}...`;
            await this.storageManager.init(backend);
            this.elements.statusMessage.textContent = 'Running...';
            this.benchmarkEngine.start(targetGB, bufferMB);
        } catch (err) {
            this.elements.statusMessage.textContent = `Error: ${err.message}`;
        }
    }

   async deleteAllData() {
    const confirmed = confirm('Delete ALL benchmark data?');
    if (!confirmed) return;

    this.elements.deleteStatus.textContent = 'Deleting...';
    try {
        await this.storageManager.deleteAll();
        this.elements.deleteStatus.textContent = 'All data deleted.';
        this.elements.totalStoredValue.textContent = '0.00 GB';
        this.elements.progressValue.textContent = '0%';
        this.elements.speedValue.textContent = '— MB/s';
        this.elements.statusMessage.textContent = 'Idle — all data cleared.';
    } catch (err) {
        this.elements.deleteStatus.textContent = `Delete failed: ${err.message}`;
    }
}


    onKeyDown(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
        if (event.code === 'Space') {
            event.preventDefault();
            this.elements.startBtn.click();
        }
    }

    /* ======================================================================
       BENCHMARK CALLBACKS
       ====================================================================== */

    handleProgress(stats) {
        const { bytesWrittenThisRun, targetBytesThisRun, cumulativeBytes, speed } = stats;

        this.elements.totalStoredValue.textContent =
            this._formatBytesToGB(cumulativeBytes, 2) + ' GB';

        const percent = targetBytesThisRun > 0
            ? (bytesWrittenThisRun / targetBytesThisRun) * 100
            : 0;
        this.elements.progressValue.textContent = percent.toFixed(1) + '%';

        const speedMBs = speed / (1024 * 1024);
        this.elements.speedValue.textContent = speedMBs.toFixed(2) + ' MB/s';

        this.elements.statusMessage.textContent =
            `Writing… ${this._formatBytesToGB(bytesWrittenThisRun, 2)} / ${this._formatBytesToGB(targetBytesThisRun, 2)} GB`;
    }

    handleComplete() {
        this.elements.statusMessage.textContent = 'Idle — benchmark finished.';
        this.elements.speedValue.textContent = '— MB/s';
        this.refreshTotalStored();
    }

    handleError(err) {
        this.elements.statusMessage.textContent = `Error: ${err.message || err}`;
    }

    /* ======================================================================
       HELPERS
       ====================================================================== */

    async refreshTotalStored() {
        try {
            // Attempt to read total stored bytes. If no backend is set, this returns 0.
            const bytes = await this.storageManager.getTotalStored();
            this.elements.totalStoredValue.textContent = this._formatBytesToGB(bytes, 2) + ' GB';
        } catch (err) {
            // Silently ignore if no backend is initialized
        }
    }

    _formatBytesToGB(bytes, decimals = 2) {
        return (bytes / 1e9).toFixed(decimals);
    }
}
