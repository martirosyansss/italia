(function (global) {
    const DIAGNOSTIC_LOG_LIMIT = 150;

    function normalizeLogPayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return {};
        }

        const normalized = {};

        Object.entries(payload).forEach(([key, value]) => {
            if (typeof value === 'string') {
                normalized[key] = value.length > 400 ? `${value.slice(0, 397)}...` : value;
            } else if (Array.isArray(value)) {
                normalized[key] = value.slice(0, 20);
            } else {
                normalized[key] = value;
            }
        });

        return normalized;
    }

    async function appendDiagnosticLog(type, payload = {}) {
        if (!global.chrome?.storage?.local) {
            return;
        }

        const { diagnosticLogs = [] } = await chrome.storage.local.get('diagnosticLogs');
        const nextLogs = diagnosticLogs.concat({
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            time: new Date().toISOString(),
            type,
            payload: normalizeLogPayload(payload)
        }).slice(-DIAGNOSTIC_LOG_LIMIT);

        await chrome.storage.local.set({ diagnosticLogs: nextLogs });
    }

    async function readDiagnosticLogs() {
        if (!global.chrome?.storage?.local) {
            return [];
        }

        const { diagnosticLogs = [] } = await chrome.storage.local.get('diagnosticLogs');
        return diagnosticLogs;
    }

    async function clearDiagnosticLogs() {
        if (!global.chrome?.storage?.local) {
            return;
        }

        await chrome.storage.local.set({ diagnosticLogs: [] });
    }

    function buildDiagnosticExport(data = {}) {
        return JSON.stringify({
            exportedAt: new Date().toISOString(),
            ...data
        }, null, 2);
    }

    global.DIAGNOSTIC_LOG_LIMIT = DIAGNOSTIC_LOG_LIMIT;
    global.appendDiagnosticLog = appendDiagnosticLog;
    global.readDiagnosticLogs = readDiagnosticLogs;
    global.clearDiagnosticLogs = clearDiagnosticLogs;
    global.buildDiagnosticExport = buildDiagnosticExport;
})(typeof self !== 'undefined' ? self : window);
