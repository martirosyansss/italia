import './state-machine.js';
import './diagnostic-logger.js';

const {
    TLS_PAGE_STATES,
    normalizeTlsUrlValue,
    analyzeTlsPageState,
    canTransitionMonitorState,
    isTlsLandingPath
} = self;

const {
    appendDiagnosticLog
} = self;

const NAVIGATION_LOOP_WINDOW_MS = 3 * 60 * 1000;
const NAVIGATION_LOOP_THRESHOLD = 4;

function getUrlHostname(rawUrl) {
    try {
        return new URL(rawUrl).hostname.toLowerCase();
    } catch (error) {
        return '';
    }
}

function isTlsSubdomainHost(hostname) {
    return hostname === 'tlscontact.com' || hostname.endsWith('.tlscontact.com');
}

function isScriptableTlsUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'tlscontact.com'))
            && isTlsSubdomainHost(parsed.hostname.toLowerCase());
    } catch (error) {
        return false;
    }
}

function scoreTlsCandidate(tabUrl, tlsUrl, loginUrl) {
    if (!tabUrl || !isScriptableTlsUrl(tabUrl)) {
        return -1;
    }

    const tab = new URL(tabUrl);
    const target = tlsUrl ? new URL(tlsUrl) : null;
    const login = loginUrl ? new URL(loginUrl) : null;
    let score = 0;

    if (target && tab.href === target.href) score += 100;
    if (target && tab.hostname === target.hostname) score += 40;
    if (target && tab.pathname === target.pathname) score += 25;
    if (target && tab.pathname.includes('appointment-booking')) score += 30;
    if (target && tab.pathname.includes('workflow')) score += 15;
    if (login && tab.hostname === login.hostname) score += 10;
    if (tab.hostname.startsWith('auth.')) score += 5;
    if (tab.hostname === 'tlscontact.com') score -= 50;
    if (tab.protocol === 'http:') score -= 20;

    return score;
}

function urlsMatchIgnoringHash(leftUrl, rightUrl) {
    try {
        const left = new URL(leftUrl);
        const right = new URL(rightUrl);
        left.hash = '';
        right.hash = '';
        return left.href === right.href;
    } catch (error) {
        return false;
    }
}

function getTlsStartUrl(tlsUrl) {
    try {
        const target = new URL(tlsUrl);
        return `${target.origin}/en-us`;
    } catch (error) {
        return '';
    }
}

function shouldForceReturnToTlsUrl(currentUrl, tlsUrl, startUrl = '') {
    if (!currentUrl || !tlsUrl || urlsMatchIgnoringHash(currentUrl, tlsUrl)) {
        return false;
    }

    if (startUrl && urlsMatchIgnoringHash(currentUrl, startUrl)) {
        return false;
    }

    try {
        const current = new URL(currentUrl);
        const target = new URL(tlsUrl);
        const pathname = current.pathname.toLowerCase();
        const sameTlsHost = current.hostname.toLowerCase() === target.hostname.toLowerCase();
        const isLanding = isTlsLandingPath(pathname);
        const isAppointmentLike = pathname.includes('appointment') || pathname.includes('booking') || pathname.includes('schedule');
        const isAuthLike = current.hostname.startsWith('auth.') || pathname.includes('auth') || pathname.includes('login');
        const isTravelGroups = pathname.includes('travel-groups');
        // Language-only pages (/xx-xx/) should not redirect to booking — user needs auth first
        const isLanguageOnly = /^\/[a-z]{2}-[a-z]{2}\/?$/.test(pathname);

        return sameTlsHost && isLanding && !isAppointmentLike && !isAuthLike && !isTravelGroups && !isLanguageOnly;
    } catch (error) {
        return false;
    }
}

async function ensureMonitoringTab(tlsUrl, loginUrl = '') {
    const allTabs = await chrome.tabs.query({});
    const bestExistingTlsTab = allTabs
        .filter((tab) => Boolean(tab.url))
        .map((tab) => ({ tab, score: scoreTlsCandidate(tab.url, tlsUrl, loginUrl) }))
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score)[0]?.tab || null;

    if (!bestExistingTlsTab) {
        console.log('🌐 Открываем страницу TLS:', tlsUrl);
        const createdTab = await chrome.tabs.create({ url: tlsUrl, active: true });
        await new Promise(r => setTimeout(r, 3000));
        return createdTab;
    }

    const currentUrl = bestExistingTlsTab.url || '';
    if (currentUrl !== tlsUrl) {
        console.log('↪️ Переводим существующую вкладку на страницу записи:', tlsUrl);
        await chrome.tabs.update(bestExistingTlsTab.id, { url: tlsUrl, active: true });
        await new Promise(r => setTimeout(r, 3000));
        return await safeGetTab(bestExistingTlsTab.id);
    }

    await chrome.tabs.update(bestExistingTlsTab.id, { active: true });
    console.log('✅ Активируем вкладку страницы записи:', bestExistingTlsTab.id, currentUrl);
    return bestExistingTlsTab;
}

async function clearNavigationLoopGuard() {
    await chrome.storage.local.remove('navigationLoopGuard');
}

async function clearManualAuthState() {
    await chrome.storage.local.remove(['authManualPending', 'authTabId']);
}

async function setManualAuthState(tabId) {
    await chrome.storage.local.set({
        authManualPending: true,
        authTabId: tabId || null
    });
}

async function registerNavigationLoopGuard(stage, currentUrl, tabId, recursionDepth) {
    const normalizedUrl = currentUrl || '';
    const normalizedStage = stage || 'unknown';
    const now = Date.now();
    const { navigationLoopGuard = null } = await chrome.storage.local.get('navigationLoopGuard');

    // Match on stage + tabId (not exact URL) to catch loops with minor URL variations
    const sameLoop = navigationLoopGuard &&
        navigationLoopGuard.stage === normalizedStage &&
        navigationLoopGuard.tabId === (tabId || null) &&
        (now - navigationLoopGuard.updatedAt) < NAVIGATION_LOOP_WINDOW_MS;

    const nextGuard = {
        stage: normalizedStage,
        url: normalizedUrl,
        tabId: tabId || null,
        recursionDepth,
        count: sameLoop ? (navigationLoopGuard.count || 0) + 1 : 1,
        updatedAt: now,
        firstSeenAt: sameLoop ? navigationLoopGuard.firstSeenAt : now
    };

    await chrome.storage.local.set({ navigationLoopGuard: nextGuard });
    await appendDiagnosticLog('navigation_loop_guard', nextGuard);
    return nextGuard;
}

// Background Service Worker v5.0
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 5 * 60 * 1000;
const TELEGRAM_POLL_INTERVAL_MINUTES = 1;
const TELEGRAM_LONG_POLL_TIMEOUT_SEC = 20;
let startMonitoringPromise = null;

async function getAutoLoginCredentials() {
    const [persistentSettings, sessionSecrets] = await Promise.all([
        chrome.storage.local.get(['autoLogin', 'loginEmail', 'loginPassword']),
        chrome.storage.session.get(['loginPassword'])
    ]);

    const persistedPassword = String(persistentSettings.loginPassword || '').trim();
    const sessionPassword = sessionSecrets.loginPassword || '';
    const loginPassword = persistedPassword || String(sessionPassword || '').trim();
    const loginEmail = String(persistentSettings.loginEmail || '').trim();

    if (!persistedPassword && sessionPassword) {
        await chrome.storage.local.set({ loginPassword: sessionPassword });
    }

    return {
        autoLogin: persistentSettings.autoLogin === true,
        loginEmail,
        loginPassword
    };
}

// === ANTI-RATE-LIMITING (хранится в storage для сохранения при сне worker) ===
const MIN_INTERVAL_SEC = 300; // Minimum 5 minutes between checks (безопасный интервал)

// Добавляет случайную задержку 0-30 секунд к интервалу
function getRandomJitter() {
    return Math.floor(Math.random() * 30);
}

// Проверяет, не заблокированы ли мы (асинхронная версия!)
async function isRateLimited() {
    const { rateLimitBackoff = 0, lastRateLimitTime = 0 } = await chrome.storage.local.get(['rateLimitBackoff', 'lastRateLimitTime']);

    if (rateLimitBackoff > 0) {
        const backoffTime = Math.min(rateLimitBackoff * 60 * 1000, 30 * 60 * 1000); // Max 30 min
        const timeSinceLimit = Date.now() - lastRateLimitTime;
        if (timeSinceLimit < backoffTime) {
            console.log(`⏳ Rate limit backoff: ждём ещё ${Math.round((backoffTime - timeSinceLimit) / 1000)} сек (backoff: ${rateLimitBackoff} мин)`);
            return true;
        }
        // Сброс backoff после истечения времени
        await chrome.storage.local.set({ rateLimitBackoff: 0 });
        console.log('✅ Backoff истёк, сброшен');
    }
    return false;
}

// Обработка rate limit (асинхронная!)
async function handleRateLimit() {
    const { rateLimitBackoff = 0 } = await chrome.storage.local.get('rateLimitBackoff');
    const newBackoff = rateLimitBackoff === 0 ? 5 : rateLimitBackoff * 2; // Начинаем с 5 мин
    await chrome.storage.local.set({
        rateLimitBackoff: Math.min(newBackoff, 30), // Max 30 min
        lastRateLimitTime: Date.now()
    });
    console.log(`🚫 Rate limit! Backoff: ${rateLimitBackoff} → ${newBackoff} мин`);
}

// 🛡️ SAFE TABS & SCRIPTING HELPERS
async function safeGetTab(tabId) {
    try {
        return await chrome.tabs.get(tabId);
    } catch (e) {
        return null;
    }
}

async function safeExecuteScript(scriptInjection) {
    try {
        const tabId = scriptInjection?.target?.tabId;
        if (tabId) {
            const tab = await safeGetTab(tabId);
            if (!tab) return null;
        }
        return await chrome.scripting.executeScript(scriptInjection);
    } catch (e) {
        const msg = e.message || '';
        if (msg.includes('Frame with ID 0') ||
            msg.includes('No tab with id') ||
            msg.includes('The tab was closed') ||
            msg.includes('Receiving end does not exist')) {
            console.warn(`⚠️ SafeExec suppressed error: ${msg}`);
            return null;
        }
        throw e;
    }
}

