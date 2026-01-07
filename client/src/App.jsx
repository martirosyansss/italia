import { useState, useEffect } from 'react';
import {
    LayoutDashboard,
    Users,
    CalendarCheck,
    Settings as SettingsIcon,
    Activity,
    Code,
    RefreshCw
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import ClientList from './components/ClientList';
import SlotMonitor from './components/SlotMonitor';
import Settings from './components/Settings';
import ScriptGenerator from './components/ScriptGenerator';

function App() {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [stats, setStats] = useState(null);

    // Загрузка статистики при старте
    useEffect(() => {
        fetchStats();
        // Обновляем статистику каждые 30 секунд
        const interval = setInterval(fetchStats, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchStats = async () => {
        try {
            const response = await fetch('/api/stats');
            if (response.ok) {
                const data = await response.json();
                setStats(data);
            }
        } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
        }
    };

    const navItems = [
        { id: 'dashboard', label: 'Главная', icon: LayoutDashboard },
        { id: 'clients', label: 'Клиенты', icon: Users },
        { id: 'monitor', label: 'Мониторинг', icon: Activity },
        { id: 'script', label: 'Генератор скрипта', icon: Code },
        { id: 'settings', label: 'Настройки', icon: SettingsIcon },
    ];

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard':
                return <Dashboard stats={stats} onRefresh={fetchStats} />;
            case 'clients':
                return <ClientList onUpdate={fetchStats} />;
            case 'monitor':
                return <SlotMonitor />;
            case 'script':
                return <ScriptGenerator />;
            case 'settings':
                return <Settings />;
            default:
                return <Dashboard stats={stats} onRefresh={fetchStats} />;
        }
    };

    return (
        <div className="app">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-logo">
                    <span className="flag">🇮🇹</span>
                    <h1>TLS Manager</h1>
                </div>

                <nav className="sidebar-nav">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                            onClick={() => setCurrentPage(item.id)}
                        >
                            <item.icon />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>

                {/* Профессиональный статус-панель внизу сайдбара */}
                <div className="sidebar-status-panel">
                    <div className="status-header">
                        <div className="status-indicator">
                            <span className={`status-dot-large ${stats?.schedulerRunning ? 'active' : 'inactive'}`}></span>
                            <div className="status-text">
                                <span className="status-title">
                                    {stats === null ? 'Загрузка...' : (stats?.schedulerRunning ? 'Мониторинг активен' : 'Мониторинг остановлен')}
                                </span>
                                <span className="status-subtitle">
                                    {stats === null ? 'Подключение к серверу' : (stats?.schedulerRunning ? 'Автоматический поиск слотов' : 'Запустите в настройках')}
                                </span>
                            </div>
                        </div>
                        <button
                            className="status-refresh-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                fetchStats();
                            }}
                            title="Обновить статистику"
                        >
                            <RefreshCw size={16} />
                        </button>
                    </div>

                    <div className="status-stats">
                        <div className="status-stat-item">
                            <CalendarCheck size={14} />
                            <span className="stat-value">{stats?.totalChecks ?? '—'}</span>
                            <span className="stat-label">проверок</span>
                        </div>
                        <div className="status-stat-divider"></div>
                        <div className="status-stat-item">
                            <Users size={14} />
                            <span className="stat-value">{stats?.pendingClients ?? '—'}</span>
                            <span className="stat-label">в очереди</span>
                        </div>
                    </div>

                    <div className="status-last-check">
                        <span className="last-check-label">Последняя проверка</span>
                        <span className="last-check-time">
                            {stats?.lastCheck
                                ? new Date(stats.lastCheck).toLocaleTimeString('ru-RU', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                })
                                : '—:—:—'
                            }
                        </span>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {renderPage()}
            </main>
        </div>
    );
}

export default App;
