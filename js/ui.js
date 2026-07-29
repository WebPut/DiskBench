import { StorageManager } from './storage.js';
import { BenchmarkEngine } from './benchmark.js';

/**
 * UIController
 * ------------
 * Bridges the DOM with StorageManager & BenchmarkEngine.
 * Handles all user interactions, live stat updates, logging, and error display.
 */
export class UIController {
    constructor() {
        // Cache all the DOM elements we'll touch
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
            logList: document.getElementById('log-list'),
            deleteStatus: document.getElementById('delete-status'),
        };

        // Core logic
        this.storageManager = new StorageManager();
        this.benchmarkEngine = new BenchmarkEngine(this.storageManager);

        // Wire callbacks from the engine to the UI
        this.benchmarkEngine.onProgress = (stats) => this.handleProgress(stats);
        this.benchmarkEngine.onLog = (msg) => this.addLog(msg);
        this.benchmarkEngine.onComplete = () => this.handleComplete();
        this.benchmarkEngine.onError = (err) => this.handleError(err);

        // Bind instance methods so `this` stays correct in event listeners
        this.startBenchmark = this.startBenchmark.bind(this);
        this.deleteAllData = this.deleteAllData.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);

        // Attach listeners
        this.elements.startBtn.addEventListener('click', this.startBenchmark);
        this.elements.deleteBtn.addEventListener('click', this.deleteAllData);
        document.addEventListener('keydown', this.onKeyDown);

        // Initial refresh (display any leftover data from previous sessions)
        this.refreshTotalStored();
    }

    /* ======================================================================
       PUBLIC ACTIONS
       ====================================================================== */

    /**
     * Start the benchmark after validating inputs and initializing the backend.
     */
    async startBenchmark() {
        if (this.benchmarkEngine.isRunning) {
            this.addLog('⚠️ A benchmark is already running.');
            return;
        }

        const targetGB = parseFloat(this.elements.storageGbInput.value);
        const bufferMB = parseFloat(this.elements.bufferMbInput.value);
        const backend = this.elements.backendSelect.value;

        if (isNaN(targetGB) || targetGB <= 0) {
            this.addLog('❌ Please enter a valid target storage size (GB).');
            return;
        }
        if (isNaN(bufferMB) || bufferMB <= 0) {
            this.addLog('❌ Please enter a valid buffer size (MB).');
            return;
        }

        try {
            this.addLog(`⚡ Initializing ${backend} backend...`);
            await this.storageManager.init(backend);
            this.addLog('✅ Backend ready.');

            this.elements.statusMessage.textContent = 'Running...';

            // Kick off the engine (runs asynchronously in the background)
            this.benchmarkEngine.start(targetGB, bufferMB);
        } catch (err) {
            this.addLog(`❌ Failed to start: ${err.message}`);
            this.elements.statusMessage.textContent = 'Error — see log.';
        }
    }

    /**
     * Delete all stored data after confirmation.
     */
    async deleteAllData() {
        const confirmed = confirm(
            'Are you sure you want to permanently delete ALL benchmark data stored on this device?'
        );
        if (!confirmed) return;

        try {
            this.addLog('🗑️ Deleting all stored data...');
            await this.storageManager.deleteAll();
            this.addLog('✅ All data deleted.');
            this.elements.deleteStatus.textContent = 'All data has been deleted.';
            this.refreshTotalStored();
            this.elements.progressValue.textContent = '0%';
            this.elements.speedValue.textContent = '— MB/s';
            this.elements.statusMessage.textContent = 'Idle — all data cleared.';
        } catch (err) {
            this.addLog(`❌ Delete failed: ${err.message}`);
        }
    }

    /**
     * Spacebar shortcut — triggers the Start button when not typing in an input.
     */
    onKeyDown(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
        if (event.code === 'Space') {
            event.preventDefault(); // prevent page scroll
            this.elements.startBtn.click();
        }
    }

    /* ======================================================================
       BENCHMARK CALLBACKS
       ====================================================================== */

    handleProgress(stats) {
        const { bytesWrittenThisRun, targetBytesThisRun, cumulativeBytes, speed } = stats;

        // Total storage used (cumulative, includes previous runs)
        this.elements.totalStoredValue.textContent =
            this._formatBytesToGB(cumulativeBytes, 2) + ' GB';

        // Run progress
        const percent = targetBytesThisRun > 0
            ? (bytesWrittenThisRun / targetBytesThisRun) * 100
            : 0;
        this.elements.progressValue.textContent = percent.toFixed(1) + '%';

        // Speed in MB/s
        const speedMBs = speed / (1024 * 1024);
        this.elements.speedValue.textContent = speedMBs.toFixed(2) + ' MB/s';

        // Status line
        this.elements.statusMessage.textContent =
            `Writing… ${this._formatBytesToGB(bytesWrittenThisRun, 2)} / ${this._formatBytesToGB(targetBytesThisRun, 2)} GB`;
    }

    handleComplete() {
        this.elements.statusMessage.textContent = 'Idle — benchmark finished.';
        this.elements.speedValue.textContent = '— MB/s';
        this.refreshTotalStored();
    }

    handleError(err) {
        this.elements.statusMessage.textContent = 'Error — check log.';
        this.addLog(`❌ Error: ${err.message || err}`);
    }

    /* ======================================================================
       HELPERS
       ====================================================================== */

    addLog(message) {
        const li = document.createElement('li');
        const time = new Date().toLocaleTimeString();
        li.textContent = `[${time}] ${message}`;
        this.elements.logList.appendChild(li);
        this.elements.logList.scrollTop = this.elements.logList.scrollHeight;
    }

    async refreshTotalStored() {
        try {
            const bytes = await this.storageManager.getTotalStored();
            this.elements.totalStoredValue.textContent = this._formatBytesToGB(bytes, 2) + ' GB';
        } catch (err) {
            // Backend not initialized yet – that's fine
        }
    }

    _formatBytesToGB(bytes, decimals = 2) {
        return (bytes / 1e9).toFixed(decimals);
    }
}