// 📨 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ОТПРАВКИ В TELEGRAM
async function sendTelegramMessage(text) {
    try {
        const { botToken, chatIds } = await chrome.storage.local.get(['botToken', 'chatIds']);

        if (!botToken || !chatIds) {
            console.log('🔕 Telegram не настроен, сообщение пропущено');
            return;
        }

        const ids = chatIds.split(',').map(id => id.trim()).filter(id => id);

        console.log(`📤 Отправка в Telegram (${ids.length} чатов):`, text.split('\n')[0]);

        const promises = ids.map(chatId =>
            fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: text,
                    parse_mode: 'HTML'
                })
            }).catch(err => console.error(`❌ Ошибка Telegram [${chatId}]:`, err))
        );

        await Promise.all(promises);
    } catch (e) {
        console.error('❌ Общая ошибка отправки Telegram:', e);
    }
}

// Слушаем сообщения от popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start') {
        startMonitoring();
        sendResponse({ success: true });
    } else if (message.action === 'stop') {
        stopMonitoring();
        sendResponse({ success: true });
    } else if (message.action === 'checkNow') {
        // Мгновенная проверка
        checkForSlots();
        sendResponse({ success: true });
    } else if (message.action === 'testTelegram') {
        testTelegram(message.botToken, message.chatIds).then(result => {
            sendResponse(result);
        });
        return true;
    } else if (message.action === 'slotsFound') {
        handleSlotsFound();
    }
});

// Запуск при старте браузера
chrome.runtime.onStartup.addListener(async () => {
    const { isRunning, botToken } = await chrome.storage.local.get(['isRunning', 'botToken']);
    if (botToken) {
        startTelegramPolling();
    }
    if (isRunning) {
        startMonitoring();
    }
});

// Запуск при установке
chrome.runtime.onInstalled.addListener(async () => {
    console.log('🔍 Slot Monitor v5.0 установлен');
    // Запуск Telegram polling
    startTelegramPolling();
});

// Telegram Polling для ответа на команды (через chrome.alarms - надёжнее чем setInterval!)
let telegramOffset = 0;

async function startTelegramPolling() {
    const { botToken, telegramOffset: storedOffset = 0 } = await chrome.storage.local.get(['botToken', 'telegramOffset']);
    if (!botToken) {
        console.log('🤖 Telegram: токен не указан');
        return;
    }

    telegramOffset = storedOffset;

    console.log('🤖 Telegram Polling запущен (через chrome.alarms)');

    // 📋 Регистрируем команды в меню Telegram
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commands: [
                    { command: 'on', description: '🚀 Запустить мониторинг' },
                    { command: 'off', description: '🛑 Остановить мониторинг' },
                    { command: 'status', description: '📊 Статус бота' },
                    { command: 'ping', description: '🏓 Проверка связи' },
                    { command: 'myid', description: '🆔 Ваш Chat ID' },
                    { command: 'help', description: '📖 Справка' }
                ]
            })
        });
        console.log('📋 Команды зарегистрированы в меню Telegram');
    } catch (e) {
        console.error('❌ Ошибка регистрации команд:', e);
    }

    // Останавливаем старый alarm если есть
    await chrome.alarms.clear('telegramPolling');

    // Создаём alarm для polling раз в минуту. Дальше getUpdates использует long-poll.
    await chrome.alarms.create('telegramPolling', {
        delayInMinutes: TELEGRAM_POLL_INTERVAL_MINUTES,
        periodInMinutes: TELEGRAM_POLL_INTERVAL_MINUTES
    });

    pollTelegram(); // Первый запрос сразу
}

async function pollTelegram() {
    try {
        const { botToken } = await chrome.storage.local.get('botToken');
        if (!botToken) return;

        const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${telegramOffset}&timeout=${TELEGRAM_LONG_POLL_TIMEOUT_SEC}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                telegramOffset = update.update_id + 1;
                await handleTelegramMessage(update, botToken);
            }

            await chrome.storage.local.set({ telegramOffset });
        }
    } catch (e) {
        console.warn('⚠️ Telegram polling error:', e.message || e);
    }
}

// --- ОБРАБОТЧИК КОМАНД TELEGRAM (с удалённым управлением) ---
async function handleTelegramMessage(update, botToken) {
    // 1. Проверки на валидность сообщения
    if (!update.message || !update.message.text) return;

    const chatId = String(update.message.chat.id);
    const text = update.message.text.trim().toLowerCase();
    const firstName = update.message.from?.first_name || 'Boss';

    // 2. БЕЗОПАСНОСТЬ: Проверяем, что команду пишет ВЛАДЕЛЕЦ, а не чужак
    const { chatIds } = await chrome.storage.local.get('chatIds');
    const allowedIds = (chatIds || '').split(',').map(id => id.trim());

    if (!allowedIds.includes(chatId)) {
        console.warn(`⚠️ Игнорирую команду от чужого ID: ${chatId}`);
        // Можно не отвечать, чтобы не палить бота
        return;
    }

    let reply = null;

    // 3. ЛОГИКА КОМАНД
    switch (text) {
        case '/start':
            reply = `👋 <b>Привет, ${firstName}!</b>\n\nЯ TLS Monitor v5.0.\n\n⚙️ <b>Управление:</b>\n/on — Запустить мониторинг 🚀\n/off — Остановить мониторинг 🛑\n/status — Текущее состояние 📊\n/ping — Проверка связи 🏓\n/myid — Ваш Chat ID`;
            break;

        case '/on':
        case '/run':
        case '/start_monitor':
            const { isRunning: alreadyRunning } = await chrome.storage.local.get('isRunning');
            if (alreadyRunning) {
                reply = '⚠️ <b>Уже работаю!</b>\nМониторинг и так активен.';
            } else {
                await startMonitoring();
                reply = '🚀 <b>Мониторинг ЗАПУЩЕН!</b>\n\nИщу слоты...';
            }
            break;

        case '/off':
        case '/stop':
        case '/stop_monitor':
            stopMonitoring();
            reply = '🛑 <b>Мониторинг ОСТАНОВЛЕН.</b>\n\nЯ на паузе. Жду команду /on';
            break;

        case '/status':
            const { isRunning, checkCount, lastCheck, rateLimitBackoff } = await chrome.storage.local.get(['isRunning', 'checkCount', 'lastCheck', 'rateLimitBackoff']);
            reply = `📊 <b>СТАТУС БОТА</b>\n\n` +
                `Состояние: ${isRunning ? '✅ <b>АКТИВЕН</b>' : '🔴 <b>НА ПАУЗЕ</b>'}\n` +
                `Проверок: ${checkCount || 0}\n` +
                `Последняя: ${lastCheck || 'нет данных'}\n` +
                `Rate limit: ${rateLimitBackoff ? rateLimitBackoff + ' мин' : '✅ OK'}`;
            break;

        case '/ping':
            reply = '🏓 <b>Pong!</b>\nЯ в сети и слушаю команды.';
            break;

        case '/myid':
            reply = `🆔 Ваш ID: <code>${chatId}</code>`;
            break;

        case '/help':
            reply = `📖 <b>Справка TLS Monitor v5.0</b>\n\n` +
                `/on — Запустить мониторинг\n` +
                `/off — Остановить мониторинг\n` +
                `/status — Статус бота\n` +
                `/ping — Проверка связи\n` +
                `/myid — Ваш Chat ID\n\n` +
                `При нахождении слота придёт уведомление! 🎉`;
            break;

        default:
            // Не отвечаем на неизвестные сообщения
            break;
    }

    // 4. Отправка ответа
    if (reply) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: reply,
                parse_mode: 'HTML'
            })
        }).catch(e => console.error('Ошибка ответа TG:', e));
        console.log('🤖 Ответ на команду:', text);
    }
}

async function startMonitoring() {
    if (startMonitoringPromise) {
        await appendDiagnosticLog('monitor_start_skipped', { reason: 'start_already_in_progress' });
        return startMonitoringPromise;
    }

    startMonitoringPromise = (async () => {
    const settings = await chrome.storage.local.get(['checkInterval', 'tlsUrl', 'loginUrl']);
    if (!normalizeTlsUrlValue(settings.tlsUrl).valid) {
        console.error('❌ Невалидный tlsUrl. Мониторинг не запущен.');
        await appendDiagnosticLog('monitor_start_rejected', { reason: 'invalid_tls_url', tlsUrl: settings.tlsUrl || '' });
        await setMonitorState(TLS_PAGE_STATES.ERROR, 'Невалидный TLS URL при запуске');
        await chrome.storage.local.set({ isRunning: false });
        return;
    }

    const [isRunningState, checkSlotsAlarm, keepAliveAlarm] = await Promise.all([
        chrome.storage.local.get('isRunning'),
        chrome.alarms.get('checkSlots'),
        chrome.alarms.get('keepAlive')
    ]);

    if (isRunningState.isRunning && checkSlotsAlarm && keepAliveAlarm) {
        await appendDiagnosticLog('monitor_start_skipped', {
            reason: 'already_running',
            tlsUrl: settings.tlsUrl || ''
        });
        return;
    }

    // Enforce minimum interval и добавляем jitter
    const baseInterval = Math.max(settings.checkInterval || 120, MIN_INTERVAL_SEC);
    const jitter = getRandomJitter();
    const totalIntervalSec = baseInterval + jitter;
    const intervalMinutes = totalIntervalSec / 60;

    console.log('🚀 Slot Monitor: Запуск мониторинга');
    console.log(`⏱️ Интервал: ${baseInterval} сек + ${jitter} сек jitter = ${totalIntervalSec} сек`);
    await appendDiagnosticLog('monitor_starting', {
        tlsUrl: settings.tlsUrl,
        baseInterval,
        jitter,
        totalIntervalSec
    });

    lastNotificationTime = 0;
    await chrome.storage.local.set({ rateLimitBackoff: 0 }); // Reset backoff on manual start
    await clearNavigationLoopGuard();
    await clearManualAuthState();
    await chrome.alarms.clear('checkSlots');
    await chrome.alarms.clear('keepAlive');

    const startUrl = getTlsStartUrl(settings.tlsUrl);
    await ensureMonitoringTab(startUrl || settings.tlsUrl, settings.loginUrl);

    // Запуск Telegram polling
    startTelegramPolling();

    // Проверка слотов с jitter
    chrome.alarms.create('checkSlots', {
        delayInMinutes: 0.5 + (Math.random() * 0.5), // Random delay 30-60 sec before first check
        periodInMinutes: intervalMinutes
    });

    // Keep-Alive - каждые 2-3 минуты (с jitter)
    chrome.alarms.create('keepAlive', {
        delayInMinutes: 2,
        periodInMinutes: 2 + Math.random() // 2-3 мин
    });

    await chrome.storage.local.set({ isRunning: true });
    await setMonitorState(TLS_PAGE_STATES.RUNNING, 'Мониторинг запущен');
    })();

    try {
        return await startMonitoringPromise;
    } finally {
        startMonitoringPromise = null;
    }
}

