import { useState, useEffect } from 'react';
import {
    Code,
    Copy,
    Check,
    Settings,
    Bell,
    Clock,
    RefreshCw,
    Volume2,
    Send,
    ExternalLink,
    Play
} from 'lucide-react';

function ScriptGenerator() {
    const [config, setConfig] = useState({
        checkIntervalSeconds: 480,  // 8 минут (6-10 мин диапазон)
        autoRefresh: true,
        refreshIntervalSeconds: 1000,  // ~17 минут (15-20 мин диапазон)
        soundEnabled: true,
        telegramEnabled: true,
        telegramBotToken: '',
        telegramChatIds: '',  // Несколько ID через запятую
        tlsUrl: 'https://visas-it.tlscontact.com/hy-am/1909121/workflow/appointment-booking'
    });

    const [copied, setCopied] = useState(false);
    const [showScript, setShowScript] = useState(false);

    // Загрузка настроек из API
    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await fetch('/api/settings');
            const data = await response.json();
            setConfig(prev => ({
                ...prev,
                telegramBotToken: data.telegramBotToken || '',
                telegramChatIds: data.telegramChatId || ''  // Загружаем как строку
            }));
        } catch (error) {
            console.error('Ошибка загрузки настроек:', error);
        }
    };

    const handleChange = (key, value) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    const generateScript = () => {
        // Преобразуем строку Chat IDs в массив
        const chatIdsArray = config.telegramChatIds
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0);

        return `// ================================================
// 🇮🇹 TLS SLOT MONITOR - Автоматический мониторинг
// ================================================
// Сгенерировано: ${new Date().toLocaleString('ru-RU')}
// URL: ${config.tlsUrl}
// Telegram получатели: ${chatIdsArray.length}
// ================================================

(function() {
    'use strict';
    
    const CONFIG = {
        checkIntervalSeconds: ${config.checkIntervalSeconds},
        autoRefresh: ${config.autoRefresh},
        refreshIntervalSeconds: ${config.refreshIntervalSeconds},
        soundEnabled: ${config.soundEnabled},
        telegramEnabled: ${config.telegramEnabled},
        telegramBotToken: '${config.telegramBotToken}',
        telegramChatIds: [${chatIdsArray.map(id => `'${id}'`).join(', ')}]  // Массив Chat IDs
    };
    
    const NO_SLOTS_KEYWORDS = [
        "we currently don't have any appointment slots available",
        "no slots are currently available",
        "no appointment slots",
        "please check this page regularly"
    ];
    
    let isRunning = true;
    let checkCount = 0;
    let slotsFound = false;
    
    // Имитация действий пользователя для обхода Cloudflare
    function simulateHuman() {
        return new Promise(resolve => {
            // Прокрутка на случайную величину
            window.scrollTo({
                top: Math.random() * 500,
                behavior: 'smooth'
            });
            console.log('👤 Имитация прокрутки...');
            
            // Имитация движения мыши
            const event = new MouseEvent('mousemove', {
                clientX: 100 + Math.random() * 200,
                clientY: 100 + Math.random() * 200,
                bubbles: true
            });
            document.dispatchEvent(event);
            
            // Небольшая задержка после "человеческих" действий
            setTimeout(resolve, 500 + Math.random() * 1000);
        });
    }
    
    function playAlertSound() {
        if (!CONFIG.soundEnabled) return;
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, audioContext.currentTime + i * 0.2);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.2 + 0.3);
            osc.start(audioContext.currentTime + i * 0.2);
            osc.stop(audioContext.currentTime + i * 0.2 + 0.3);
        });
    }
    
    // Отправка ВСЕМ получателям
    async function sendTelegram(message) {
        if (!CONFIG.telegramEnabled || !CONFIG.telegramBotToken || CONFIG.telegramChatIds.length === 0) return;
        
        console.log('📱 Отправка в Telegram (' + CONFIG.telegramChatIds.length + ' получателей)...');
        
        for (const chatId of CONFIG.telegramChatIds) {
            try {
                await fetch('https://api.telegram.org/bot' + CONFIG.telegramBotToken + '/sendMessage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: message,
                        parse_mode: 'HTML'
                    })
                });
                console.log('✅ Отправлено: ' + chatId);
            } catch (e) {
                console.error('❌ Ошибка для ' + chatId + ':', e);
            }
        }
    }
    
    async function checkForSlots() {
        // Сначала имитируем человека
        await simulateHuman();
        
        checkCount++;
        const now = new Date().toLocaleTimeString();
        console.log(\`🔍 Проверка #\${checkCount} — \${now}\`);
        
        const pageText = document.body.innerText.toLowerCase();
        
        // 🚨 ПРОВЕРКА НА CLOUDFLARE БАН
        if (pageText.includes('error 1015') || pageText.includes('rate limited') || 
            pageText.includes('you are being rate limited') || pageText.includes('access denied') ||
            pageText.includes('too many requests') || pageText.includes('captcha')) {
            console.error('🚨 ОБНАРУЖЕН БАН CLOUDFLARE!');
            isRunning = false;
            document.title = '🚨 ЗАБАНЕН!';
            updateUI(false);
            document.getElementById('m-status').innerHTML = '<span style="color:#f55;font-weight:bold">🚨 ЗАБАНЕН!</span>';
            document.getElementById('m-dot').style.background = '#f55';
            document.getElementById('m-dot').style.animation = 'none';
            sendTelegram('🚨 <b>БОТ ЗАБАНЕН!</b>\\n\\nCloudflare заблокировал доступ (Error 1015 / Rate Limited).\\n\\n⚠️ Выключите скрипт и подождите 15-30 минут!');
            return false;
        }
        
        const hasNoSlots = NO_SLOTS_KEYWORDS.some(k => pageText.includes(k.toLowerCase()));
        
        if (hasNoSlots) {
            console.log('❌ Слотов нет');
            updateUI(false);
            return false;
        }
        
        // Проверяем активность кнопки Book
        const bookBtn = document.querySelector('button[disabled]');
        const hasActiveBookBtn = !bookBtn || !pageText.includes("don't have any");
        
        if (hasActiveBookBtn && !pageText.includes("don't have any")) {
            console.log('✅ ВОЗМОЖНО ЕСТЬ СЛОТЫ!');
            if (!slotsFound) {
                slotsFound = true;
                alertUser();
            }
            updateUI(true);
            return true;
        }
        
        console.log('⏳ Ожидание...');
        updateUI(false);
        return false;
    }
    
    function alertUser() {
        playAlertSound();
        document.title = '🔔 СЛОТ НАЙДЕН!';
        if (Notification.permission === 'granted') {
            new Notification('🇮🇹 TLS Slot Monitor', {
                body: 'Найден свободный слот!',
                requireInteraction: true
            });
        }
        sendTelegram('🔔 <b>НАЙДЕН СВОБОДНЫЙ СЛОТ!</b>\\n\\n🇮🇹 TLS Contact Италия\\n\\n⚡ Срочно откройте страницу!');
        
        let blink = true;
        const blinkInt = setInterval(() => {
            document.title = blink ? '🔔 СЛОТ НАЙДЕН!' : '⚡ ПРОВЕРЬТЕ!';
            blink = !blink;
        }, 500);
        setTimeout(() => clearInterval(blinkInt), 30000);
    }
    
    function createUI() {
        const existing = document.getElementById('tls-monitor');
        if (existing) existing.remove();
        
        const div = document.createElement('div');
        div.id = 'tls-monitor';
        div.innerHTML = \`
            <div style="
                position: fixed;
                top: 10px;
                right: 10px;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 12px;
                font-family: -apple-system, sans-serif;
                font-size: 14px;
                z-index: 999999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                min-width: 220px;
            ">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                    <span style="font-size: 18px;">🇮🇹</span>
                    <strong>TLS Monitor</strong>
                    <span id="m-dot" style="width:8px;height:8px;background:#0f0;border-radius:50%;animation:pulse 1s infinite"></span>
                </div>
                <div id="m-status" style="color:#888;font-size:12px;">Мониторинг...</div>
                <div id="m-count" style="color:#666;font-size:11px;margin-top:4px;">Проверок: 0</div>
                <div style="margin-top:10px;display:flex;gap:8px;">
                    <button id="m-stop" style="background:#f55;border:none;color:#fff;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;">Стоп</button>
                    <button id="m-check" style="background:#0c8;border:none;color:#fff;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;">Проверить</button>
                </div>
            </div>
            <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style>
        \`;
        document.body.appendChild(div);
        
        document.getElementById('m-stop').onclick = () => {
            isRunning = false;
            document.getElementById('m-status').innerHTML = '<span style="color:#f55">🛑 Остановлен</span>';
            document.getElementById('m-dot').style.background = '#f55';
            document.getElementById('m-dot').style.animation = 'none';
        };
        document.getElementById('m-check').onclick = () => checkForSlots();
    }
    
    function updateUI(hasSlots) {
        const status = document.getElementById('m-status');
        const count = document.getElementById('m-count');
        const dot = document.getElementById('m-dot');
        if (status) {
            status.innerHTML = hasSlots 
                ? '<span style="color:#0f0;font-weight:bold">✅ СЛОТЫ ЕСТЬ!</span>'
                : '<span style="color:#fa0">⏳ Нет слотов</span>';
        }
        if (dot) dot.style.background = hasSlots ? '#0f0' : '#fa0';
        if (count) count.innerText = 'Проверок: ' + checkCount;
    }
    
    // Случайная задержка - УСИЛЕННАЯ рандомизация для обхода Cloudflare
    function randomDelay(baseMs) {
        const variation = baseMs * 0.6; // ±60% - рваный паттерн, похожий на человека
        return baseMs + (Math.random() * variation * 2 - variation);
    }
    
    function scheduleNextCheck() {
        const delay = randomDelay(CONFIG.checkIntervalSeconds * 1000);
        const mins = Math.round(delay/1000/60);
        const secs = Math.round(delay/1000) % 60;
        console.log('⏱ Следующая проверка через ' + (mins > 0 ? mins + ' мин ' : '') + secs + 'с');
        setTimeout(async () => {
            if (isRunning) {
                await checkForSlots();
                scheduleNextCheck();
            }
        }, delay);
    }
    
    function scheduleNextRefresh() {
        if (!CONFIG.autoRefresh) return;
        
        // Проверка на ошибки сервера - увеличиваем задержку до 30 минут
        const pageText = document.body.innerText.toLowerCase();
        const isServerError = pageText.includes('service unavailable') || 
                              pageText.includes('maintenance') ||
                              pageText.includes('502') ||
                              pageText.includes('503') ||
                              pageText.includes('504') ||
                              pageText.includes('temporarily unavailable');
        
        let delay;
        if (isServerError) {
            delay = 30 * 60 * 1000; // 30 минут при ошибке сервера
            console.log('⚠️ Сервер недоступен! Ждём 30 минут...');
            sendTelegram('⚠️ Сервер TLS временно недоступен (Maintenance/502).\\n\\nСледующая попытка через 30 минут.');
        } else {
            delay = randomDelay(CONFIG.refreshIntervalSeconds * 1000);
            console.log('🔄 Обновление через ' + Math.round(delay/1000/60) + ' мин');
        }
        
        setTimeout(() => {
            if (isRunning && !slotsFound) {
                console.log('🔄 Обновление страницы...');
                location.reload();
            }
        }, delay);
    }
    
    function start() {
        console.log('🚀 TLS Monitor (Anti-reCAPTCHA) запущен!');
        console.log('⏱ Интервал: ' + CONFIG.checkIntervalSeconds + 's (±30%)');
        console.log('🔄 Обновление: каждые ' + Math.round(CONFIG.refreshIntervalSeconds/60) + ' мин');
        if (Notification.permission === 'default') Notification.requestPermission();
        createUI();
        
        // Первая проверка с задержкой (для "человечности")
        const initialDelay = 2000 + Math.random() * 3000;
        console.log('Первая проверка через ' + Math.round(initialDelay/1000) + 'с...');
        
        setTimeout(() => {
            checkForSlots();
            scheduleNextCheck();
            scheduleNextRefresh();
        }, initialDelay);
    }
    
    start();
})();`;
    };

    const copyToClipboard = async () => {
        const script = generateScript();

        // Основной метод - Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(script);
                setCopied(true);
                setTimeout(() => setCopied(false), 3000);
                return;
            } catch (err) {
                console.warn('Clipboard API не сработал, пробуем резервный метод:', err);
            }
        }

        // Резервный метод - через textarea + execCommand
        try {
            const textarea = document.createElement('textarea');
            textarea.value = script;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            const success = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (success) {
                setCopied(true);
                setTimeout(() => setCopied(false), 3000);
            } else {
                alert('Не удалось скопировать. Нажмите "Показать код" и скопируйте вручную (Cmd+C / Ctrl+C)');
            }
        } catch (err) {
            console.error('Ошибка копирования:', err);
            alert('Не удалось скопировать. Нажмите "Показать код" и скопируйте вручную');
        }
    };

    // Скачать скрипт как файл
    const downloadScript = () => {
        const script = generateScript();
        const blob = new Blob([script], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tls-monitor.js';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const openTLS = () => {
        window.open(config.tlsUrl, '_blank');
    };

    return (
        <div>
            <div className="page-header">
                <h2>Генератор скрипта</h2>
                <p>Создайте скрипт мониторинга для консоли браузера</p>
            </div>

            <div className="settings-grid">
                {/* URL */}
                <div className="settings-section">
                    <h3 className="settings-section-title">
                        <ExternalLink size={20} />
                        URL страницы TLS
                    </h3>
                    <div className="form-group">
                        <input
                            type="text"
                            className="form-input"
                            value={config.tlsUrl}
                            onChange={(e) => handleChange('tlsUrl', e.target.value)}
                            placeholder="https://visas-it.tlscontact.com/..."
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--spacing-xs)' }}>
                            Вставьте URL страницы записи на приём
                        </p>
                    </div>
                </div>

                {/* Интервалы */}
                <div className="settings-section">
                    <h3 className="settings-section-title">
                        <Clock size={20} />
                        Интервалы
                    </h3>

                    <div className="form-group">
                        <label className="form-label">Проверка каждые (сек)</label>
                        <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
                            <input
                                type="range"
                                min="30"
                                max="600"
                                step="30"
                                value={config.checkIntervalSeconds}
                                onChange={(e) => handleChange('checkIntervalSeconds', parseInt(e.target.value))}
                                style={{ flex: 1 }}
                            />
                            <span style={{
                                minWidth: 70,
                                textAlign: 'center',
                                padding: 'var(--spacing-xs) var(--spacing-sm)',
                                background: 'var(--bg-glass)',
                                borderRadius: 'var(--radius-md)',
                                fontWeight: 600
                            }}>
                                {config.checkIntervalSeconds >= 60
                                    ? Math.round(config.checkIntervalSeconds / 60) + ' мин'
                                    : config.checkIntervalSeconds + 'с'
                                }
                            </span>
                        </div>
                    </div>

                    <div className="form-group">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <label className="form-label" style={{ marginBottom: 0 }}>Автообновление страницы</label>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Обновлять страницу для получения новых данных
                                </p>
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={config.autoRefresh}
                                    onChange={(e) => handleChange('autoRefresh', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    {config.autoRefresh && (
                        <div className="form-group">
                            <label className="form-label">Обновление страницы</label>
                            <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
                                <input
                                    type="range"
                                    min="180"
                                    max="10800"
                                    step="180"
                                    value={config.refreshIntervalSeconds}
                                    onChange={(e) => handleChange('refreshIntervalSeconds', parseInt(e.target.value))}
                                    style={{ flex: 1 }}
                                />
                                <span style={{
                                    minWidth: 80,
                                    textAlign: 'center',
                                    padding: 'var(--spacing-xs) var(--spacing-sm)',
                                    background: 'var(--bg-glass)',
                                    borderRadius: 'var(--radius-md)',
                                    fontWeight: 600
                                }}>
                                    {config.refreshIntervalSeconds >= 3600
                                        ? Math.round(config.refreshIntervalSeconds / 3600) + ' ч'
                                        : Math.round(config.refreshIntervalSeconds / 60) + ' мин'
                                    }
                                </span>
                            </div>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--spacing-xs)' }}>
                                От 3 минут до 3 часов
                            </p>
                        </div>
                    )}
                </div>

                {/* Уведомления */}
                <div className="settings-section">
                    <h3 className="settings-section-title">
                        <Bell size={20} />
                        Уведомления
                    </h3>

                    <div className="form-group">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <label className="form-label" style={{ marginBottom: 0 }}>
                                    <Volume2 size={16} style={{ display: 'inline', marginRight: 8 }} />
                                    Звук
                                </label>
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={config.soundEnabled}
                                    onChange={(e) => handleChange('soundEnabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div className="form-group">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <label className="form-label" style={{ marginBottom: 0 }}>
                                    <Send size={16} style={{ display: 'inline', marginRight: 8 }} />
                                    Telegram
                                </label>
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={config.telegramEnabled}
                                    onChange={(e) => handleChange('telegramEnabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    {config.telegramEnabled && (
                        <>
                            <div className="form-group">
                                <label className="form-label">Bot Token</label>
                                <input
                                    type="password"
                                    className="form-input"
                                    value={config.telegramBotToken}
                                    onChange={(e) => handleChange('telegramBotToken', e.target.value)}
                                    placeholder="123456789:ABC..."
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Chat IDs (несколько через запятую)</label>
                                <textarea
                                    className="form-input"
                                    value={config.telegramChatIds}
                                    onChange={(e) => handleChange('telegramChatIds', e.target.value)}
                                    placeholder="123456789, 987654321, ..."
                                    rows={3}
                                    style={{ resize: 'vertical' }}
                                />
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--spacing-xs)' }}>
                                    💡 Введите Chat ID через запятую для отправки нескольким людям
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Кнопки действий */}
            <div style={{
                display: 'flex',
                gap: 'var(--spacing-md)',
                marginTop: 'var(--spacing-xl)',
                flexWrap: 'wrap'
            }}>
                <button
                    className="btn btn-primary"
                    onClick={copyToClipboard}
                    style={{ flex: 1, minWidth: 150, justifyContent: 'center' }}
                >
                    {copied ? (
                        <>
                            <Check size={18} />
                            Скопировано!
                        </>
                    ) : (
                        <>
                            <Copy size={18} />
                            Скопировать
                        </>
                    )}
                </button>

                <button
                    className="btn btn-primary"
                    onClick={downloadScript}
                    style={{ flex: 1, minWidth: 150, justifyContent: 'center' }}
                >
                    <Code size={18} />
                    📥 Скачать .js
                </button>

                <button
                    className="btn btn-secondary"
                    onClick={openTLS}
                    style={{ flex: 1, minWidth: 150, justifyContent: 'center' }}
                >
                    <ExternalLink size={18} />
                    Открыть TLS
                </button>

                <button
                    className="btn btn-secondary"
                    onClick={() => setShowScript(!showScript)}
                    style={{ flex: 1, minWidth: 200, justifyContent: 'center' }}
                >
                    <Code size={18} />
                    {showScript ? 'Скрыть код' : 'Показать код'}
                </button>
            </div>

            {/* Предпросмотр скрипта */}
            {showScript && (
                <div style={{ marginTop: 'var(--spacing-xl)' }}>
                    <div className="card">
                        <div className="card-header">
                            <h3 className="card-title">
                                <Code size={20} />
                                Сгенерированный скрипт
                            </h3>
                        </div>
                        <pre style={{
                            background: '#0d1117',
                            color: '#c9d1d9',
                            padding: 'var(--spacing-lg)',
                            borderRadius: 'var(--radius-md)',
                            overflow: 'auto',
                            maxHeight: 400,
                            fontSize: '0.8rem',
                            lineHeight: 1.5
                        }}>
                            {generateScript()}
                        </pre>
                    </div>
                </div>
            )}

            {/* Инструкция */}
            <div className="card" style={{ marginTop: 'var(--spacing-xl)' }}>
                <div className="card-header">
                    <h3 className="card-title">
                        <Play size={20} />
                        Как использовать
                    </h3>
                </div>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <ol style={{ paddingLeft: 'var(--spacing-lg)' }}>
                        <li><strong>Настройте</strong> параметры выше</li>
                        <li><strong>Скопируйте</strong> скрипт кнопкой "Скопировать скрипт"</li>
                        <li><strong>Откройте</strong> страницу TLS Contact</li>
                        <li><strong>Откройте консоль</strong> браузера: <code>Cmd + Option + J</code> (Mac) или <code>F12</code></li>
                        <li><strong>Вставьте</strong> скрипт: <code>Cmd + V</code> и нажмите <code>Enter</code></li>
                        <li><strong>Готово!</strong> Скрипт начнёт мониторинг 🎉</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}

export default ScriptGenerator;
