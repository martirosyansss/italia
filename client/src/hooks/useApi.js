import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

// Хук для работы с API
export function useApi(endpoint, options = {}) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`${API_BASE}${endpoint}`);
            if (!response.ok) throw new Error('Ошибка загрузки данных');
            const json = await response.json();
            setData(json);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return { data, loading, error, refetch: fetchData };
}

// API функции для клиентов
export const clientsApi = {
    getAll: () => fetch(`${API_BASE}/clients`).then(r => r.json()),

    getById: (id) => fetch(`${API_BASE}/clients/${id}`).then(r => r.json()),

    create: (data) => fetch(`${API_BASE}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json()),

    update: (id, data) => fetch(`${API_BASE}/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json()),

    delete: (id) => fetch(`${API_BASE}/clients/${id}`, {
        method: 'DELETE'
    }).then(r => r.json())
};

// API функции для слотов
export const slotsApi = {
    getHistory: (limit = 50) => fetch(`${API_BASE}/slots/history?limit=${limit}`).then(r => r.json()),

    getLatest: () => fetch(`${API_BASE}/slots/latest`).then(r => r.json()),

    runCheck: () => fetch(`${API_BASE}/slots/check`, { method: 'POST' }).then(r => r.json()),

    getSchedulerStatus: () => fetch(`${API_BASE}/slots/scheduler`).then(r => r.json()),

    controlScheduler: (action) => fetch(`${API_BASE}/slots/scheduler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    }).then(r => r.json())
};

// API функции для настроек
export const settingsApi = {
    getAll: () => fetch(`${API_BASE}/settings`).then(r => r.json()),

    update: (data) => fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json())
};

// API функции для статистики
export const statsApi = {
    get: () => fetch(`${API_BASE}/stats`).then(r => r.json())
};

export default { clientsApi, slotsApi, settingsApi, statsApi };