async function stopMonitoring() {
    console.log('🛑 Slot Monitor: Остановка');
    await chrome.alarms.clear('checkSlots');
    await chrome.alarms.clear('keepAlive');
    // ⚠️ НЕ останавливаем telegramPolling, чтобы можно было удалённо запустить через /on
    // chrome.alarms.clear('telegramPolling');
    console.log('🤖 Мониторинг остановлен (Telegram polling активен)');

    await chrome.storage.local.set({ isRunning: false });
    await clearNavigationLoopGuard();
    await clearManualAuthState();
    await appendDiagnosticLog('monitor_stopped', { reason: 'manual_or_remote_stop' });
    await setMonitorState(TLS_PAGE_STATES.STOPPED, 'Мониторинг остановлен');
}

// Обработчик alarm (включая Telegram polling)
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkSlots') {
        await checkForSlots();
    } else if (alarm.name === 'keepAlive') {
        await keepSessionAlive();
    } else if (alarm.name === 'telegramPolling') {
        await pollTelegram();
    }
});

// Keep-Alive: имитация активности человека на странице (БЕЗОПАСНАЯ ВЕРСИЯ)
async function keepSessionAlive() {
    const { isRunning, tlsUrl, authManualPending } = await chrome.storage.local.get(['isRunning', 'tlsUrl', 'authManualPending']);
    if (!isRunning || !tlsUrl) return;

    if (authManualPending) {
        console.log('⏸️ Keep-alive пропущен: ожидается ручной логин');
        return;
    }

    // 🛡️ Не отправляем keep-alive при rate limit
    if (await isRateLimited()) {
        console.log('⏳ Keep-alive пропущен из-за rate limit');
        return;
    }

    try {
        const userUrl = new URL(tlsUrl);
        const hostname = userUrl.hostname.toLowerCase();
        const tabs = await chrome.tabs.query({});

        for (const tab of tabs) {
            if (tab.url && tab.url.toLowerCase().includes(hostname)) {
                // Инжектируем БЕЗОПАСНЫЙ скрипт имитации активности
                await safeExecuteScript({
                    target: { tabId: tab.id },
                    func: async () => {
                        console.log('💓 Pulse: Поддержание сессии...');

                        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                        // 1. МИКРО-ДВИЖЕНИЯ (Jitter) - НЕ телепортация!
                        // Мышь чуть-чуть "дрожит" в центре экрана
                        const currentX = window.innerWidth / 2;
                        const currentY = window.innerHeight / 2;

                        // Делаем 3 маленьких движения
                        for (let i = 0; i < 3; i++) {
                            const jitterX = currentX + (Math.random() * 20 - 10); // Сдвиг +/- 10px
                            const jitterY = currentY + (Math.random() * 20 - 10);

                            document.dispatchEvent(new MouseEvent('mousemove', {
                                view: window,
                                bubbles: true,
                                cancelable: true,
                                clientX: jitterX,
                                clientY: jitterY
                            }));

                            // Крошечная пауза между сдвигами
                            await sleep(50 + Math.random() * 100);
                        }

                        // 2. ПРОКРУТКА "ТУДА-СЮДА" (возвращаем обратно!)
                        const scrollStep = 50 + Math.random() * 100;
                        window.scrollBy({ top: scrollStep, behavior: 'smooth' });

                        await sleep(500 + Math.random() * 500);

                        window.scrollBy({ top: -scrollStep, behavior: 'smooth' }); // Возврат назад

                        // 3. БЕЗОПАСНЫЕ КЛАВИАТУРНЫЕ СОБЫТИЯ
                        // Shift, Ctrl или Alt - безопасные клавиши, которые не печатают текст
                        const keys = ['Shift', 'Control', 'Alt'];
                        const randomKey = keys[Math.floor(Math.random() * keys.length)];

                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: randomKey,
                            code: randomKey + 'Left',
                            bubbles: true,
                            cancelable: true,
                            view: window
                        }));

                        await sleep(80 + Math.random() * 50);

                        document.dispatchEvent(new KeyboardEvent('keyup', {
                            key: randomKey,
                            code: randomKey + 'Left',
                            bubbles: true
                        }));

                        // 4. HOVER ТОЛЬКО НА БЕЗОПАСНЫЕ ЭЛЕМЕНТЫ
                        // НЕ наводим на кнопки/ссылки (могут быть honeypot)
                        const safeElements = document.querySelectorAll('h1, h2, h3, p, span, div.container, .content');
                        if (safeElements.length > 0) {
                            const randomEl = safeElements[Math.floor(Math.random() * safeElements.length)];
                            randomEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

                            // Через секунду убираем курсор
                            setTimeout(() => {
                                randomEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                            }, 1000);
                        }

                        // 5. Фокус на окне (сброс idle-timer)
                        window.dispatchEvent(new FocusEvent('focus'));
                        document.dispatchEvent(new FocusEvent('focusin'));

                        // 6. Heartbeat в localStorage (некоторые сайты проверяют)
                        try {
                            localStorage.setItem('_activity_ts', Date.now().toString());
                            sessionStorage.setItem('_session_active', 'true');
                        } catch (e) { }

                        console.log('💓 Keep-Alive: микро-дрожание + скролл ✓');
                    }
                });
                console.log('💓 Keep-Alive отправлен (безопасный режим)');
                return;
            }
        }
    } catch (e) {
        console.error('💓 Keep-Alive ошибка:', e.message);
    }
}

// 🧨 HARD RESET: мягкий сброс без физического закрытия вкладки
async function hardResetAndRestart(tabId, reason) {
    console.log(`🧨 HARD RESET TRIGGERED: ${reason}`);
    await sendTelegramMessage(`🔄 <b>АВТО-СБРОС</b>\n\nПричина: ${reason}\n\nПерезапускаю процесс...`);
    await clearNavigationLoopGuard();
    await clearManualAuthState();

    try {
        if (tabId) {
            const tab = await safeGetTab(tabId);
            if (tab) {
                await appendDiagnosticLog('hard_reset_tab_preserved', {
                    tabId,
                    url: tab.url || '',
                    reason
                });
                console.log('🧨 Вкладка сохранена, физическое закрытие отключено');
            } else {
                console.log('🧨 Вкладка уже недоступна');
            }
        }
    } catch (e) {
        console.error('❌ Ошибка мягкого сброса вкладки:', e.message);
    }

    // Даем браузеру время и сбрасываем состояние
    await new Promise(r => setTimeout(r, 2000));

    // Перезапуск мониторинга (он сам откроет вкладку)
    console.log('🚀 Перезапуск startMonitoring()...');
    await startMonitoring();
}

async function setMonitorState(state, reason = '') {
    const { monitorState: previousState = TLS_PAGE_STATES.IDLE } = await chrome.storage.local.get('monitorState');
    let nextState = state;
    let nextReason = reason;

    if (!canTransitionMonitorState(previousState, state)) {
        await appendDiagnosticLog('invalid_transition', {
            from: previousState,
            to: state,
            reason: reason || ''
        });
        nextState = TLS_PAGE_STATES.ERROR;
        nextReason = `Недопустимый переход ${previousState} -> ${state}${reason ? `: ${reason}` : ''}`;
    }

    await chrome.storage.local.set({ monitorState: nextState, monitorReason: nextReason });
    await appendDiagnosticLog('state_transition', {
        from: previousState,
        to: nextState,
        reason: nextReason || ''
    });

    return { previousState, state: nextState, reason: nextReason };
}

async function setLastDiagnostic(snapshot = {}) {
    await chrome.storage.local.set({
        lastDiagnostic: {
            checkedAt: new Date().toISOString(),
            ...snapshot
        }
    });
}

