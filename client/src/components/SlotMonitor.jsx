import { useState, useEffect } from 'react';
import {
    RefreshCw,
    Play,
    Pause,
    Clock,
    CheckCircle,
    XCircle,
    Activity,
    Calendar,
    Image,
    ExternalLink,
    AlertTriangle
} from 'lucide-react';

function SlotMonitor() {
    const [schedulerStatus, setSchedulerStatus] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Обновляем каждые 10 сек
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const [statusRes, historyRes] = await Promise.all([
                fetch('/api/slots/scheduler'),
                fetch('/api/slots/history?limit=20')
            ]);

            const statusData = await statusRes.json();
            const historyData = await historyRes.json();

            setSchedulerStatus(statusData);
            setHistory(Array.isArray(historyData) ? historyData : []);
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleManualCheck = async () => {
        setChecking(true);
        try {
            await fetch('/api/slots/check', { method: 'POST' });
            await fetchData();
        } catch (error) {
            console.error('Ошибка проверки:', error);
        } finally {
            setChecking(false);
        }
    };

    const handleToggleScheduler = async () => {
        try {
            const action = schedulerStatus?.isRunning ? 'stop' : 'start';
            await fetch('/api/slots/scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            await fetchData();
        } catch (error) {
            console.error('Ошибка управления планировщиком:', error);
        }
    };

    const formatTime = (dateString) => {
        if (!dateString) return '—';
        const date = new Date(dateString);
        return date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div>
            <div className="page-header">
                <h2>Мониторинг слотов</h2>
                <p>Автоматическая проверка свободных мест для записи в посольство</p>
            </div>

            {/* Scheduler Status Card */}
            <div className={`scheduler-card ${schedulerStatus?.isRunning ? 'active' : ''}`} style={{ marginBottom: 'var(--spacing-xl)' }}>
                <div className="scheduler-status">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                        <div className={`stat-icon ${schedulerStatus?.isRunning ? 'success' : ''}`} style={{ width: 56, height: 56 }}>
                            <Activity size={28} />
                        </div>
                        <div>
                            <h3 style={{ marginBottom: 'var(--spacing-xs)' }}>
                                Автоматическая проверка
                            </h3>
                            <div className="status-indicator">
                                <span className={`status-dot ${schedulerStatus?.isRunning ? 'active' : 'inactive'}`}></span>
                                <span style={{ color: 'var(--text-secondary)' }}>
                                    {schedulerStatus?.isRunning ? 'Активна' : 'Остановлена'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={handleManualCheck}
                            disabled={checking}
                        >
                            {checking ? (
                                <>
                                    <span className="spinner" style={{ width: 16, height: 16 }}></span>
                                    Проверяется...
                                </>
                            ) : (
                                <>
                                    <RefreshCw size={18} />
                                    Проверить сейчас
                                </>
                            )}
                        </button>
                        <button
                            className={`btn ${schedulerStatus?.isRunning ? 'btn-danger' : 'btn-primary'}`}
                            onClick={handleToggleScheduler}
                        >
                            {schedulerStatus?.isRunning ? (
                                <>
                                    <Pause size={18} />
                                    Остановить
                                </>
                            ) : (
                                <>
                                    <Play size={18} />
                                    Запустить
                                </>
                            )}
                        </button>
                    </div>
                </div>

                <div className="scheduler-info">
                    <div className="scheduler-stat">
                        <div className="scheduler-stat-value">{schedulerStatus?.interval || 15}</div>
                        <div className="scheduler-stat-label">Интервал (мин)</div>
                    </div>
                    <div className="scheduler-stat">
                        <div className="scheduler-stat-value">{schedulerStatus?.checkCount || 0}</div>
                        <div className="scheduler-stat-label">Проверок за сессию</div>
                    </div>
                    <div className="scheduler-stat">
                        <div className="scheduler-stat-value" style={{ fontSize: '1rem' }}>
                            {schedulerStatus?.lastCheckTime ? formatTime(schedulerStatus.lastCheckTime) : '—'}
                        </div>
                        <div className="scheduler-stat-label">Последняя проверка</div>
                    </div>
                </div>
            </div>

            {/* Manual Check Section */}
            <div className="card" style={{ marginBottom: 'var(--spacing-xl)', borderColor: 'var(--accent-primary)', borderWidth: 2 }}>
                <div className="card-header">
                    <h3 className="card-title" style={{ color: 'var(--accent-primary)' }}>
                        <ExternalLink size={20} />
                        Проверить слоты вручную
                    </h3>
                </div>
                <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div style={{
                        background: 'rgba(255, 183, 77, 0.1)',
                        border: '1px solid rgba(255, 183, 77, 0.3)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--spacing-md)',
                        marginBottom: 'var(--spacing-lg)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--spacing-sm)'
                    }}>
                        <AlertTriangle size={20} style={{ color: '#FFB74D', flexShrink: 0, marginTop: 2 }} />
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            <strong style={{ color: '#FFB74D' }}>Cloudflare защита:</strong> TLS Contact использует строгую защиту,
                            которая блокирует автоматизированные проверки. Используйте ручной режим для проверки слотов.
                        </div>
                    </div>

                    <a
                        href="https://visas-it.tlscontact.com/hy-am/1909121/workflow/appointment-booking"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center', padding: 'var(--spacing-lg)', fontSize: '1.1rem' }}
                    >
                        <ExternalLink size={20} />
                        🇮🇹 Открыть TLS Contact (Запись на визу)
                    </a>

                    <div style={{ marginTop: 'var(--spacing-md)', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                        Откроется в вашем обычном браузере — Cloudflare пропустит
                    </div>
                </div>

                <div style={{
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: 'var(--spacing-md)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.9rem',
                    lineHeight: 1.6
                }}>
                    <strong>Как проверять:</strong>
                    <ol style={{ marginTop: 'var(--spacing-sm)', paddingLeft: 'var(--spacing-lg)' }}>
                        <li>Нажмите кнопку выше — откроется сайт TLS Contact</li>
                        <li>Войдите в свой аккаунт если нужно</li>
                        <li>Проверьте доступные даты в календаре</li>
                        <li>Если нашли слот — запишите клиента!</li>
                    </ol>
                </div>
            </div>

            {/* How it works */}
            <div className="card" style={{ marginBottom: 'var(--spacing-xl)' }}>
                <div className="card-header">
                    <h3 className="card-title">
                        <Calendar size={20} />
                        Автоматическая проверка
                    </h3>
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    <p style={{ marginBottom: 'var(--spacing-md)' }}>
                        <strong>1.</strong> При первом запуске откроется браузер — пройдите проверку Cloudflare вручную.
                    </p>
                    <p style={{ marginBottom: 'var(--spacing-md)' }}>
                        <strong>2.</strong> После успешной авторизации система запомнит сессию.
                    </p>
                    <p style={{ marginBottom: 'var(--spacing-md)' }}>
                        <strong>3.</strong> Автоматические проверки будут работать пока сессия активна.
                    </p>
                    <p>
                        <strong>4.</strong> При обнаружении свободных мест — уведомление в Telegram.
                    </p>
                </div>
            </div>

            {/* History */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        <Clock size={20} />
                        История проверок
                    </h3>
                </div>

                {loading ? (
                    <div className="empty-state">
                        <div className="spinner"></div>
                        <p style={{ marginTop: 'var(--spacing-md)' }}>Загрузка...</p>
                    </div>
                ) : history.length === 0 ? (
                    <div className="empty-state">
                        <Clock size={48} />
                        <h3>Нет данных</h3>
                        <p>Запустите первую проверку, чтобы увидеть результаты</p>
                    </div>
                ) : (
                    <div className="history-list">
                        {history.map((check, index) => (
                            <div
                                key={check.id || index}
                                className={`history-item ${check.status === 'success' ? 'success' : 'error'}`}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                                    <div>
                                        {check.status === 'success' ? (
                                            <CheckCircle size={20} style={{ color: 'var(--accent-success)' }} />
                                        ) : (
                                            <XCircle size={20} style={{ color: 'var(--accent-error)' }} />
                                        )}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 500 }}>
                                            {check.status === 'success' ? 'Проверка выполнена' : 'Ошибка проверки'}
                                        </div>
                                        <div className="history-time">
                                            {formatTime(check.checkTime)}
                                        </div>
                                    </div>
                                </div>

                                <div className="history-result">
                                    {check.status === 'success' && (
                                        <>
                                            {check.availableSlots && JSON.parse(check.availableSlots || '[]').length > 0 ? (
                                                <span className="badge badge-completed">
                                                    {JSON.parse(check.availableSlots).length} слотов
                                                </span>
                                            ) : (
                                                <span className="badge badge-pending">
                                                    Нет слотов
                                                </span>
                                            )}
                                        </>
                                    )}
                                    {check.status === 'error' && (
                                        <span style={{ color: 'var(--accent-error)', fontSize: '0.875rem' }}>
                                            {check.errorMessage || 'Неизвестная ошибка'}
                                        </span>
                                    )}
                                    {check.screenshot && (
                                        <button
                                            className="btn btn-secondary btn-sm btn-icon"
                                            title="Просмотреть скриншот"
                                        >
                                            <Image size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default SlotMonitor;
