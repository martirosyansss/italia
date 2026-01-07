import { useState, useEffect } from 'react';
import {
    Settings as SettingsIcon,
    Bell,
    Clock,
    Send,
    Save,
    CheckCircle
} from 'lucide-react';

function Settings() {
    const [settings, setSettings] = useState({
        checkInterval: '15',
        telegramBotToken: '',
        telegramChatId: '',
        notificationsEnabled: 'false'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [saved, setSaved] = useState(false);
    const [testResult, setTestResult] = useState(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await fetch('/api/settings');
            const data = await response.json();
            setSettings(data);
        } catch (error) {
            console.error('Ошибка загрузки настроек:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        setSaved(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (error) {
            console.error('Ошибка сохранения:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleTestTelegram = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            // Сначала сохраняем настройки
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            // Затем отправляем тестовое сообщение
            const response = await fetch('/api/telegram/test', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                setTestResult({
                    success: true,
                    message: '✅ Тестовое сообщение отправлено в Telegram!'
                });
            } else {
                setTestResult({
                    success: false,
                    message: '❌ Ошибка: ' + (result.error || 'Не удалось отправить')
                });
            }
        } catch (error) {
            setTestResult({
                success: false,
                message: '❌ Ошибка отправки: ' + error.message
            });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="empty-state">
                <div className="spinner"></div>
                <p style={{ marginTop: 'var(--spacing-md)' }}>Загрузка настроек...</p>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <h2>Настройки</h2>
                <p>Конфигурация системы мониторинга и уведомлений</p>
            </div>

            <div className="settings-grid">
                {/* Интервал проверки */}
                <div className="settings-section">
                    <h3 className="settings-section-title">
                        <Clock size={20} />
                        Интервал проверки
                    </h3>

                    <div className="form-group">
                        <label className="form-label">Проверять каждые (минут)</label>
                        <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
                            <input
                                type="range"
                                min="5"
                                max="60"
                                step="5"
                                value={settings.checkInterval}
                                onChange={(e) => handleChange('checkInterval', e.target.value)}
                                style={{ flex: 1 }}
                            />
                            <span style={{
                                minWidth: 60,
                                textAlign: 'center',
                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                background: 'var(--bg-glass)',
                                borderRadius: 'var(--radius-md)',
                                fontWeight: 600
                            }}>
                                {settings.checkInterval} мин
                            </span>
                        </div>
                        <p style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-muted)',
                            marginTop: 'var(--spacing-sm)'
                        }}>
                            Рекомендуется 10-15 минут. Слишком частые проверки могут привести к блокировке.
                        </p>
                    </div>
                </div>

                {/* Telegram уведомления */}
                <div className="settings-section">
                    <h3 className="settings-section-title">
                        <Bell size={20} />
                        Telegram уведомления
                    </h3>

                    <div className="form-group">
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 'var(--spacing-lg)'
                        }}>
                            <div>
                                <label className="form-label" style={{ marginBottom: 0 }}>Включить уведомления</label>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Получать сообщения о найденных слотах
                                </p>
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={settings.notificationsEnabled === 'true'}
                                    onChange={(e) => handleChange('notificationsEnabled', e.target.checked ? 'true' : 'false')}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Токен бота</label>
                        <input
                            type="password"
                            className="form-input"
                            value={settings.telegramBotToken}
                            onChange={(e) => handleChange('telegramBotToken', e.target.value)}
                            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--spacing-xs)' }}>
                            Получите токен у <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a>
                        </p>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Chat ID</label>
                        <input
                            type="text"
                            className="form-input"
                            value={settings.telegramChatId}
                            onChange={(e) => handleChange('telegramChatId', e.target.value)}
                            placeholder="123456789"
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--spacing-xs)' }}>
                            Узнайте свой Chat ID у <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">@userinfobot</a>
                        </p>
                    </div>

                    {settings.telegramBotToken && settings.telegramChatId && (
                        <div style={{ marginTop: 'var(--spacing-lg)' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={handleTestTelegram}
                                disabled={testing}
                            >
                                {testing ? (
                                    <>
                                        <span className="spinner" style={{ width: 16, height: 16 }}></span>
                                        Отправка...
                                    </>
                                ) : (
                                    <>
                                        <Send size={16} />
                                        Отправить тестовое сообщение
                                    </>
                                )}
                            </button>

                            {testResult && (
                                <div style={{
                                    marginTop: 'var(--spacing-md)',
                                    padding: 'var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    background: testResult.success ? 'rgba(0, 200, 83, 0.1)' : 'rgba(255, 82, 82, 0.1)',
                                    color: testResult.success ? 'var(--accent-success)' : 'var(--accent-error)',
                                    fontSize: '0.9rem'
                                }}>
                                    {testResult.message}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Информация */}
                <div className="settings-section">
                    <h3 className="settings-section-title">
                        <SettingsIcon size={20} />
                        О системе
                    </h3>

                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                        <p style={{ marginBottom: 'var(--spacing-md)' }}>
                            <strong>TLS Appointment Manager</strong> — система для мониторинга и управления записями в посольство Италии.
                        </p>
                        <p style={{ marginBottom: 'var(--spacing-md)' }}>
                            <strong>Версия:</strong> 1.0.0
                        </p>
                        <p>
                            <strong>Важно:</strong> При первом запуске проверки откроется браузер Chrome.
                            Вам нужно один раз вручную пройти проверку Cloudflare на сайте TLS Contact.
                            После этого система запомнит сессию и будет работать автоматически.
                        </p>
                    </div>
                </div>
            </div>

            {/* Save Button */}
            <div style={{
                position: 'fixed',
                bottom: 'var(--spacing-xl)',
                right: 'var(--spacing-xl)',
                display: 'flex',
                gap: 'var(--spacing-md)',
                alignItems: 'center'
            }}>
                {saved && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--accent-success)',
                        animation: 'fadeIn 0.3s ease'
                    }}>
                        <CheckCircle size={18} />
                        Сохранено
                    </div>
                )}
                <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ boxShadow: 'var(--shadow-lg)' }}
                >
                    {saving ? (
                        <>
                            <span className="spinner" style={{ width: 16, height: 16 }}></span>
                            Сохранение...
                        </>
                    ) : (
                        <>
                            <Save size={18} />
                            Сохранить настройки
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

export default Settings;