async function handlePageAnalysisResult(targetTabId, analysis) {
    const { state, reason, textLength } = analysis;
    const monitorUpdate = await setMonitorState(state, reason);
    await setLastDiagnostic({
        tabId: targetTabId,
        state: monitorUpdate.state,
        reason: monitorUpdate.reason,
        textLength,
        url: analysis.url || '',
        matchedKeyword: analysis.matchedKeyword || '',
        debugText: analysis.debugText || ''
    });
    await appendDiagnosticLog('analysis_result', {
        tabId: targetTabId,
        state: monitorUpdate.state,
        reason: monitorUpdate.reason,
        textLength,
        url: analysis.url || '',
        matchedKeyword: analysis.matchedKeyword || ''
    });

    switch (monitorUpdate.state) {
        case TLS_PAGE_STATES.AUTH_ERROR:
            console.log('🚨 Auth Error detected (invalid_grant) -> Hard Reset');
            await hardResetAndRestart(targetTabId, 'Auth Error: invalid_grant');
            return;

        case TLS_PAGE_STATES.RATE_LIMITED: {
            console.log('🚫🚫🚫 RATE LIMIT ОБНАРУЖЕН! 🚫🚫🚫');
            await handleRateLimit();
            const afterBackoff = (await chrome.storage.local.get('rateLimitBackoff')).rateLimitBackoff;
            await addHistoryEntry('error', `⚠️ Rate limit! Ждём ${afterBackoff} мин...`);
            await sendTelegramMessage(
                `🚫 <b>RATE LIMIT!</b>\n\n` +
                `Cloudflare заблокировал запросы.\n\n` +
                `⏳ Пауза: <b>${afterBackoff} мин</b>\n\n` +
                `Бот автоматически продолжит после паузы.`
            );
            return;
        }

        case TLS_PAGE_STATES.CAPTCHA:
            console.log('🧩🧩🧩 CAPTCHA ОБНАРУЖЕНА! 🧩🧩🧩');
            await addHistoryEntry('error', '🧩 CAPTCHA! Зайдите в браузер');
            await sendTelegramMessage(
                `🧩 <b>CAPTCHA!</b>\n\n` +
                `Cloudflare требует проверку.\n\n` +
                `⚡ <b>Зайдите в браузер и пройдите проверку вручную!</b>\n\n` +
                `После прохождения бот продолжит работу.`
            );
            return;

        case TLS_PAGE_STATES.LOADING:
            if (textLength < 300) {
                console.log(`⚠️ Текст слишком короткий (${textLength} символов), страница не загружена`);
            }
            await addHistoryEntry('skip', 'Страница загружается...');
            return;

        case TLS_PAGE_STATES.NO_SLOTS:
            await addHistoryEntry('no_slots', 'Слотов нет');
            console.log('❌ Слотов нет');
            return;

        case TLS_PAGE_STATES.POTENTIAL_SLOTS:
            await addHistoryEntry('slots', '🎉 СЛОТЫ НАЙДЕНЫ!');
            await handleSlotsFound();
            return;

        case TLS_PAGE_STATES.AUTH:
        case TLS_PAGE_STATES.WRONG_PAGE:
        case TLS_PAGE_STATES.ERROR:
        default:
            await addHistoryEntry('skip', reason || 'Проверка завершена без действия');
            console.log('ℹ️ Состояние страницы:', state, reason);
            return;
    }
}

