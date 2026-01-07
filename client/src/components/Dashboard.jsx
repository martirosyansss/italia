import {
    Users,
    Clock,
    CheckCircle,
    AlertCircle,
    RefreshCw,
    TrendingUp,
    Calendar
} from 'lucide-react';

function Dashboard({ stats, onRefresh }) {
    const statCards = [
        {
            label: 'Всего клиентов',
            value: stats?.totalClients || 0,
            icon: Users,
            colorClass: ''
        },
        {
            label: 'Ожидают записи',
            value: stats?.pendingClients || 0,
            icon: Clock,
            colorClass: 'warning'
        },
        {
            label: 'Записаны',
            value: stats?.scheduledClients || 0,
            icon: Calendar,
            colorClass: 'info'
        },
        {
            label: 'Завершено',
            value: stats?.completedClients || 0,
            icon: CheckCircle,
            colorClass: 'success'
        }
    ];

    return (
        <div>
            <div className="page-header">
                <h2>Панель управления</h2>
                <p>Обзор текущего состояния системы записи в посольство Италии</p>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
                {statCards.map((stat, index) => (
                    <div key={index} className="stat-card">
                        <div className={`stat-icon ${stat.colorClass}`}>
                            <stat.icon size={24} />
                        </div>
                        <div>
                            <div className="stat-value">{stat.value}</div>
                            <div className="stat-label">{stat.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <div className="card" style={{ marginBottom: 'var(--spacing-xl)' }}>
                <div className="card-header">
                    <h3 className="card-title">
                        <TrendingUp size={20} />
                        Быстрые действия
                    </h3>
                    <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
                        <RefreshCw size={16} />
                        Обновить
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)' }}>
                    <QuickActionCard
                        title="Проверить слоты"
                        description="Запустить ручную проверку доступных дат"
                        icon={RefreshCw}
                        onClick={async () => {
                            try {
                                await fetch('/api/slots/check', { method: 'POST' });
                                onRefresh();
                            } catch (error) {
                                console.error('Ошибка:', error);
                            }
                        }}
                    />
                    <QuickActionCard
                        title="Добавить клиента"
                        description="Зарегистрировать нового клиента в системе"
                        icon={Users}
                        href="#clients"
                    />
                    <QuickActionCard
                        title="История проверок"
                        description="Просмотреть журнал всех проверок"
                        icon={Calendar}
                        href="#monitor"
                    />
                </div>
            </div>

            {/* System Status */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        <AlertCircle size={20} />
                        Статус системы
                    </h3>
                </div>

                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    <StatusRow
                        label="Планировщик проверок"
                        status={stats?.schedulerRunning ? 'active' : 'inactive'}
                        text={stats?.schedulerRunning ? 'Активен' : 'Остановлен'}
                    />
                    <StatusRow
                        label="Последняя проверка"
                        status={stats?.lastCheck ? 'active' : 'inactive'}
                        text={stats?.lastCheck ? new Date(stats.lastCheck).toLocaleString('ru-RU') : 'Нет данных'}
                    />
                    <StatusRow
                        label="Всего проверок"
                        status="active"
                        text={stats?.totalChecks || 0}
                    />
                </div>
            </div>
        </div>
    );
}

function QuickActionCard({ title, description, icon: Icon, onClick, href }) {
    const handleClick = () => {
        if (onClick) onClick();
    };

    return (
        <button
            className="card"
            onClick={handleClick}
            style={{
                cursor: 'pointer',
                textAlign: 'left',
                border: '1px solid var(--border-color)',
                width: '100%'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-md)' }}>
                <div className="stat-icon" style={{ width: 40, height: 40 }}>
                    <Icon size={18} />
                </div>
                <div>
                    <h4 style={{ fontSize: '0.95rem', marginBottom: 'var(--spacing-xs)' }}>{title}</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {description}
                    </p>
                </div>
            </div>
        </button>
    );
}

function StatusRow({ label, status, text }) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--spacing-md)',
            background: 'var(--bg-glass)',
            borderRadius: 'var(--radius-md)'
        }}>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <div className="status-indicator">
                <span className={`status-dot ${status}`}></span>
                <span>{text}</span>
            </div>
        </div>
    );
}

export default Dashboard;
