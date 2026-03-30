// Popup script
document.addEventListener('DOMContentLoaded', async () => {
    const normalizeTlsUrl = normalizeTlsUrlValue;

    function getTlsStartUrl(rawTlsUrl) {
        try {
            const target = new URL(rawTlsUrl);
            return `${target.origin}/en-us`;
        } catch (error) {
            return '';
        }
    }

    function setSaveStatus(message, isError = false) {
        saveStatus.textContent = message;
        saveStatus.style.display = 'block';
        saveStatus.style.color = isError ? '#ff6b6b' : '#00ff88';
    }

    function clearSaveStatus() {
        saveStatus.style.display = 'none';
        saveStatus.textContent = '✅ Сохранено!';
        saveStatus.style.color = '#00ff88';
    }

    function setValidationMessage(element, message, tone = 'error') {
        element.textContent = message || '';
        element.className = `validation-message${message ? ` ${tone}` : ''}`;
    }

    function setFieldValidation(input, element, message) {
        input.classList.toggle('invalid', Boolean(message));
        setValidationMessage(element, message, 'error');
    }

    function setActionValidation(message) {
        setValidationMessage(actionValidationMessage, message, 'info');
    }

    function clearActionValidation() {
        setValidationMessage(actionValidationMessage, '');
    }

    async function trySaveSettings(showActionMessage = false) {
        if (showActionMessage) {
            validateInputs(true);
        } else {
            updateHealthStatus();
        }

        try {
            await saveSettings();
        } catch (error) {
            setSaveStatus(error.message, true);
        }
    }

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
    const postLoginUrlInput = document.getElementById('postLoginUrl');
    const tlsUrlValidationMessage = document.getElementById('tlsUrlValidationMessage');
    const loginUrlValidationMessage = document.getElementById('loginUrlValidationMessage');
    const healthTlsUrl = document.getElementById('healthTlsUrl');
    const healthAutoLogin = document.getElementById('healthAutoLogin');
    const healthTelegram = document.getElementById('healthTelegram');
    const healthPolling = document.getElementById('healthPolling');
    const actionValidationMessage = document.getElementById('actionValidationMessage');
    const monitorStatePill = document.getElementById('monitorStatePill');
    const monitorStateReason = document.getElementById('monitorStateReason');
    const debugCheckedAt = document.getElementById('debugCheckedAt');
    const debugUrl = document.getElementById('debugUrl');
    const debugState = document.getElementById('debugState');
    const debugReason = document.getElementById('debugReason');
    const debugTextLength = document.getElementById('debugTextLength');
    const debugMatchedKeyword = document.getElementById('debugMatchedKeyword');
    const debugTextSample = document.getElementById('debugTextSample');
    const debugLogCount = document.getElementById('debugLogCount');
    const copyDebugBtn = document.getElementById('copyDebugBtn');
    const exportLogsBtn = document.getElementById('exportLogsBtn');
    let currentMonitorState = TLS_PAGE_STATES.IDLE;
    let currentMonitorReason = 'Нет активной диагностики';
    let currentLastDiagnostic = {};
    let currentDiagnosticLogs = [];

    // Поля ввода
    const botTokenInput = document.getElementById('botToken');
    const chatIdsInput = document.getElementById('chatIds');
    const tlsUrlInput = document.getElementById('tlsUrl');
    const noSlotsKeywordsInput = document.getElementById('noSlotsKeywords');

    function setHealthValue(element, message, tone) {
        element.textContent = message;
        element.className = `health-value${tone ? ` ${tone}` : ''}`;
    }

    function updateHealthStatus() {
        const tlsValidation = normalizeTlsUrl(tlsUrlInput.value);
        const loginValidation = loginUrlInput.value.trim() ? normalizeTlsUrl(loginUrlInput.value.trim()) : { valid: true };
        const autoLoginEnabled = isToggleActive(autoLoginToggle);
        const telegramEnabled = isToggleActive(telegramToggle);
        const intervalSeconds = parseInt(checkIntervalSlider.value, 10) || 0;

        setHealthValue(
            healthTlsUrl,
            tlsValidation.valid ? 'OK' : 'Ошибка URL',
            tlsValidation.valid ? 'ok' : 'error'
        );

        if (!autoLoginEnabled) {
            setHealthValue(healthAutoLogin, 'Выключен', 'warn');
        } else if (!loginEmailInput.value.trim()) {
            setHealthValue(healthAutoLogin, 'Нет email, будет ручной вход', 'warn');
        } else if (!loginPasswordInput.value.trim()) {
            setHealthValue(healthAutoLogin, '⚠️ Пароль не сохранён! Введите пароль', 'error');
        } else if (!loginValidation.valid) {
            setHealthValue(healthAutoLogin, 'Ошибка Login URL', 'error');
        } else {
            setHealthValue(healthAutoLogin, 'Готов', 'ok');
        }

        if (!telegramEnabled) {
            setHealthValue(healthTelegram, 'Выключен', 'warn');
        } else if (!botTokenInput.value.trim()) {
            setHealthValue(healthTelegram, 'Нет токена', 'error');
        } else if (!chatIdsInput.value.trim()) {
            setHealthValue(healthTelegram, 'Нет chat IDs', 'error');
        } else {
            setHealthValue(healthTelegram, 'Настроен', 'ok');
        }

        if (intervalSeconds < 480) {
            setHealthValue(healthPolling, 'Интервал слишком частый', 'error');
        } else if (intervalSeconds < 600) {
            setHealthValue(healthPolling, `TLS ${Math.round(intervalSeconds / 60)} мин • TG 1 мин`, 'warn');
        } else {
            setHealthValue(healthPolling, `TLS ${Math.round(intervalSeconds / 60)} мин • TG 1 мин`, 'ok');
        }
    }

    function renderMonitorState(state, reason) {
        currentMonitorState = state || TLS_PAGE_STATES.IDLE;
        currentMonitorReason = reason || 'Нет активной диагностики';
        const meta = getMonitorStateMeta(currentMonitorState);
        monitorStatePill.textContent = meta.label;
        monitorStatePill.className = `state-pill${meta.tone ? ` ${meta.tone}` : ''}`;
        monitorStateReason.textContent = currentMonitorReason;
    }

    function formatDebugTimestamp(value) {
        if (!value) {
            return '-';
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return String(value);
        }

        return parsed.toLocaleString('ru-RU');
    }

    function renderDebugPanel(diagnostic = {}) {
        currentLastDiagnostic = diagnostic || {};
        debugCheckedAt.textContent = formatDebugTimestamp(diagnostic.checkedAt);
        debugUrl.textContent = diagnostic.url || '-';
        debugState.textContent = diagnostic.state || '-';
        debugReason.textContent = diagnostic.reason || '-';
        debugTextLength.textContent = Number.isFinite(diagnostic.textLength) ? String(diagnostic.textLength) : '-';
        debugMatchedKeyword.textContent = diagnostic.matchedKeyword || '-';
        debugTextSample.textContent = diagnostic.debugText || 'Нет данных';
    }

    function renderDiagnosticLogs(logs = []) {
        currentDiagnosticLogs = Array.isArray(logs) ? logs : [];
        debugLogCount.textContent = `${currentDiagnosticLogs.length} / ${DIAGNOSTIC_LOG_LIMIT}`;
    }

    function buildDebugSnapshot() {
        return {
            monitorState: currentMonitorState,
            monitorReason: currentMonitorReason,
            lastDiagnostic: currentLastDiagnostic,
            diagnosticLogs: currentDiagnosticLogs
        };
    }

    async function copyTextWithFeedback(button, text, successLabel) {
        const originalHTML = button.innerHTML;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                button.innerHTML = successLabel;
                setTimeout(() => {
                    button.innerHTML = originalHTML;
                }, 2000);
                return true;
            } catch (error) {
                console.warn('Clipboard API failed:', error);
            }
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            button.innerHTML = success ? successLabel : '<span class="icon">❌</span>Ошибка';
        } catch (error) {
            button.innerHTML = '<span class="icon">❌</span>Ошибка';
        }

        setTimeout(() => {
            button.innerHTML = originalHTML;
        }, 2000);

        return false;
    }

    // Дефолтные значения (токен убран для безопасности)
    const DEFAULT_BOT_TOKEN = '';
    const DEFAULT_CHAT_IDS = '';
    const DEFAULT_TLS_URL = 'https://visas-it.tlscontact.com/hy-am/1909121/workflow/appointment-booking';
    const DEFAULT_KEYWORDS = `we currently don't have any appointment slots available
no slots are currently available
no appointment slots
please check this page regularly`;

    // Загрузка настроек
    const [settings, sessionSecrets] = await Promise.all([
        chrome.storage.local.get([
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
        'monitorState',
        'monitorReason',
        'lastDiagnostic',
        'diagnosticLogs',
        'autoLogin',
        'loginUrl',
        'loginEmail',
        'loginPassword',
        'postLoginUrl'
        ]),
        chrome.storage.session.get(['loginPassword'])
    ]);

    if (!settings.loginPassword && sessionSecrets.loginPassword) {
        settings.loginPassword = sessionSecrets.loginPassword;
        await chrome.storage.local.set({ loginPassword: sessionSecrets.loginPassword });
    }

    // Применяем сохранённые настройки (минимум 480 сек = 8 мин для безопасности)
    checkIntervalSlider.value = Math.max(480, settings.checkInterval || 480);
    botTokenInput.value = settings.botToken || DEFAULT_BOT_TOKEN;
    chatIdsInput.value = settings.chatIds || DEFAULT_CHAT_IDS;
    tlsUrlInput.value = settings.tlsUrl || DEFAULT_TLS_URL;
    noSlotsKeywordsInput.value = settings.noSlotsKeywords || DEFAULT_KEYWORDS;

    loginUrlInput.value = settings.loginUrl || '';
    loginEmailInput.value = settings.loginEmail || '';
    loginPasswordInput.value = settings.loginPassword || sessionSecrets.loginPassword || '';
    postLoginUrlInput.value = settings.postLoginUrl || '';

    updateSliderValue(checkIntervalSlider, checkIntervalValue);

    setToggle(autoRefreshToggle, settings.autoRefresh !== false);
    setToggle(telegramToggle, settings.telegramEnabled !== false);
    setToggle(soundToggle, settings.soundEnabled !== false);
    setToggle(browserNotifyToggle, settings.browserNotify !== false);
    setToggle(autoLoginToggle, settings.autoLogin === true);

    telegramSettings.style.display = settings.telegramEnabled !== false ? 'block' : 'none';
    autoLoginSettings.style.display = settings.autoLogin === true ? 'block' : 'none';

    // Prominent password warning when autoLogin enabled but password is empty
    if (settings.autoLogin === true && !loginPasswordInput.value.trim()) {
        loginPasswordInput.style.border = '2px solid #e74c3c';
        loginPasswordInput.setAttribute('placeholder', '⚠️ ВВЕДИТЕ ПАРОЛЬ!');
        if (settings.loginEmail) {
            // Email exists but password lost — auto-focus and expand section
            autoLoginSettings.style.display = 'block';
            loginPasswordInput.focus();
        }
    }

    checkCountEl.textContent = settings.checkCount || 0;
    lastCheckEl.textContent = settings.lastCheck || '-';
    renderMonitorState(settings.monitorState, settings.monitorReason);
    renderDebugPanel(settings.lastDiagnostic);
    renderDiagnosticLogs(settings.diagnosticLogs);

    updateStatus(settings.isRunning);
    validateInputs();

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
            historyListEl.replaceChildren();
            const emptyState = document.createElement('div');
            emptyState.style.color = '#666';
            emptyState.style.textAlign = 'center';
            emptyState.style.padding = '10px';
            emptyState.textContent = 'Пока нет проверок';
            historyListEl.appendChild(emptyState);
            return;
        }

        const fragment = document.createDocumentFragment();

        checkHistory.slice(-15).reverse().forEach(entry => {
            const icon = entry.status === 'slots' ? '🎉' : entry.status === 'no_slots' ? '❌' : entry.status === 'logout' ? '⚠️' : '🔄';
            const color = entry.status === 'slots' ? '#00ff88' : entry.status === 'no_slots' ? '#888' : entry.status === 'logout' ? '#ff6b6b' : '#ffc107';

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.padding = '4px 0';
            row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

            const iconEl = document.createElement('span');
            iconEl.textContent = icon;

            const messageEl = document.createElement('span');
            messageEl.style.color = color;
            messageEl.style.flex = '1';
            messageEl.textContent = entry.message || '';

            const timeEl = document.createElement('span');
            timeEl.style.color = '#666';
            timeEl.style.fontSize = '10px';
            timeEl.textContent = entry.time || '';

            row.appendChild(iconEl);
            row.appendChild(messageEl);
            row.appendChild(timeEl);
            fragment.appendChild(row);
        });

        historyListEl.replaceChildren(fragment);
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
        if (changes.monitorState || changes.monitorReason) {
            renderMonitorState(
                changes.monitorState ? changes.monitorState.newValue : currentMonitorState,
                changes.monitorReason ? changes.monitorReason.newValue : currentMonitorReason
            );
        }
        if (changes.lastDiagnostic) {
            renderDebugPanel(changes.lastDiagnostic.newValue);
        }
        if (changes.diagnosticLogs) {
            renderDiagnosticLogs(changes.diagnosticLogs.newValue);
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

    function validateInputs(showActionMessage = false) {
        const tlsValidation = normalizeTlsUrl(tlsUrlInput.value);
        const loginUrlRaw = loginUrlInput.value.trim();
        const loginValidation = loginUrlRaw ? normalizeTlsUrl(loginUrlRaw) : { valid: true };
        const autoLoginEnabled = isToggleActive(autoLoginToggle);
        const hasLoginEmail = Boolean(loginEmailInput.value.trim());
        const hasLoginPassword = Boolean(loginPasswordInput.value.trim());

        setFieldValidation(
            tlsUrlInput,
            tlsUrlValidationMessage,
            tlsValidation.valid ? '' : `Неверный URL страницы записи: ${tlsValidation.reason}`
        );

        setFieldValidation(
            loginUrlInput,
            loginUrlValidationMessage,
            loginValidation.valid ? '' : `Неверный Login URL: ${loginValidation.reason}`
        );

        const isTlsBlocked = !tlsValidation.valid;
        const isLoginBlocked = autoLoginEnabled && !loginValidation.valid;
        const hasAutoLoginGap = autoLoginEnabled && (!hasLoginEmail || !hasLoginPassword);
        const isBlocked = isTlsBlocked || isLoginBlocked;

        startBtn.disabled = isBlocked;
        openTlsBtn.disabled = isTlsBlocked;

        if (showActionMessage) {
            if (isTlsBlocked) {
                setActionValidation('Старт заблокирован: исправьте URL страницы записи. Разрешены только HTTPS ссылки на tlscontact.com.');
            } else if (isLoginBlocked) {
                setActionValidation('Старт заблокирован: исправьте Login URL в разделе авто-вход или выключите авто-вход.');
            } else if (hasAutoLoginGap) {
                setActionValidation('Авто-вход недоступен: нет email или пароля в сессии. Старт разрешён, но логин придётся пройти вручную.');
            } else {
                clearActionValidation();
            }
        } else if (!isBlocked) {
            clearActionValidation();
        }

        return !isBlocked;
    }

    async function saveSettings() {
        const tlsUrl = normalizeTlsUrl(tlsUrlInput.value);
        if (!tlsUrl.valid) {
            throw new Error(`URL страницы записи: ${tlsUrl.reason}`);
        }

        const loginUrlValue = loginUrlInput.value.trim();
        let normalizedLoginUrl = '';

        if (loginUrlValue) {
            const loginUrl = normalizeTlsUrl(loginUrlValue);
            if (!loginUrl.valid) {
                throw new Error(`Login URL: ${loginUrl.reason}`);
            }
            normalizedLoginUrl = loginUrl.value;
        }

        await chrome.storage.local.set({
            checkInterval: parseInt(checkIntervalSlider.value),
            autoRefresh: isToggleActive(autoRefreshToggle),
            botToken: botTokenInput.value,
            chatIds: chatIdsInput.value,
            tlsUrl: tlsUrl.value,
            noSlotsKeywords: noSlotsKeywordsInput.value,
            soundEnabled: isToggleActive(soundToggle),
            browserNotify: isToggleActive(browserNotifyToggle),
            telegramEnabled: isToggleActive(telegramToggle),
            autoLogin: isToggleActive(autoLoginToggle),
            loginUrl: normalizedLoginUrl,
            loginEmail: loginEmailInput.value,
            loginPassword: loginPasswordInput.value,
            postLoginUrl: postLoginUrlInput.value.trim()
        });

        await chrome.storage.session.set({
            loginPassword: loginPasswordInput.value
        });

        tlsUrlInput.value = tlsUrl.value;
        loginUrlInput.value = normalizedLoginUrl;
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
        updateHealthStatus();
    });
    checkIntervalSlider.addEventListener('change', () => trySaveSettings());

    // События переключателей
    autoRefreshToggle.addEventListener('click', () => {
        autoRefreshToggle.classList.toggle('active');
        trySaveSettings();
    });

    autoLoginToggle.addEventListener('click', () => {
        autoLoginToggle.classList.toggle('active');
        autoLoginSettings.style.display = isToggleActive(autoLoginToggle) ? 'block' : 'none';
        validateInputs(true);
        trySaveSettings(true);
    });

    telegramToggle.addEventListener('click', () => {
        telegramToggle.classList.toggle('active');
        telegramSettings.style.display = isToggleActive(telegramToggle) ? 'block' : 'none';
        updateHealthStatus();
        trySaveSettings();
    });

    soundToggle.addEventListener('click', () => {
        soundToggle.classList.toggle('active');
        trySaveSettings();
    });

    browserNotifyToggle.addEventListener('click', () => {
        browserNotifyToggle.classList.toggle('active');
        trySaveSettings();
    });

    // События полей ввода (убираем автосохранение)
    // botTokenInput.addEventListener('change', saveSettings);
    // chatIdsInput.addEventListener('change', saveSettings);
    botTokenInput.addEventListener('input', updateHealthStatus);
    loginEmailInput.addEventListener('input', () => {
        updateHealthStatus();
        validateInputs(true);
    });
    loginPasswordInput.addEventListener('input', () => {
        loginPasswordInput.style.border = '';
        loginPasswordInput.setAttribute('placeholder', '••••••••');
        updateHealthStatus();
        validateInputs(true);
    });
    chatIdsInput.addEventListener('input', updateHealthStatus);

    // Кнопка сохранения
    const saveBtn = document.getElementById('saveBtn');
    const saveStatus = document.getElementById('saveStatus');

    saveBtn.addEventListener('click', async () => {
        try {
            await saveSettings();
            validateInputs();
            saveBtn.textContent = '✅ Сохранено!';
            setSaveStatus('✅ Сохранено!');
            setTimeout(() => {
                saveBtn.textContent = '💾 Сохранить настройки';
                clearSaveStatus();
            }, 2000);
        } catch (error) {
            saveBtn.textContent = '❌ Ошибка';
            setSaveStatus(error.message, true);
            setTimeout(() => {
                saveBtn.textContent = '💾 Сохранить настройки';
            }, 2000);
        }
    });

    // Запуск мониторинга
    startBtn.addEventListener('click', async () => {
        if (!validateInputs(true)) {
            return;
        }

        try {
            await saveSettings();
        } catch (error) {
            validateInputs(true);
            setSaveStatus(error.message, true);
            return;
        }

        clearActionValidation();

        await chrome.storage.local.set({ isRunning: true, checkCount: 0 });
        chrome.runtime.sendMessage({ action: 'start' });

        // Получаем домен из URL пользователя
        try {
            const userUrl = new URL(tlsUrlInput.value);
            const urlPattern = `${userUrl.protocol}//${userUrl.hostname}/*`;

            // Сразу показываем индикатор на страницах с этим доменом
            const tabs = await chrome.tabs.query({ url: urlPattern });
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, { action: 'showIndicator' }).catch(() => { });
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
                chrome.tabs.sendMessage(tab.id, { action: 'hideIndicator' }).catch(() => { });
            } catch (e) { }
        }

        updateStatus(false);
    });

    // Открыть сайт (с пользовательским URL)
    openTlsBtn.addEventListener('click', () => {
        if (!validateInputs(true)) {
            return;
        }

        const tlsUrl = normalizeTlsUrl(tlsUrlInput.value);
        if (!tlsUrl.valid) {
            setSaveStatus(`Открытие отменено: ${tlsUrl.reason}`, true);
            return;
        }

        chrome.tabs.create({ url: getTlsStartUrl(tlsUrl.value) || tlsUrl.value });
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
    tlsUrlInput.addEventListener('input', () => validateInputs(true));
    tlsUrlInput.addEventListener('change', async () => {
        validateInputs(true);
        try {
            await saveSettings();
        } catch (error) {
            setSaveStatus(error.message, true);
        }
    });

    loginUrlInput.addEventListener('input', () => validateInputs(true));
    loginUrlInput.addEventListener('change', async () => {
        validateInputs(true);
        try {
            await saveSettings();
        } catch (error) {
            setSaveStatus(error.message, true);
        }
    });

    loginEmailInput.addEventListener('change', async () => {
        validateInputs(true);
        try {
            await saveSettings();
        } catch (error) {
            setSaveStatus(error.message, true);
        }
    });

    loginPasswordInput.addEventListener('change', async () => {
        validateInputs(true);
        try {
            await saveSettings();
        } catch (error) {
            setSaveStatus(error.message, true);
        }
    });

    // Тест Telegram
    testBtn.addEventListener('click', async () => {
        try {
            await saveSettings();
        } catch (error) {
            validateInputs(true);
            setSaveStatus(error.message, true);
            return;
        }

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
    // Telegram токен намеренно не экспортируется из расширения
// ================================================

(function() {
    'use strict';
    
    const CONFIG = {
        checkIntervalSeconds: ${Math.max(480, checkIntervalSlider.value)},  // Минимум 8 минут
        autoRefresh: ${isToggleActive(autoRefreshToggle)},
        refreshIntervalSeconds: 1000,  // ~17 минут - защита от бана
        soundEnabled: ${isToggleActive(soundToggle)},
        telegramEnabled: ${isToggleActive(telegramToggle)},
        telegramBotToken: '',
        telegramChatIds: []
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
            pageText.includes('too many requests') || pageText.includes('captcha') ||
            pageText.includes('sorry, you have been blocked') || pageText.includes('you have been blocked') ||
            pageText.includes('unable to access')) {
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
        await copyTextWithFeedback(copyScriptBtn, script, '<span class="icon">✅</span>OK!');
    });

    copyDebugBtn.addEventListener('click', async () => {
        const debugPayload = buildDiagnosticExport(buildDebugSnapshot());
        await copyTextWithFeedback(copyDebugBtn, debugPayload, '✅ Скопировано');
    });

    exportLogsBtn.addEventListener('click', async () => {
        const exportPayload = buildDiagnosticExport(buildDebugSnapshot());
        const blob = new Blob([exportPayload], { type: 'application/json' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `tls-monitor-debug-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);

        const originalHTML = exportLogsBtn.innerHTML;
        exportLogsBtn.innerHTML = '✅ Exported';
        setTimeout(() => {
            exportLogsBtn.innerHTML = originalHTML;
        }, 2000);
    });
});