async function checkForSlots(recursionDepth = 0) {
    console.log('═══════════════════════════════════════════');
    console.log(`🔍 CHECK FOR SLOTS [depth: ${recursionDepth}] @ ${new Date().toLocaleTimeString('ru-RU')}`);
    console.log('═══════════════════════════════════════════');

    // Защита от бесконечной рекурсии (макс 5 попыток авто-логина)
    if (recursionDepth > 5) {
        console.log('⚠️ Достигнут лимит рекурсии авто-логина (5)');
        return;
    }

    const { isRunning, tlsUrl, autoRefresh, authManualPending = false, authTabId = null } = await chrome.storage.local.get(['isRunning', 'tlsUrl', 'autoRefresh', 'authManualPending', 'authTabId']);
    console.log('📊 Настройки:', { isRunning, tlsUrl: tlsUrl?.substring(0, 50) + '...', autoRefresh });
    await appendDiagnosticLog('check_started', {
        recursionDepth,
        tlsUrl: tlsUrl || '',
        autoRefresh: autoRefresh === true
    });

    if (!isRunning) {
        console.log('⏸️ Мониторинг не запущен, выход');
        return;
    }

    if (!normalizeTlsUrlValue(tlsUrl).valid) {
        console.error('❌ Проверка остановлена: tlsUrl вне разрешённого домена TLS Contact');
        await setMonitorState(TLS_PAGE_STATES.ERROR, 'Некорректный TLS URL в настройках');
        await setLastDiagnostic({
            state: TLS_PAGE_STATES.ERROR,
            reason: 'Некорректный TLS URL в настройках',
            textLength: 0,
            url: tlsUrl || '',
            matchedKeyword: '',
            debugText: ''
        });
        await appendDiagnosticLog('check_rejected', { reason: 'invalid_tls_url', tlsUrl: tlsUrl || '' });
        await addHistoryEntry('error', 'Некорректный TLS URL в настройках');
        await chrome.storage.local.set({ isRunning: false });
        return;
    }

    // 🛡️ ANTI-RATE-LIMIT: Проверяем, не в режиме backoff ли мы
    const { rateLimitBackoff = 0, lastRateLimitTime = 0 } = await chrome.storage.local.get(['rateLimitBackoff', 'lastRateLimitTime']);
    console.log(`🛡️ Rate limit check: backoff=${rateLimitBackoff} мин, lastTime=${lastRateLimitTime ? new Date(lastRateLimitTime).toLocaleTimeString() : 'never'}`);
    if (await isRateLimited()) {
        console.log('⏳ ПРОПУСКАЕМ проверку из-за rate limit backoff');
        return;
    }

    console.log('✅ Rate limit: OK, продолжаем');
    console.log('🔗 Целевой URL:', tlsUrl || '(не задан)');
    const startUrl = getTlsStartUrl(tlsUrl);

    // Получаем ВСЕ вкладки
    const allTabs = await chrome.tabs.query({});
    console.log('📑 Всего вкладок:', allTabs.length);

    // Фильтруем вкладки по URL
    let targetTab = null;
    if (tlsUrl) {
        try {
            const userUrl = new URL(tlsUrl);
            const hostname = userUrl.hostname.toLowerCase();
            const { loginUrl = '' } = await chrome.storage.local.get('loginUrl');
            console.log('🌐 Ищем вкладки с доменом:', hostname);

            const rankedCandidates = allTabs
                .filter((tab) => Boolean(tab.url))
                .map((tab) => ({ tab, score: scoreTlsCandidate(tab.url, tlsUrl, loginUrl) }))
                .filter((candidate) => candidate.score >= 0)
                .sort((left, right) => right.score - left.score);

            if (rankedCandidates.length > 0) {
                targetTab = rankedCandidates[0].tab;
                console.log('✅ Найдена лучшая TLS вкладка:', targetTab.id, targetTab.url);
            }

            if (authManualPending && authTabId) {
                const manualAuthTab = rankedCandidates.find((candidate) => candidate.tab.id === authTabId)?.tab || await safeGetTab(authTabId);
                if (manualAuthTab) {
                    targetTab = manualAuthTab;
                    console.log('🔐 Используем auth-вкладку для ручного логина:', targetTab.id, targetTab.url);
                }
            }
        } catch (e) {
            console.error('❌ Неверный URL:', e.message);
        }
    }

    if (!targetTab) {
        console.log('⚠️ Подходящая TLS вкладка не найдена. Открываем целевой URL.');
        targetTab = await chrome.tabs.create({ url: tlsUrl, active: true });
        await new Promise(r => setTimeout(r, 3000));
    }

    if (!isScriptableTlsUrl(targetTab.url || '')) {
        console.log('↪️ Текущая вкладка не подходит для scripting, перенаправляем на tlsUrl:', targetTab.url);
        await appendDiagnosticLog('retarget_to_tls_url', {
            fromUrl: targetTab.url || '',
            toUrl: tlsUrl || ''
        });
        await chrome.tabs.update(targetTab.id, { url: tlsUrl });
        await waitForPageLoad(targetTab.id, 10000);
        await new Promise(r => setTimeout(r, 1500));
        targetTab = await safeGetTab(targetTab.id);
        if (!targetTab) {
            await addHistoryEntry('error', 'Вкладка TLS потеряна после редиректа');
            return;
        }
    }

    const targetTabUrl = targetTab.url || '';
    const isAuthTabNow = targetTabUrl.includes('/auth') || targetTabUrl.includes('auth.');
    if (authManualPending && authTabId === targetTab.id && isAuthTabNow) {
        await setMonitorState(TLS_PAGE_STATES.AUTH, 'Ожидание ручного логина');
        await setLastDiagnostic({
            tabId: targetTab.id,
            state: TLS_PAGE_STATES.AUTH,
            reason: 'Ожидание ручного логина',
            textLength: 0,
            url: targetTabUrl,
            matchedKeyword: '',
            debugText: ''
        });
        await appendDiagnosticLog('auth_waiting_user', {
            tabId: targetTab.id,
            url: targetTabUrl
        });
        console.log('⏸️ Auth-вкладка оставлена пользователю для ручного входа');
        return;
    }

    if (authManualPending && (!authTabId || authTabId === targetTab.id) && !isAuthTabNow) {
        await clearManualAuthState();
        await appendDiagnosticLog('auth_manual_completed_or_left', {
            tabId: targetTab.id,
            url: targetTabUrl
        });

        // After manual login, navigate to post-login page if configured
        const { postLoginUrl = '' } = await chrome.storage.local.get('postLoginUrl');
        if (postLoginUrl) {
            console.log('📄 Ручной логин завершён, переходим на post-login страницу:', postLoginUrl);
            await appendDiagnosticLog('post_login_navigate', {
                tabId: targetTab.id,
                postLoginUrl,
                trigger: 'manual_auth'
            });
            await chrome.tabs.update(targetTab.id, { url: postLoginUrl, active: true });
            await waitForPageLoad(targetTab.id, 10000);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (recursionDepth === 0) {
        await clearNavigationLoopGuard();
    }

    // 🔄 AUTO-REFRESH: Обновляем страницу перед проверкой (БЕЗОПАСНЫЙ МЕТОД)
    // Вместо F5 (reload) используем навигацию — это выглядит более человечно
    if (autoRefresh !== false) {
        console.log('🔄 Обновляем страницу (навигация, не F5)...');
        try {
            // Пробуем кликнуть по ссылке на странице (более человечно чем F5)
            await safeExecuteScript({
                target: { tabId: targetTab.id },
                func: () => {
                    // Ищем ссылку для навигации (меню, логотип, или текущая страница)
                    const navLinks = document.querySelectorAll('a[href*="appointment"], a[href*="booking"], nav a, header a, .menu a');

                    // Пробуем найти ссылку на текущий раздел
                    const currentPath = location.pathname;
                    const samePageLink = Array.from(navLinks).find(a => a.href.includes(currentPath.split('/').pop()));

                    if (samePageLink) {
                        console.log('🖱️ Кликаем по навигационной ссылке:', samePageLink.href);
                        samePageLink.click();
                        return { method: 'link_click', success: true };
                    }

                    // Если ссылки нет — используем location.href (лучше чем F5)
                    console.log('🔄 Навигация через location.href');
                    location.href = location.href;
                    return { method: 'location_href', success: true };
                }
            });

            // Ждём загрузки страницы
            await waitForPageLoad(targetTab.id, 5000);
            targetTab = await safeGetTab(targetTab.id) || targetTab;
            console.log('✅ Страница обновлена');
        } catch (e) {
            console.error('🔄 Ошибка обновления страницы:', e.message);
            // Fallback на reload только в крайнем случае
            try {
                await chrome.tabs.reload(targetTab.id);
                await waitForPageLoad(targetTab.id, 5000);
                targetTab = await safeGetTab(targetTab.id) || targetTab;
            } catch (e2) { }
        }
    }

    // 🕵️ LOGOUT DETECTION: Проверяем, не вылетели ли мы
    try {
        const isLogout = await safeExecuteScript({
            target: { tabId: targetTab.id },
            func: () => {
                const text = document.body.innerText.toLowerCase();
                const url = location.href.toLowerCase();
                // Ключевые слова страницы логина
                const loginKeywords = ['login', 'sign in', 'connect', 'вход', 'войти', 'регистрация'];
                // Проверяем URL и контент
                const isLoginUrl = url.includes('login') || url.includes('signin') || url.includes('auth');
                const hasLoginText = loginKeywords.some(k => text.includes(k));

                // Если мы на странице логина и текста "нет слотов" нет (чтобы не путать)
                return { isLogout: isLoginUrl && hasLoginText, text: text };
            }
        });

        // Проверяем паттерн /xx-xx в конце URL (например /ru-ru, /en-us)
        const isLanguagePage = /\/[a-z]{2}-[a-z]{2}\/?$/.test(targetTab.url.toLowerCase());

        if (isLogout && isLogout[0] && isLogout[0].result &&
            (isLogout[0].result.isLogout ||
                targetTab.url.includes('/vac/') ||
                targetTab.url.includes('/travel-groups') ||
                isLanguagePage)) {
            console.log('⚠️ ОБНАРУЖЕН ВЫХОД ИЗ СИСТЕМЫ!');

            // Проверяем настройки авто-логина
            const { autoLogin, loginEmail, loginPassword } = await getAutoLoginCredentials();

            // Проверяем является ли это страницей логина/auth
            const isAuthPage = targetTab.url.includes('/auth') || targetTab.url.includes('auth.');
            const isStartPage = startUrl ? urlsMatchIgnoringHash(targetTab.url, startUrl) : false;
            const hasAutoLoginCredentials = Boolean(autoLogin && loginEmail && loginPassword);

            const isLandingPage = targetTab.url.includes('/vac/') ||
                targetTab.url.includes('/travel-groups') ||
                isLanguagePage ||
                isAuthPage ||
                (isLogout[0].result.text && isLogout[0].result.text.includes('please select your place of residence'));

            if (isLandingPage) {
                console.log('🌍 Обнаружена промежуточная/auth страница. Auth:', isAuthPage);

                if (isAuthPage) {
                    const authReason = hasAutoLoginCredentials
                        ? 'Страница логина, запускаю авто-вход'
                        : 'Страница логина, требуется ручной вход';
                    if (!hasAutoLoginCredentials) {
                        await setManualAuthState(targetTab.id);
                        // Dump raw storage for debugging
                        const rawStorage = await chrome.storage.local.get(['loginEmail', 'loginPassword', 'autoLogin']);
                        await appendDiagnosticLog('auto_login_missing_credentials', {
                            tabId: targetTab.id,
                            url: targetTab.url,
                            autoLogin: autoLogin === true,
                            hasEmail: Boolean(loginEmail),
                            hasPassword: Boolean(loginPassword),
                            rawEmailType: typeof rawStorage.loginEmail,
                            rawEmailLen: String(rawStorage.loginEmail || '').length,
                            rawPassType: typeof rawStorage.loginPassword,
                            rawPassLen: String(rawStorage.loginPassword || '').length
                        });
                    }
                    await setMonitorState(TLS_PAGE_STATES.AUTH, authReason);
                    await setLastDiagnostic({
                        tabId: targetTab.id,
                        state: TLS_PAGE_STATES.AUTH,
                        reason: authReason,
                        textLength: 0,
                        url: targetTab.url,
                        matchedKeyword: '',
                        debugText: ''
                    });
                    await appendDiagnosticLog('auth_page_detected', {
                        tabId: targetTab.id,
                        url: targetTab.url,
                        autoLogin: autoLogin === true,
                        hasCredentials: hasAutoLoginCredentials
                    });

                    if (!hasAutoLoginCredentials) {
                        console.log('⏸️ Нет credentials для авто-входа. Оставляем страницу логина без сброса.');
                        return;
                    }
                }

                const landingStage = targetTab.url.includes('/travel-groups')
                    ? 'travel-groups'
                    : isAuthPage
                        ? 'auth'
                        : isLanguagePage
                            ? 'language'
                            : 'landing';

                const loopGuard = await registerNavigationLoopGuard(
                    landingStage,
                    targetTab.url,
                    targetTab.id,
                    recursionDepth
                );

                if (loopGuard.count >= NAVIGATION_LOOP_THRESHOLD) {
                    const loopReason = `Навигационный цикл: ${landingStage} x${loopGuard.count}`;
                    console.warn('🚨 Обнаружен цикл навигации:', loopGuard);
                    await setMonitorState(TLS_PAGE_STATES.ERROR, loopReason);
                    await setLastDiagnostic({
                        tabId: targetTab.id,
                        state: TLS_PAGE_STATES.ERROR,
                        reason: loopReason,
                        textLength: 0,
                        url: targetTab.url,
                        matchedKeyword: '',
                        debugText: ''
                    });
                    await addHistoryEntry('error', loopReason);
                    await hardResetAndRestart(targetTab.id, loopReason);
                    return;
                }

                if (shouldForceReturnToTlsUrl(targetTab.url, tlsUrl, startUrl)) {
                    // Skip redirect if we don't have auto-login credentials — site will just redirect back
                    if (!hasAutoLoginCredentials && recursionDepth >= 1) {
                        console.log('⏭️ Пропускаем redirect на booking — нет credentials, редирект бесполезен');
                        await appendDiagnosticLog('landing_redirect_skipped', {
                            fromUrl: targetTab.url,
                            reason: 'no_credentials_would_loop',
                            recursionDepth
                        });
                    } else {
                        console.log('↪️ Возвращаем вкладку с лендинга на целевой booking URL:', tlsUrl);
                        await appendDiagnosticLog('retarget_booking_page', {
                            fromUrl: targetTab.url,
                            toUrl: tlsUrl,
                            reason: 'landing_redirect'
                        });
                        await chrome.tabs.update(targetTab.id, { url: tlsUrl, active: true });
                        await waitForPageLoad(targetTab.id, 10000);
                        await new Promise(r => setTimeout(r, 1500));
                        return checkForSlots(recursionDepth + 1);
                    }
                }

                if ((isStartPage || isLanguagePage) && autoLogin) {
                    console.log('🔐 Стартовая/языковая страница: пробуем перейти к логину через UI');
                    const signInResult = await safeExecuteScript({
                        target: { tabId: targetTab.id },
                        func: () => {
                            const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'));
                            const trigger = candidates.find((element) => {
                                const text = (element.innerText || element.textContent || '').toLowerCase().trim();
                                const href = (element.getAttribute('href') || '').toLowerCase();
                                return text.includes('sign in')
                                    || text.includes('login')
                                    || text.includes('log in')
                                    || text.includes('connect')
                                    || href.includes('auth')
                                    || href.includes('login');
                            });

                            if (!trigger) {
                                return { clicked: false };
                            }

                            trigger.click();
                            return {
                                clicked: true,
                                text: (trigger.innerText || trigger.textContent || '').trim(),
                                href: trigger.href || trigger.getAttribute('href') || ''
                            };
                        }
                    });

                    const signInPayload = signInResult?.[0]?.result || { clicked: false };
                    if (signInPayload.clicked) {
                        await appendDiagnosticLog('landing_sign_in_triggered', {
                            tabId: targetTab.id,
                            url: targetTab.url,
                            text: signInPayload.text || '',
                            href: signInPayload.href || ''
                        });
                        await waitForPageLoad(targetTab.id, 10000);
                        await new Promise(r => setTimeout(r, 1500));
                        return checkForSlots(recursionDepth + 1);
                    }

                    await appendDiagnosticLog('landing_sign_in_not_found', {
                        tabId: targetTab.id,
                        url: targetTab.url,
                        reason: 'no_sign_in_trigger_found'
                    });

                    // Если Sign In не найден на языковой странице — перенаправить на /en-us
                    if (isLanguagePage && !isStartPage && startUrl) {
                        console.log('🌍 Перенаправление с языковой страницы на /en-us:', startUrl);
                        await appendDiagnosticLog('language_to_start_redirect', {
                            fromUrl: targetTab.url,
                            toUrl: startUrl
                        });
                        await chrome.tabs.update(targetTab.id, { url: startUrl, active: true });
                        await waitForPageLoad(targetTab.id, 10000);
                        await new Promise(r => setTimeout(r, 1500));
                        return checkForSlots(recursionDepth + 1);
                    }
                }

                // 1. Если есть прямая ссылка для входа И НЕ на travel-groups И НЕ уже на auth — редирект
                const { loginUrl } = await chrome.storage.local.get('loginUrl');
                if (loginUrl && normalizeTlsUrlValue(loginUrl).valid && !targetTab.url.includes('/travel-groups') && !isAuthPage) {
                    console.log('🔄 Перенаправление на страницу входа:', loginUrl);
                    await chrome.tabs.update(targetTab.id, { url: loginUrl });
                    console.log('⏳ Ожидаем загрузку страницы логина...');
                    await waitForPageLoad(targetTab.id, 10000);
                    await new Promise(r => setTimeout(r, 1500));
                    console.log('✅ Страница логина загружена');
                    return checkForSlots(recursionDepth + 1);
                }

                // 2. ВСЕГДА пытаемся кликнуть Select на travel-groups
                if (targetTab.url.includes('/travel-groups')) {
                    console.log('🖱️ Страница travel-groups — ищем кнопку Select...');
                    try {
                        const clickResult = await safeExecuteScript({
                            target: { tabId: targetTab.id },
                            func: () => {
                                const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], .btn'));
                                const selectBtn = allElements.find(el => {
                                    const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                                    return text === 'select' || text.includes('select')
                                        || text === 'ընտրել' || text.includes('ընտրել');
                                });
                                if (selectBtn) {
                                    console.log('✅ Кликаем Select:', selectBtn.innerText);
                                    selectBtn.click();
                                    return { clicked: true, text: (selectBtn.innerText || '').trim() };
                                }
                                // Log all button texts for debugging
                                const allTexts = allElements.slice(0, 20).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean);
                                return { clicked: false, availableButtons: allTexts };
                            }
                        });
                        const selectPayload = clickResult?.[0]?.result || { clicked: false };
                        await appendDiagnosticLog('travel_groups_select', {
                            tabId: targetTab.id,
                            url: targetTab.url,
                            clicked: selectPayload.clicked || false,
                            buttonText: selectPayload.text || '',
                            availableButtons: selectPayload.availableButtons || []
                        });
                        await new Promise(r => setTimeout(r, 5000));
                        return checkForSlots(recursionDepth + 1);
                    } catch (e) {
                        console.error('❌ Ошибка клика Select:', e);
                        await appendDiagnosticLog('travel_groups_select_error', {
                            tabId: targetTab.id,
                            url: targetTab.url,
                            error: e.message || String(e)
                        });
                    }
                }

                // 3. Авто-логин (Human-Like Typing Version)
                if (autoLogin && loginEmail && loginPassword && isAuthPage) {
                    console.log('🤖 START: Human-Like Login Process...');
                    await appendDiagnosticLog('auto_login_started', {
                        tabId: targetTab.id,
                        url: targetTab.url,
                        emailPresent: Boolean(loginEmail),
                        passwordPresent: Boolean(loginPassword)
                    });

                    try {
                        // ===== ШАГ 1: ВВОД EMAIL =====
                        console.log('📝 Step 1: Typing Email...');
                        await safeExecuteScript({
                            target: { tabId: targetTab.id },
                            func: async (email) => {
                                const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                                const input = document.querySelector('input[type="email"], input[name="email"], input[name="username"], #username, #email, input[id*="email"], input[id*="user"]');
                                if (!input) {
                                    console.log('❌ Email field not found');
                                    return false;
                                }

                                input.scrollIntoView({ behavior: "smooth", block: "center" });
                                await sleep(500);

                                input.focus();
                                input.click();
                                input.value = '';

                                for (const char of email) {
                                    input.value += char;
                                    input.dispatchEvent(new Event('keydown', { bubbles: true }));
                                    input.dispatchEvent(new Event('keypress', { bubbles: true }));
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                    await sleep(50 + Math.random() * 100);
                                }

                                input.dispatchEvent(new Event('blur', { bubbles: true }));
                                console.log('✅ Email typed:', email.substring(0, 5) + '***');
                                return true;
                            },
                            args: [loginEmail]
                        });

                        await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

                        // ===== ШАГ 2: ВВОД ПАРОЛЯ =====
                        console.log('📝 Step 2: Typing Password...');
                        await safeExecuteScript({
                            target: { tabId: targetTab.id },
                            func: async (password) => {
                                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                                const input = document.querySelector('input[type="password"], input[name="password"], #password, input[id*="password"]');
                                if (!input) {
                                    console.log('❌ Password field not found');
                                    return false;
                                }

                                input.focus();
                                input.click();
                                input.value = '';

                                for (const char of password) {
                                    input.value += char;
                                    input.dispatchEvent(new Event('keydown', { bubbles: true }));
                                    input.dispatchEvent(new Event('keypress', { bubbles: true }));
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                    await sleep(30 + Math.random() * 90);
                                }

                                input.dispatchEvent(new Event('blur', { bubbles: true }));
                                console.log('✅ Password typed');
                                return true;
                            },
                            args: [loginPassword]
                        });

                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

                        // ===== ШАГ 3: КЛИК ПО КНОПКЕ =====
                        console.log('🖱️ Step 3: Clicking Login...');
                        await safeExecuteScript({
                            target: { tabId: targetTab.id },
                            func: () => {
                                let btn = document.querySelector('button[type="submit"], input[type="submit"], #kc-login, .submit-button');
                                if (!btn) {
                                    btn = Array.from(document.querySelectorAll('button, a.btn, input[type="button"]')).find(b => {
                                        const t = (b.innerText || b.value || '').toLowerCase();
                                        return t.includes('log') || t.includes('sign') || t.includes('enter') || t.includes('войти');
                                    });
                                }
                                if (btn) {
                                    console.log('🖱️ Clicking:', btn.innerText || btn.value);
                                    btn.click();
                                    return true;
                                }
                                console.log('❌ Login button not found');
                                return false;
                            }
                        });

                        // ===== ШАГ 4: УМНОЕ ОЖИДАНИЕ РЕДИРЕКТА =====
                        console.log('⏳ Waiting for redirect (up to 15 sec)...');

                        let loginSuccess = false;
                        for (let i = 0; i < 15; i++) {
                            await new Promise(r => setTimeout(r, 1000));

                            try {
                                const currentTab = await safeGetTab(targetTab.id);
                                if (currentTab && !currentTab.url.includes('login') && !currentTab.url.includes('auth')) {
                                    console.log('✅ URL changed! Login successful.');
                                    loginSuccess = true;
                                    break;
                                }
                                console.log(`⏳ Still on auth page... (${i + 1}/15)`);
                            } catch (e) {
                                console.log('⚠️ Tab check error:', e.message);
                            }
                        }

                        if (!loginSuccess) {
                            console.warn('⚠️ URL did not change in 15 sec. Triggering Hard Reset.');
                            await appendDiagnosticLog('auto_login_timeout', {
                                tabId: targetTab.id,
                                url: targetTab.url
                            });
                            await hardResetAndRestart(targetTab.id, 'Авто-логин застрял (таймаут 15с)');
                            return;
                        }

                        console.log('🔄 Restarting check loop...');
                        await setMonitorState(TLS_PAGE_STATES.RUNNING, 'Авто-логин завершён, продолжаю проверку');
                        await appendDiagnosticLog('auto_login_completed', {
                            tabId: targetTab.id,
                            url: targetTab.url
                        });

                        // Navigate to post-login page if configured
                        const { postLoginUrl = '' } = await chrome.storage.local.get('postLoginUrl');
                        if (postLoginUrl) {
                            console.log('📄 Переходим на post-login страницу:', postLoginUrl);
                            await appendDiagnosticLog('post_login_navigate', {
                                tabId: targetTab.id,
                                postLoginUrl
                            });
                            await chrome.tabs.update(targetTab.id, { url: postLoginUrl, active: true });
                            await waitForPageLoad(targetTab.id, 10000);
                            await new Promise(r => setTimeout(r, 2000));
                        }

                        return checkForSlots(recursionDepth + 1);

                    } catch (e) {
                        console.error('❌ Auto-login failed:', e);
                        await appendDiagnosticLog('auto_login_failed', {
                            tabId: targetTab.id,
                            url: targetTab.url,
                            message: e.message || 'unknown_error'
                        });
                        await hardResetAndRestart(targetTab.id, `Ошибка авто-логина: ${e.message}`);
                        return;
                    }
                }

                // 4. Алерт о потере сессии (fallback) -> HARD RESET
                console.log('🚨 Сессия потеряна — выполняем сброс');
                await hardResetAndRestart(targetTab.id, 'Сессия потеряна (logout detected)');
                return;
            }
        }
    } catch (e) {
        console.error('Ошибка проверки логина:', e);
    }

    // 💉 INJECT: Восстанавливаем индикатор статуса
    try {
        await safeExecuteScript({
            target: { tabId: targetTab.id },
            func: () => {
                const existing = document.getElementById('tls-ext-indicator');
                if (existing) return;

                const div = document.createElement('div');
                div.id = 'tls-ext-indicator';

                const panel = document.createElement('div');
                panel.id = 'tls-panel';
                panel.style.position = 'fixed';
                panel.style.bottom = '20px';
                panel.style.right = '20px';
                panel.style.background = 'rgba(16, 24, 40, 0.95)';
                panel.style.color = 'white';
                panel.style.padding = '12px 16px';
                panel.style.borderRadius = '12px';
                panel.style.fontFamily = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
                panel.style.fontSize = '13px';
                panel.style.zIndex = '2147483647';
                panel.style.display = 'flex';
                panel.style.alignItems = 'center';
                panel.style.gap = '12px';
                panel.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
                panel.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                panel.style.backdropFilter = 'blur(8px)';
                panel.style.transition = 'all 0.3s ease';
                panel.style.cursor = 'default';
                panel.style.userSelect = 'none';

                const content = document.createElement('div');
                content.style.display = 'flex';
                content.style.alignItems = 'center';
                content.style.gap = '8px';

                const flag = document.createElement('span');
                flag.style.fontSize = '18px';
                flag.textContent = '🇮🇹';

                const textWrap = document.createElement('div');

                const title = document.createElement('div');
                title.style.fontWeight = '600';
                title.style.color = '#fff';
                title.textContent = 'TLS Monitor';

                const subtitle = document.createElement('div');
                subtitle.style.fontSize = '11px';
                subtitle.style.color = '#00ff88';
                subtitle.style.display = 'flex';
                subtitle.style.alignItems = 'center';
                subtitle.style.gap = '4px';

                const dot = document.createElement('span');
                dot.style.width = '6px';
                dot.style.height = '6px';
                dot.style.background = '#00ff88';
                dot.style.borderRadius = '50%';
                dot.style.display = 'inline-block';
                dot.style.animation = 'tls-pulse 1.5s infinite';

                const subtitleText = document.createElement('span');
                subtitleText.textContent = 'Активен';

                const divider = document.createElement('div');
                divider.style.width = '1px';
                divider.style.height = '24px';
                divider.style.background = 'rgba(255,255,255,0.1)';
                divider.style.margin = '0 4px';

                const closeButton = document.createElement('div');
                closeButton.id = 'tls-close-btn';
                closeButton.className = 'tls-close-btn';
                closeButton.style.cursor = 'pointer';
                closeButton.style.padding = '4px';
                closeButton.style.opacity = '0.6';
                closeButton.style.transition = 'opacity 0.2s';
                closeButton.textContent = '✕';

                const style = document.createElement('style');
                style.textContent = `
                    @keyframes tls-pulse {
                        0% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.4); }
                        70% { box-shadow: 0 0 0 6px rgba(0, 255, 136, 0); }
                        100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
                    }
                    .tls-close-btn:hover { opacity: 1 !important; }
                `;

                subtitle.appendChild(dot);
                subtitle.appendChild(subtitleText);
                textWrap.appendChild(title);
                textWrap.appendChild(subtitle);
                content.appendChild(flag);
                content.appendChild(textWrap);
                panel.appendChild(content);
                panel.appendChild(divider);
                panel.appendChild(closeButton);
                div.appendChild(panel);
                div.appendChild(style);
                document.body.appendChild(div);

                closeButton.addEventListener('click', () => {
                    panel.style.display = 'none';
                });
            }
        });
    } catch (e) {
        console.error('❌ Ошибка инъекции индикатора:', e);
    }

    // Получаем ключевые слова из настроек
    const { noSlotsKeywords } = await chrome.storage.local.get('noSlotsKeywords');
    const keywords = noSlotsKeywords
        ? noSlotsKeywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k)
        : [
            // Основные фразы (с разными вариантами апострофов)
            "we currently don't have any appointment slots available",
            "we currently don't have any appointment slots available",  // curly apostrophe
            "no slots are currently available",
            "please check this page regularly"  // дополнительная фраза-маркер
        ];

    console.log('🔑 Ключевых слов:', keywords.length);

    // Проверяем страницу через scripting API
    try {
        console.log('📄 Проверяем вкладку:', targetTab.id, targetTab.url);

        const results = await safeExecuteScript({
            target: { tabId: targetTab.id },
            func: async (keywordList) => {
                const normalize = (str) => {
                    return str.toLowerCase()
                        .replace(/['''`]/g, "'")
                        .replace(/\s+/g, ' ')
                        .trim();
                };

                const waitForText = async (attempts = 3) => {
                    for (let i = 0; i < attempts; i++) {
                        const text = document.body ? normalize(document.body.innerText) : '';
                        console.log(`📄 Попытка ${i + 1}/${attempts}, длина текста: ${text.length}`);

                        if (text.length > 500) return text;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    return document.body ? normalize(document.body.innerText) : '';
                };

                const pageText = await waitForText();

                console.log('📄 Текст страницы (первые 100 символов):', pageText.substring(0, 100));

                const hasBookingUi = Boolean(
                    document.querySelector('[data-testid*="appointment"]') ||
                    document.querySelector('[class*="appointment"]') ||
                    document.querySelector('[class*="booking"]') ||
                    document.querySelector('[id*="appointment"]') ||
                    document.querySelector('[id*="booking"]') ||
                    Array.from(document.querySelectorAll('button, a')).some((element) => {
                        const text = (element.innerText || '').toLowerCase();
                        return text.includes('book') || text.includes('slot') || text.includes('appointment') || text.includes('select');
                    })
                );

                const hasCaptchaElement = (
                    document.querySelector('[class*="captcha"]') ||
                    document.querySelector('[class*="turnstile"]') ||
                    document.querySelector('iframe[src*="captcha"]') ||
                    document.querySelector('iframe[src*="turnstile"]')
                );

                return {
                    url: location.href,
                    pageText,
                    hasBookingUi,
                    hasCaptchaElement: Boolean(hasCaptchaElement),
                    hasTlsFooter: pageText.includes('tlscontact') && pageText.includes('all rights reserved'),
                    textLength: pageText.length,
                    debugText: pageText.substring(0, 200)
                };
            },
            args: [keywords]
        });

        // Обновляем статистику
        const stats = await chrome.storage.local.get(['checkCount']);
        const newCount = (stats.checkCount || 0) + 1;
        await chrome.storage.local.set({
            checkCount: newCount,
            lastCheck: new Date().toLocaleTimeString('ru-RU')
        });

        const firstResult = results?.[0]?.result || null;

        console.log('───────────────────────────────────────────');
        console.log('📊 РЕЗУЛЬТАТ ПРОВЕРКИ:');
        console.log('  → state:', firstResult?.state);
        console.log('  → textLength:', firstResult?.textLength);
        console.log('  → reason:', firstResult?.reason);
        console.log('───────────────────────────────────────────');

        if (firstResult) {
            const pageSnapshot = firstResult;

            if (shouldForceReturnToTlsUrl(pageSnapshot.url, tlsUrl, startUrl)) {
                console.log('↪️ Анализ показал лендинг вместо booking page. Возвращаемся на tlsUrl.');
                await appendDiagnosticLog('retarget_booking_page', {
                    fromUrl: pageSnapshot.url,
                    toUrl: tlsUrl,
                    reason: 'analysis_detected_landing'
                });
                await chrome.tabs.update(targetTab.id, { url: tlsUrl, active: true });
                await waitForPageLoad(targetTab.id, 10000);
                await new Promise(r => setTimeout(r, 1500));
                return checkForSlots(recursionDepth + 1);
            }

            const analysis = analyzeTlsPageState({
                pageText: pageSnapshot.pageText,
                url: pageSnapshot.url,
                hasBookingUi: pageSnapshot.hasBookingUi,
                hasCaptchaElement: pageSnapshot.hasCaptchaElement,
                hasTlsFooter: pageSnapshot.hasTlsFooter,
                keywordList: keywords,
                rateLimitKeywords: [
                    'error 1015',
                    'you are being rate limited',
                    'too many requests',
                    'temporarily blocked',
                    'sorry, you have been blocked',
                    'you have been blocked',
                    'unable to access',
                    'access denied'
                ],
                captchaKeywords: ['verify you are human', 'checking your browser', 'ddos protection', 'ray id:', 'attention required'],
                errorKeywords: ['error', 'something went wrong', 'page not found', '404', '500', 'unavailable', 'maintenance']
            });
            const { state, isAuthError } = analysis;

            console.log(`🎯 Результат: ${state} (${analysis.reason})`);
            console.log('───────────────────────────────────────────');
            console.log('📊 РЕЗУЛЬТАТ ПРОВЕРКИ:');
            console.log('  → state:', state);
            console.log('  → textLength:', analysis.textLength);
            console.log('  → reason:', analysis.reason);
            console.log('───────────────────────────────────────────');

            // 🛑 AUTH ERROR (JSON response instead of HTML)
            if (isAuthError) {
                await handlePageAnalysisResult(targetTab.id, {
                    ...analysis,
                    url: pageSnapshot.url,
                    state: TLS_PAGE_STATES.AUTH_ERROR,
                    reason: 'Auth Error: invalid_grant'
                });
                return;
            }

            await handlePageAnalysisResult(targetTab.id, {
                ...analysis,
                url: pageSnapshot.url,
                state: analysis.state || TLS_PAGE_STATES.ERROR
            });

            // 🔄 RETRY on "something went wrong" error — navigate back to booking and try again
            if (analysis.state === TLS_PAGE_STATES.ERROR &&
                analysis.debugText && analysis.debugText.includes('something went wrong') &&
                recursionDepth < 5) {
                console.log('🔄 Ошибка "something went wrong" — перезагружаем и пробуем снова...');
                await appendDiagnosticLog('error_page_retry', {
                    tabId: targetTab.id,
                    url: pageSnapshot.url,
                    recursionDepth,
                    reason: 'something_went_wrong'
                });
                try {
                    await chrome.tabs.update(targetTab.id, { url: tlsUrl, active: true });
                    await waitForPageLoad(targetTab.id, 10000);
                    await new Promise(r => setTimeout(r, 2000));
                    return checkForSlots(recursionDepth + 1);
                } catch (e) {
                    console.error('❌ Ошибка при retry:', e.message);
                }
            }
        } else {
            console.log('⚠️ Нет результата проверки');
            await setMonitorState(TLS_PAGE_STATES.ERROR, 'Нет результата проверки');
            await setLastDiagnostic({
                tabId: targetTab?.id || null,
                state: TLS_PAGE_STATES.ERROR,
                reason: 'Нет результата проверки',
                textLength: 0,
                url: targetTab?.url || '',
                matchedKeyword: '',
                debugText: ''
            });
            await appendDiagnosticLog('check_failed', {
                reason: 'no_result',
                tabId: targetTab?.id || null,
                url: targetTab?.url || ''
            });
            await addHistoryEntry('error', 'Нет результата');
        }
    } catch (e) {
        console.error('❌ Ошибка проверки:', e.message);
        await setMonitorState(TLS_PAGE_STATES.ERROR, e.message);
        await setLastDiagnostic({
            state: TLS_PAGE_STATES.ERROR,
            reason: e.message,
            textLength: 0,
            url: '',
            matchedKeyword: '',
            debugText: ''
        });
        await appendDiagnosticLog('check_exception', { message: e.message || 'unknown_error' });
        await addHistoryEntry('error', 'Ошибка: ' + e.message.substring(0, 30));
        const stats = await chrome.storage.local.get(['checkCount']);
        await chrome.storage.local.set({
            checkCount: (stats.checkCount || 0) + 1,
            lastCheck: new Date().toLocaleTimeString('ru-RU')
        });
    }
}

// Функция добавления записи в историю
async function addHistoryEntry(status, message) {
    const { checkHistory = [] } = await chrome.storage.local.get('checkHistory');
    const entry = {
        status,
        message,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    checkHistory.push(entry);
    if (checkHistory.length > 50) {
        checkHistory.shift();
    }
    await chrome.storage.local.set({ checkHistory });

    await addStatEntry(status);
}

// Добавляет запись в статистику за неделю
async function addStatEntry(status) {
    const now = Date.now();
    const dayKey = new Date(now).toISOString().split('T')[0];

    const { slotStats = {} } = await chrome.storage.local.get('slotStats');

    if (!slotStats[dayKey]) {
        slotStats[dayKey] = { checks: 0, slots: 0, noSlots: 0, errors: 0 };
    }

    slotStats[dayKey].checks++;
    if (status === 'slots') slotStats[dayKey].slots++;
    else if (status === 'no_slots') slotStats[dayKey].noSlots++;
    else if (status === 'error') slotStats[dayKey].errors++;

    // 🧹 Очистка старых данных (> 7 дней)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(slotStats).forEach(key => {
        if (new Date(key).getTime() < weekAgo) {
            delete slotStats[key];
        }
    });

    await chrome.storage.local.set({ slotStats });
}

// Утилита для ожидания загрузки страницы
function waitForPageLoad(tabId, timeout = 5000) {
    return new Promise((resolve) => {
        const startTime = Date.now();

        const checkStatus = async () => {
            try {
                const tab = await safeGetTab(tabId);
                if (tab && tab.status === 'complete') {
                    setTimeout(resolve, 800);
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    console.log('⏱️ Таймаут загрузки страницы');
                    resolve();
                    return;
                }

                setTimeout(checkStatus, 200);
            } catch (e) {
                resolve();
            }
        };

        checkStatus();
    });
}

async function handleSlotsFound() {
    const now = Date.now();
    const timeSinceLastNotification = now - lastNotificationTime;
    const MIN_COOLDOWN = 10 * 1000;

    if (timeSinceLastNotification < MIN_COOLDOWN) {
        console.log('⏳ Пропуск (отправлено ' + Math.round(timeSinceLastNotification / 1000) + ' сек назад)');
        return;
    }

    console.log('🎉 СЛОТЫ НАЙДЕНЫ! Отправляем уведомления...');
    lastNotificationTime = now;

    // Получаем настройки с дефолтными значениями
    const settings = await chrome.storage.local.get(['botToken', 'chatIds', 'soundEnabled', 'browserNotify', 'tlsUrl']);
    const soundEnabled = settings.soundEnabled !== false;
    const browserNotify = settings.browserNotify !== false;

    // Визуальное уведомление на странице (Overlay)
    try {
        let tabs = await chrome.tabs.query({});
        let targetTab = tabs.find(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));

        if (targetTab) {
            await safeExecuteScript({
                target: { tabId: targetTab.id },
                func: () => {
                    const old = document.getElementById('tls-alert-overlay');
                    if (old) old.remove();

                    const div = document.createElement('div');
                    div.id = 'tls-alert-overlay';

                    div.style.position = 'fixed';
                    div.style.top = '0';
                    div.style.left = '0';
                    div.style.right = '0';
                    div.style.bottom = '0';
                    div.style.background = 'rgba(0, 0, 0, 0.85)';
                    div.style.zIndex = '2147483647';
                    div.style.display = 'flex';
                    div.style.alignItems = 'center';
                    div.style.justifyContent = 'center';
                    div.style.backdropFilter = 'blur(5px)';
                    div.style.animation = 'tls-fade-in 0.3s ease';

                    const card = document.createElement('div');
                    card.className = 'tls-alert-card';
                    card.style.background = 'linear-gradient(135deg, #1a1a2e, #16213e)';
                    card.style.padding = '40px';
                    card.style.borderRadius = '24px';
                    card.style.textAlign = 'center';
                    card.style.color = 'white';
                    card.style.border = '2px solid #00ff88';
                    card.style.boxShadow = '0 0 50px rgba(0, 255, 136, 0.3)';
                    card.style.animation = 'tls-bounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    card.style.maxWidth = '90%';
                    card.style.width = '400px';

                    const icon = document.createElement('div');
                    icon.className = 'tls-icon';
                    icon.style.fontSize = '64px';
                    icon.style.marginBottom = '20px';
                    icon.style.animation = 'tls-pulse 1s infinite';
                    icon.textContent = '🎉';

                    const title = document.createElement('h1');
                    title.style.fontSize = '32px';
                    title.style.margin = '0 0 10px 0';
                    title.style.color = '#00ff88';
                    title.style.fontFamily = 'system-ui, sans-serif';
                    title.style.fontWeight = '800';
                    title.textContent = 'СЛОТЫ НАЙДЕНЫ!';

                    const time = document.createElement('div');
                    time.className = 'tls-time';
                    time.style.fontSize = '24px';
                    time.style.fontWeight = '600';
                    time.style.marginBottom = '20px';
                    time.style.color = '#fff';
                    time.style.fontFamily = 'monospace';
                    time.textContent = new Date().toLocaleTimeString('ru-RU');

                    const message = document.createElement('p');
                    message.style.color = '#aaa';
                    message.style.marginBottom = '30px';
                    message.style.fontSize = '16px';
                    message.style.fontFamily = 'system-ui, sans-serif';
                    message.textContent = 'Срочно проверьте доступные даты!';

                    const button = document.createElement('button');
                    button.style.background = '#00ff88';
                    button.style.color = '#000';
                    button.style.border = 'none';
                    button.style.padding = '16px 32px';
                    button.style.fontSize = '18px';
                    button.style.fontWeight = 'bold';
                    button.style.borderRadius = '12px';
                    button.style.cursor = 'pointer';
                    button.style.transition = 'transform 0.2s';
                    button.style.width = '100%';
                    button.style.fontFamily = 'system-ui, sans-serif';
                    button.textContent = 'Я вижу!';

                    button.addEventListener('mouseenter', () => {
                        button.style.transform = 'scale(1.05)';
                        button.style.background = '#00cc6a';
                    });

                    button.addEventListener('mouseleave', () => {
                        button.style.transform = 'scale(1)';
                        button.style.background = '#00ff88';
                    });

                    const style = document.createElement('style');
                    style.textContent = `
                        @keyframes tls-fade-in { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes tls-bounce { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                        @keyframes tls-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
                    `;

                    card.appendChild(icon);
                    card.appendChild(title);
                    card.appendChild(time);
                    card.appendChild(message);
                    card.appendChild(button);
                    div.appendChild(card);
                    div.appendChild(style);
                    document.body.appendChild(div);
                    button.addEventListener('click', () => div.remove());
                }
            });
        }
    } catch (e) {
        console.error('❌ Ошибка визуального уведомления:', e);
    }

    // Звуковое уведомление
    if (soundEnabled) {
        try {
            let tabs = await chrome.tabs.query({});
            let targetTab = tabs.find(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));

            if (targetTab) {
                await safeExecuteScript({
                    target: { tabId: targetTab.id },
                    func: () => {
                        const ctx = new AudioContext();
                        for (let r = 0; r < 3; r++) {
                            [523, 659, 784, 1047, 784, 659].forEach((freq, i) => {
                                const o = ctx.createOscillator();
                                const g = ctx.createGain();
                                o.connect(g);
                                g.connect(ctx.destination);
                                o.frequency.value = freq;
                                o.type = 'square';
                                const startTime = ctx.currentTime + r * 0.8 + i * 0.12;
                                g.gain.setValueAtTime(0.5, startTime);
                                g.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
                                o.start(startTime);
                                o.stop(startTime + 0.1);
                            });
                        }
                        console.log('🔊 ЗВУК: СЛОТ НАЙДЕН!!!');
                    }
                });
                console.log('🔊 Звук воспроизведён');
            }
        } catch (e) {
            console.error('🔊 Ошибка звука:', e.message);
        }
    }

    // Браузерное уведомление
    if (browserNotify) {
        try {
            await chrome.notifications.create('slots-found-' + now, {
                type: 'basic',
                iconUrl: 'icon128.png',
                title: '🎉 Найден свободный слот!',
                message: 'Есть свободное время для записи!',
                priority: 2,
                requireInteraction: true
            });
            console.log('🔔 Уведомление показано');
        } catch (e) {
            console.error('🔔 Ошибка уведомления:', e.message);
        }
    }

    // Telegram - используем универсальную функцию!
    await sendTelegramMessage(
        '🔔 <b>НАЙДЕН СВОБОДНЫЙ СЛОТ!</b>\n\n' +
        '⏰ ' + new Date().toLocaleString('ru-RU') + '\n\n' +
        '⚡ Срочно откройте страницу!'
    );
}

async function testTelegram(botToken, chatIds) {
    if (!botToken || !chatIds) {
        return { success: false, error: 'Укажите Bot Token и Chat IDs' };
    }

    const ids = chatIds.split(',').map(id => id.trim()).filter(id => id);
    const message = '✅ <b>Slot Monitor</b>\n\nТестовое сообщение!\n\n⏰ ' + new Date().toLocaleString('ru-RU');

    console.log(`📤 Тест Telegram (${ids.length} чатов)`);

    try {
        const promises = ids.map(chatId =>
            fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML'
                })
            }).then(r => r.ok)
        );

        const results = await Promise.all(promises);
        const allSuccess = results.every(r => r);

        return { success: allSuccess };
    } catch (e) {
        console.error('❌ Ошибка теста Telegram:', e);
        return { success: false, error: e.message };
    }
}
