// Popup script
document.addEventListener('DOMContentLoaded', async () => {
    // === SECTION TOGGLE FUNCTIONALITY ===
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't toggle if clicking on clearHistory button
            if (e.target.id === 'clearHistory') return;
            header.parentElement.classList.toggle('collapsed');
        });
    });

    // Элементы
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const testBtn = document.getElementById('testBtn');
    const openTlsBtn = document.getElementById('openTlsBtn');
    const statusBadge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    const checkCountEl = document.getElementById('checkCount');
    const lastCheckEl = document.getElementById('lastCheck');

    // Слайдеры
    const checkIntervalSlider = document.getElementById('checkInterval');
    const checkIntervalValue = document.getElementById('checkIntervalValue');

    // Переключатели
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    const telegramToggle = document.getElementById('telegramToggle');
    const soundToggle = document.getElementById('soundToggle');
    const browserNotifyToggle = document.getElementById('browserNotifyToggle');
    const telegramSettings = document.getElementById('telegramSettings');

    // Auto-Login elements
    const autoLoginToggle = document.getElementById('autoLoginToggle');
    const autoLoginSettings = document.getElementById('autoLoginSettings');
    const loginUrlInput = document.getElementById('loginUrl');
    const loginEmailInput = document.getElementById('loginEmail');
    const loginPasswordInput = document.getElementById('loginPassword');

    // Поля ввода
    const botTokenInput = document.getElementById('botToken');
    const chatIdsInput = document.getElementById('chatIds');
    const tlsUrlInput = document.getElementById('tlsUrl');
    const noSlotsKeywordsInput = document.getElementById('noSlotsKeywords');

    // Дефолтные значения (токен убран для безопасности)
    const DEFAULT_BOT_TOKEN = '';
    const DEFAULT_CHAT_IDS = '';
    const DEFAULT_TLS_URL = 'https://visas-it.tlscontact.com/hy-am/1909121/workflow/appointment-booking';
    const DEFAULT_KEYWORDS = `we currently don't have any appointment slots available
no slots are currently available
no appointment slots
please check this page regularly`;

    // Загрузка настроек
    const settings = await chrome.storage.local.get([
        'isRunning',
        'checkInterval',
        'refreshInterval',
        'autoRefresh',
        'botToken',
        'chatIds',
        'tlsUrl',
        'noSlotsKeywords',
        'soundEnabled',
        'browserNotify',
        'telegramEnabled',
        'checkCount',
        'lastCheck',
        'autoLogin',
        'loginUrl',
        'loginEmail',
        'loginPassword'
    ]);

    // Применяем сохранённые настройки (минимум 480 сек = 8 мин для безопасности)
    checkIntervalSlider.value = Math.max(480, settings.checkInterval || 480);
    botTokenInput.value = settings.botToken || DEFAULT_BOT_TOKEN;
    chatIdsInput.value = settings.chatIds || DEFAULT_CHAT_IDS;
    tlsUrlInput.value = settings.tlsUrl || DEFAULT_TLS_URL;
    noSlotsKeywordsInput.value = settings.noSlotsKeywords || DEFAULT_KEYWORDS;

    loginUrlInput.value = settings.loginUrl || '';
    loginEmailInput.value = settings.loginEmail || '';
    loginPasswordInput.value = settings.loginPassword || '';

    updateSliderValue(checkIntervalSlider, checkIntervalValue);

    setToggle(autoRefreshToggle, settings.autoRefresh !== false);
    setToggle(telegramToggle, settings.telegramEnabled !== false);
    setToggle(soundToggle, settings.soundEnabled !== false);
    setToggle(browserNotifyToggle, settings.browserNotify !== false);
    setToggle(autoLoginToggle, settings.autoLogin === true);

    telegramSettings.style.display = settings.telegramEnabled !== false ? 'block' : 'none';
    autoLoginSettings.style.display = settings.autoLogin === true ? 'block' : 'none';

    checkCountEl.textContent = settings.checkCount || 0;
    lastCheckEl.textContent = settings.lastCheck || '-';

    updateStatus(settings.isRunning);

    // === ТАЙМЕР ДО СЛЕДУЮЩЕЙ ПРОВЕРКИ ===
    const nextCheckTimeEl = document.getElementById('nextCheckTime');
    const nextCheckLabelEl = document.getElementById('nextCheckLabel');

    async function updateNextCheck() {
        try {
            const alarms = await chrome.alarms.getAll();
            const checkSlotsAlarm = alarms.find(a => a.name === 'checkSlots');
            const keepAliveAlarm = alarms.find(a => a.name === 'keepAlive');

            // Находим ближайший alarm
            let nextAlarm = null;
            let actionName = '';

            if (checkSlotsAlarm && keepAliveAlarm) {
                if (checkSlotsAlarm.scheduledTime < keepAliveAlarm.scheduledTime) {
                    nextAlarm = checkSlotsAlarm;
                    actionName = 'проверка';
                } else {
                    nextAlarm = keepAliveAlarm;
                    actionName = 'keep-alive';
                }
            } else if (checkSlotsAlarm) {
                nextAlarm = checkSlotsAlarm;
                actionName = 'проверка';
            } else if (keepAliveAlarm) {
                nextAlarm = keepAliveAlarm;
                actionName = 'keep-alive';
            }

            if (nextAlarm) {
                const timeLeft = Math.max(0, nextAlarm.scheduledTime - Date.now());
                const seconds = Math.floor(timeLeft / 1000);
                const minutes = Math.floor(seconds / 60);
                const secs = seconds % 60;

                if (minutes > 0) {
                    nextCheckTimeEl.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
                } else {
                    nextCheckTimeEl.textContent = `${secs} сек`;
                }
                nextCheckLabelEl.textContent = actionName;
            } else {
                nextCheckTimeEl.textContent = '-';
                nextCheckLabelEl.textContent = 'не активен';
            }
        } catch (e) {
            nextCheckTimeEl.textContent = '-';
        }
    }

    // Обновляем каждую секунду
    updateNextCheck();
    setInterval(updateNextCheck, 1000);

    // === ИСТОРИЯ ПРОВЕРОК ===
    const historyListEl = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistory');

    async function loadHistory() {
        const { checkHistory } = await chrome.storage.local.get('checkHistory');
        if (!checkHistory || checkHistory.length === 0) {
            historyListEl.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">Пока нет проверок</div>';
            return;
        }

        historyListEl.innerHTML = checkHistory.slice(-15).reverse().map(entry => {
            const icon = entry.status === 'slots' ? '🎉' : entry.status === 'no_slots' ? '❌' : entry.status === 'logout' ? '⚠️' : '🔄';
            const color = entry.status === 'slots' ? '#00ff88' : entry.status === 'no_slots' ? '#888' : entry.status === 'logout' ? '#ff6b6b' : '#ffc107';
            return `<div style="display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span>${icon}</span>
                <span style="color: ${color}; flex: 1;">${entry.message}</span>
                <span style="color: #666; font-size: 10px;">${entry.time}</span>
            </div>`;
        }).join('');
    }

    loadHistory();

    clearHistoryBtn.addEventListener('click', async () => {
        await chrome.storage.local.set({ checkHistory: [] });
        loadHistory();
    });

    // === СТАТИСТИКА ЗА НЕДЕЛЮ ===
    async function loadStats() {
        const { slotStats = {} } = await chrome.storage.local.get('slotStats');

        // Генерируем последние 7 дней
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const key = date.toISOString().split('T')[0];
            days.push({
                key,
                label: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
                data: slotStats[key] || { checks: 0, slots: 0, noSlots: 0, errors: 0 }
            });
        }

        // Считаем тоталы
        let totalChecks = 0, totalSlots = 0;
        days.forEach(d => {
            totalChecks += d.data.checks;
            totalSlots += d.data.slots;
        });

        document.getElementById('totalChecks').textContent = totalChecks;
        document.getElementById('totalSlots').textContent = totalSlots;
        document.getElementById('successRate').textContent = totalChecks > 0 ? Math.round((totalSlots / totalChecks) * 100) + '%' : '0%';

        // Рисуем график
        const chartEl = document.getElementById('weeklyChart');
        const maxChecks = Math.max(...days.map(d => d.data.checks), 1);

        chartEl.innerHTML = days.map(d => {
            const height = Math.max(4, (d.data.checks / maxChecks) * 50);
            const hasSlots = d.data.slots > 0;
            const color = hasSlots ? '#ffd700' : '#00ff88';
            return `<div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
                <div style="width: 100%; height: ${height}px; background: ${color}; border-radius: 3px; opacity: 0.8;" title="${d.data.checks} проверок, ${d.data.slots} слотов"></div>
                <div style="font-size: 9px; color: #666; margin-top: 3px;">${d.label}</div>
            </div>`;
        }).join('');

        document.getElementById('chartDayStart').textContent = days[0].label;
    }

    loadStats();

    // Обновляем историю при изменениях в storage
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.checkHistory) {
            loadHistory();
        }
        if (changes.slotStats) {
            loadStats();
        }
        if (changes.checkCount) {
            checkCountEl.textContent = changes.checkCount.newValue || 0;
        }
        if (changes.lastCheck) {
            lastCheckEl.textContent = changes.lastCheck.newValue || '-';
        }
        if (changes.isRunning) {
            updateStatus(changes.isRunning.newValue);
        }
    });

    // Функции
    function formatTime(seconds) {
        if (seconds >= 3600) {
            return Math.round(seconds / 3600) + ' ч';
        } else if (seconds >= 60) {
            return Math.round(seconds / 60) + ' мин';
        }
        return seconds + ' сек';
    }

    function updateSliderValue(slider, valueEl) {
        valueEl.textContent = formatTime(parseInt(slider.value));
    }

    function setToggle(toggle, active) {
        if (active) {
            toggle.classList.add('active');
        } else {
            toggle.classList.remove('active');
        }
    }

    function isToggleActive(toggle) {
        return toggle.classList.contains('active');
    }

    async function saveSettings() {
        await chrome.storage.local.set({
            checkInterval: parseInt(checkIntervalSlider.value),
            autoRefresh: isToggleActive(autoRefreshToggle),
            botToken: botTokenInput.value,
            chatIds: chatIdsInput.value,
            tlsUrl: tlsUrlInput.value,
            noSlotsKeywords: noSlotsKeywordsInput.value,
            soundEnabled: isToggleActive(soundToggle),
            browserNotify: isToggleActive(browserNotifyToggle),
            telegramEnabled: isToggleActive(telegramToggle),
            autoLogin: isToggleActive(autoLoginToggle),
            loginUrl: loginUrlInput.value,
            loginEmail: loginEmailInput.value,
            loginPassword: loginPasswordInput.value
        });
    }

    function updateStatus(isRunning) {
        if (isRunning) {
            statusBadge.className = 'status-badge active';
            statusText.textContent = 'Активен';
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
        } else {
            statusBadge.className = 'status-badge inactive';
            statusText.textContent = 'Не активен';
            startBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
        }
    }

    // События слайдеров
    checkIntervalSlider.addEventListener('input', () => {
        updateSliderValue(checkIntervalSlider, checkIntervalValue);
    });
    checkIntervalSlider.addEventListener('change', saveSettings);

    // События переключателей
    autoRefreshToggle.addEventListener('click', () => {
        autoRefreshToggle.classList.toggle('active');
        saveSettings();
    });

    autoLoginToggle.addEventListener('click', () => {
        autoLoginToggle.classList.toggle('active');
        autoLoginSettings.style.display = isToggleActive(autoLoginToggle) ? 'block' : 'none';
        saveSettings();
    });

    telegramToggle.addEventListener('click', () => {
        telegramToggle.classList.toggle('active');
        telegramSettings.style.display = isToggleActive(telegramToggle) ? 'block' : 'none';
        saveSettings();
    });

    soundToggle.addEventListener('click', () => {
        soundToggle.classList.toggle('active');
        saveSettings();
    });

    browserNotifyToggle.addEventListener('click', () => {
        browserNotifyToggle.classList.toggle('active');
        saveSettings();
    });

    // События полей ввода (убираем автосохранение)
    // botTokenInput.addEventListener('change', saveSettings);
    // chatIdsInput.addEventListener('change', saveSettings);

    // Кнопка сохранения
    const saveBtn = document.getElementById('saveBtn');
    const saveStatus = document.getElementById('saveStatus');

    saveBtn.addEventListener('click', async () => {
        await saveSettings();
        saveBtn.textContent = '✅ Сохранено!';
        saveStatus.style.display = 'block';
        setTimeout(() => {
            saveBtn.textContent = '💾 Сохранить настройки';
            saveStatus.style.display = 'none';
        }, 2000);
    });

    // Запуск мониторинга
    startBtn.addEventListener('click', async () => {
        await saveSettings();
        await chrome.storage.local.set({ isRunning: true, checkCount: 0 });
        chrome.runtime.sendMessage({ action: 'start' });

        // Получаем домен из URL пользователя
        try {
            const userUrl = new URL(tlsUrlInput.value);
            const urlPattern = `${userUrl.protocol}//${userUrl.hostname}/*`;

            // Сразу показываем индикатор на страницах с этим доменом
            const tabs = await chrome.tabs.query({ url: urlPattern });
            for (const tab of tabs) {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const existing = document.getElementById('tls-ext-indicator');
                        if (existing) return;

                        const div = document.createElement('div');
                        div.id = 'tls-ext-indicator';
                        div.innerHTML = `
                            <div id="tls-panel" style="
                                position: fixed;
                                bottom: 20px;
                                right: 20px;
                                background: rgba(16, 24, 40, 0.95);
                                color: white;
                                padding: 12px 16px;
                                border-radius: 12px;
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                font-size: 13px;
                                z-index: 2147483647;
                                display: flex;
                                align-items: center;
                                gap: 12px;
                                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                                border: 1px solid rgba(255, 255, 255, 0.1);
                                backdrop-filter: blur(8px);
                                transition: all 0.3s ease;
                                cursor: default;
                                user-select: none;
                            ">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 18px;">🇮🇹</span>
                                    <div>
                                        <div style="font-weight: 600; color: #fff;">TLS Monitor</div>
                                        <div style="font-size: 11px; color: #00ff88; display: flex; align-items: center; gap: 4px;">
                                            <span style="width: 6px; height: 6px; background: #00ff88; border-radius: 50%; display: inline-block; animation: tls-pulse 1.5s infinite;"></span>
                                            Активен
                                        </div>
                                    </div>
                                </div>
                                <div style="width: 1px; height: 24px; background: rgba(255,255,255,0.1); margin: 0 4px;"></div>
                                <div style="cursor: pointer; padding: 4px; opacity: 0.6; transition: opacity 0.2s;" 
                                     onmouseover="this.style.opacity=1" 
                                     onmouseout="this.style.opacity=0.6"
                                     onclick="document.getElementById('tls-panel').style.display='none'">
                                    ✕
                                </div>
                            </div>
                            <style>
                                @keyframes tls-pulse {
                                    0% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.4); }
                                    70% { box-shadow: 0 0 0 6px rgba(0, 255, 136, 0); }
                                    100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
                                }
                            </style>
                        `;
                        document.body.appendChild(div);
                        console.log('🚀 Slot Monitor: Запущен');
                    }
                }).catch(() => { });
            }
        } catch (e) {
            console.error('Неверный URL:', e);
        }

        updateStatus(true);
    });

    // Остановка мониторинга
    stopBtn.addEventListener('click', async () => {
        await chrome.storage.local.set({ isRunning: false });
        chrome.runtime.sendMessage({ action: 'stop' });

        // Скрываем индикатор на ВСЕХ вкладках
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            try {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const el = document.getElementById('tls-ext-indicator');
                        if (el) el.remove();
                        console.log('🛑 Slot Monitor: Остановлен');
                    }
                }).catch(() => { });
            } catch (e) { }
        }

        updateStatus(false);
    });

    // Открыть сайт (с пользовательским URL)
    openTlsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: tlsUrlInput.value });
    });

    // Обновить страницу вручную
    const refreshPageBtn = document.getElementById('refreshPageBtn');
    refreshPageBtn.addEventListener('click', async () => {
        const originalHTML = refreshPageBtn.innerHTML;
        try {
            const userUrl = new URL(tlsUrlInput.value);
            const hostname = userUrl.hostname.toLowerCase();
            const tabs = await chrome.tabs.query({});

            for (const tab of tabs) {
                if (tab.url && tab.url.toLowerCase().includes(hostname)) {
                    chrome.tabs.reload(tab.id);
                    refreshPageBtn.innerHTML = '<span class="icon">✅</span>OK';
                    setTimeout(() => {
                        refreshPageBtn.innerHTML = originalHTML;
                    }, 1500);
                    return;
                }
            }
            refreshPageBtn.innerHTML = '<span class="icon">⚠️</span>Нет';
            setTimeout(() => {
                refreshPageBtn.innerHTML = originalHTML;
            }, 1500);
        } catch (e) {
            refreshPageBtn.innerHTML = '<span class="icon">❌</span>Ошибка';
            setTimeout(() => {
                refreshPageBtn.innerHTML = originalHTML;
            }, 1500);
        }
    });

    // Проверить сейчас
    const checkNowBtn = document.getElementById('checkNowBtn');
    checkNowBtn.addEventListener('click', async () => {
        const originalHTML = checkNowBtn.innerHTML;
        checkNowBtn.innerHTML = '<span class="icon">⏳</span>...';
        chrome.runtime.sendMessage({ action: 'checkNow' });
        setTimeout(() => {
            checkNowBtn.innerHTML = originalHTML;
        }, 2000);
    });

    // Сохранение при изменении URL
    tlsUrlInput.addEventListener('change', saveSettings);

    // Тест Telegram
    testBtn.addEventListener('click', async () => {
        await saveSettings();
        testBtn.textContent = '⏳ Отправка...';
        testBtn.disabled = true;

        try {
            const result = await chrome.runtime.sendMessage({
                action: 'testTelegram',
                botToken: botTokenInput.value,
                chatIds: chatIdsInput.value
            });

            if (result && result.success) {
                testBtn.textContent = '✅ Отправлено!';
            } else {
                testBtn.textContent = '❌ Ошибка';
            }
        } catch (e) {
            testBtn.textContent = '❌ Ошибка';
        }

        testBtn.disabled = false;
        setTimeout(() => {
            testBtn.textContent = '📱 Тест Telegram';
        }, 2000);
    });


    // (Дублирующий listener удалён — уже есть на строке 133)

    // === КОПИРОВАНИЕ СКРИПТА ДЛЯ КОНСОЛИ ===
    const copyScriptBtn = document.getElementById('copyScriptBtn');

    function generateConsoleScript() {
        const chatIdsArray = chatIdsInput.value
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0);

        return `// ================================================
// 🇮🇹 TLS SLOT MONITOR - Автоматический мониторинг
// ================================================
// Сгенерировано: ${new Date().toLocaleString('ru-RU')}
// URL: ${tlsUrlInput.value}
// ================================================

(function() {
    'use strict';
    
    const CONFIG = {
        checkIntervalSeconds: ${Math.max(480, checkIntervalSlider.value)},  // Минимум 8 минут
        autoRefresh: ${isToggleActive(autoRefreshToggle)},
        refreshIntervalSeconds: 1000,  // ~17 минут - защита от бана
        soundEnabled: ${isToggleActive(soundToggle)},
        telegramEnabled: ${isToggleActive(telegramToggle)},
        telegramBotToken: '${botTokenInput.value}',
        telegramChatIds: [${chatIdsArray.map(id => `'${id}'`).join(', ')}]
    };
    
    const NO_SLOTS_KEYWORDS = ${JSON.stringify(noSlotsKeywordsInput.value.split('\\n').map(k => k.trim()).filter(k => k))};
    
    let isRunning = true;
    let checkCount = 0;
    let slotsFound = false;
    
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
        
        if (!pageText.includes("don't have any")) {
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
        console.log('🚀 TLS Monitor запущен!');
        console.log('⏱ Интервал: ' + CONFIG.checkIntervalSeconds + 's (±30%)');
        if (Notification.permission === 'default') Notification.requestPermission();
        createUI();
        
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
    }

    copyScriptBtn.addEventListener('click', async () => {
        const script = generateConsoleScript();
        const originalHTML = copyScriptBtn.innerHTML;

        // Пробуем Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(script);
                copyScriptBtn.innerHTML = '<span class="icon">✅</span>OK!';
                setTimeout(() => { copyScriptBtn.innerHTML = originalHTML; }, 2000);
                return;
            } catch (e) {
                console.warn('Clipboard API failed:', e);
            }
        }

        // Резервный метод через textarea
        try {
            const textarea = document.createElement('textarea');
            textarea.value = script;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (success) {
                copyScriptBtn.innerHTML = '<span class="icon">✅</span>OK!';
            } else {
                copyScriptBtn.innerHTML = '<span class="icon">❌</span>Ошибка';
            }
        } catch (e) {
            copyScriptBtn.innerHTML = '<span class="icon">❌</span>Ошибка';
        }

        setTimeout(() => { copyScriptBtn.innerHTML = originalHTML; }, 2000);
    });
});
