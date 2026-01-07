// Background Service Worker v5.0
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 5 * 60 * 1000;

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
    const { isRunning } = await chrome.storage.local.get('isRunning');
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
    const { botToken } = await chrome.storage.local.get('botToken');
    if (!botToken) {
        console.log('🤖 Telegram: токен не указан');
        return;
    }

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

    // Создаём alarm для polling каждые 5 секунд (быстрый ответ на команды)
    await chrome.alarms.create('telegramPolling', {
        delayInMinutes: 0.05,   // Первый запуск через 3 секунды
        periodInMinutes: 0.083  // Каждые 5 секунд (5/60 = 0.083)
    });

    pollTelegram(); // Первый запрос сразу
}

async function pollTelegram() {
    try {
        const { botToken } = await chrome.storage.local.get('botToken');
        if (!botToken) return;

        const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${telegramOffset}&timeout=1`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                telegramOffset = update.update_id + 1;
                await handleTelegramMessage(update, botToken);
            }
        }
    } catch (e) {
        // Тихая ошибка
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
    const settings = await chrome.storage.local.get(['checkInterval', 'tlsUrl']);
    // Enforce minimum interval и добавляем jitter
    const baseInterval = Math.max(settings.checkInterval || 120, MIN_INTERVAL_SEC);
    const jitter = getRandomJitter();
    const totalIntervalSec = baseInterval + jitter;
    const intervalMinutes = totalIntervalSec / 60;

    console.log('🚀 Slot Monitor: Запуск мониторинга');
    console.log(`⏱️ Интервал: ${baseInterval} сек + ${jitter} сек jitter = ${totalIntervalSec} сек`);

    lastNotificationTime = 0;
    await chrome.storage.local.set({ rateLimitBackoff: 0 }); // Reset backoff on manual start

    // 🆕 Автоматически открыть страницу TLS если её нет
    const allTabs = await chrome.tabs.query({});
    const hasTlsTab = allTabs.some(tab => tab.url && tab.url.includes('tlscontact.com'));

    if (!hasTlsTab) {
        // Всегда открываем базовую страницу (не appointment-booking)
        const startUrl = 'https://visas-it.tlscontact.com/en-us/';
        console.log('🌐 Открываем страницу TLS:', startUrl);
        await chrome.tabs.create({ url: startUrl, active: true });
        // Ждём загрузки страницы
        await new Promise(r => setTimeout(r, 3000));
    }

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
}

function stopMonitoring() {
    console.log('🛑 Slot Monitor: Остановка');
    chrome.alarms.clear('checkSlots');
    chrome.alarms.clear('keepAlive');
    // ⚠️ НЕ останавливаем telegramPolling, чтобы можно было удалённо запустить через /on
    // chrome.alarms.clear('telegramPolling');
    console.log('🤖 Мониторинг остановлен (Telegram polling активен)');

    chrome.storage.local.set({ isRunning: false });
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
    const { isRunning, tlsUrl } = await chrome.storage.local.get(['isRunning', 'tlsUrl']);
    if (!isRunning || !tlsUrl) return;

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

// 🧨 HARD RESET: Закрыть вкладку и начать заново
async function hardResetAndRestart(tabId, reason) {
    console.log(`🧨 HARD RESET TRIGGERED: ${reason}`);
    await sendTelegramMessage(`🔄 <b>АВТО-СБРОС</b>\n\nПричина: ${reason}\n\nПерезапускаю процесс...`);

    try {
        if (tabId) {
            const tab = await safeGetTab(tabId);
            if (tab) {
                await chrome.tabs.remove(tabId);
                console.log('🧨 Вкладка закрыта');
            } else {
                console.log('🧨 Вкладка уже была закрыта');
            }
        }
    } catch (e) {
        console.error('❌ Ошибка закрытия вкладки:', e.message);
    }

    // Даем браузеру время и сбрасываем состояние
    await new Promise(r => setTimeout(r, 2000));

    // Перезапуск мониторинга (он сам откроет вкладку)
    console.log('🚀 Перезапуск startMonitoring()...');
    await startMonitoring();
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

    const { isRunning, tlsUrl, autoRefresh } = await chrome.storage.local.get(['isRunning', 'tlsUrl', 'autoRefresh']);
    console.log('📊 Настройки:', { isRunning, tlsUrl: tlsUrl?.substring(0, 50) + '...', autoRefresh });

    if (!isRunning) {
        console.log('⏸️ Мониторинг не запущен, выход');
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

    // Получаем ВСЕ вкладки
    const allTabs = await chrome.tabs.query({});
    console.log('📑 Всего вкладок:', allTabs.length);

    // Фильтруем вкладки по URL
    let targetTab = null;
    if (tlsUrl) {
        try {
            const userUrl = new URL(tlsUrl);
            const hostname = userUrl.hostname.toLowerCase();
            // Получаем корневой домен (например, tlscontact.com)
            const parts = hostname.split('.');
            const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;

            console.log('🌐 Ищем вкладки с доменом:', hostname, '(root:', rootDomain + ')');

            // 1. Сначала ищем точное совпадение хоста
            for (const tab of allTabs) {
                if (tab.url && tab.url.toLowerCase().includes(hostname)) {
                    targetTab = tab;
                    console.log('✅ Найдена вкладка (хост):', tab.id, tab.url);
                    break;
                }
            }

            // 2. Если не нашли, ищем по корневому домену (на случай редиректа на login.domain.com)
            if (!targetTab) {
                for (const tab of allTabs) {
                    if (tab.url && tab.url.toLowerCase().includes(rootDomain)) {
                        targetTab = tab;
                        console.log('⚠️ Найдена вкладка (root domain):', tab.id, tab.url.substring(0, 80));
                        break;
                    }
                }
            }

            // 3. Ищем auth.* поддомен (страница логина)
            if (!targetTab) {
                for (const tab of allTabs) {
                    if (tab.url && tab.url.toLowerCase().includes('auth.') && tab.url.toLowerCase().includes('tlscontact')) {
                        targetTab = tab;
                        console.log('🔐 Найдена вкладка (auth login):', tab.id, tab.url.substring(0, 80));
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('❌ Неверный URL:', e.message);
        }
    }

    if (!targetTab) {
        console.log('⚠️ Вкладка не найдена. Откройте сайт в браузере.');
        await addHistoryEntry('skip', 'Вкладка TLS не найдена');
        const stats = await chrome.storage.local.get(['checkCount']);
        await chrome.storage.local.set({
            checkCount: (stats.checkCount || 0) + 1,
            lastCheck: new Date().toLocaleTimeString('ru-RU')
        });
        return;
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
            console.log('✅ Страница обновлена');
        } catch (e) {
            console.error('🔄 Ошибка обновления страницы:', e.message);
            // Fallback на reload только в крайнем случае
            try {
                await chrome.tabs.reload(targetTab.id);
                await waitForPageLoad(targetTab.id, 5000);
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
            const { autoLogin, loginEmail, loginPassword } = await chrome.storage.local.get(['autoLogin', 'loginEmail', 'loginPassword']);

            // Проверяем является ли это страницей логина/auth
            const isAuthPage = targetTab.url.includes('/auth') || targetTab.url.includes('auth.');

            const isLandingPage = targetTab.url.includes('/vac/') ||
                targetTab.url.includes('/travel-groups') ||
                isLanguagePage ||
                isAuthPage ||
                (isLogout[0].result.text && isLogout[0].result.text.includes('please select your place of residence'));

            if (isLandingPage) {
                console.log('🌍 Обнаружена промежуточная/auth страница. Auth:', isAuthPage);

                // 1. Если есть прямая ссылка для входа И НЕ на travel-groups И НЕ уже на auth — редирект
                const { loginUrl } = await chrome.storage.local.get('loginUrl');
                if (loginUrl && loginUrl.startsWith('http') && !targetTab.url.includes('/travel-groups') && !isAuthPage) {
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
                        await safeExecuteScript({
                            target: { tabId: targetTab.id },
                            func: () => {
                                const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], .btn'));
                                const selectBtn = allElements.find(el => {
                                    const text = (el.innerText || '').toLowerCase().trim();
                                    return text === 'select' || text.includes('select');
                                });
                                if (selectBtn) {
                                    console.log('✅ Кликаем Select:', selectBtn.innerText);
                                    selectBtn.click();
                                    return true;
                                }
                                return false;
                            }
                        });
                        await new Promise(r => setTimeout(r, 5000));
                        return checkForSlots(recursionDepth + 1);
                    } catch (e) {
                        console.error('❌ Ошибка клика Select:', e);
                    }
                }

                // 3. Авто-логин (Human-Like Typing Version)
                if (autoLogin && loginEmail && loginPassword && isAuthPage) {
                    console.log('🤖 START: Human-Like Login Process...');

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
                            await hardResetAndRestart(targetTab.id, 'Авто-логин застрял (таймаут 15с)');
                            return;
                        }

                        console.log('🔄 Restarting check loop...');
                        return checkForSlots(recursionDepth + 1);

                    } catch (e) {
                        console.error('❌ Auto-login failed:', e);
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
                        <div id="tls-close-btn" class="tls-close-btn" style="cursor: pointer; padding: 4px; opacity: 0.6; transition: opacity 0.2s;">
                            ✕
                        </div>
                    </div>
                    <style>
                        @keyframes tls-pulse {
                            0% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.4); }
                            70% { box-shadow: 0 0 0 6px rgba(0, 255, 136, 0); }
                            100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
                        }
                        .tls-close-btn:hover { opacity: 1 !important; }
                    </style>
                `;
                document.body.appendChild(div);

                document.getElementById('tls-close-btn').addEventListener('click', () => {
                    document.getElementById('tls-panel').style.display = 'none';
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

                // 🛡️ RATE LIMIT DETECTION
                const rateLimitKeywords = ['error 1015', 'you are being rate limited', 'too many requests', 'temporarily blocked'];
                const matchedKeyword = rateLimitKeywords.find(kw => pageText.includes(kw));

                if (matchedKeyword) {
                    console.log('🚫 Rate limit keyword found:', matchedKeyword);
                    return {
                        hasSlots: false,
                        textLength: pageText.length,
                        debugText: pageText.substring(0, 200),
                        isRateLimited: true,
                        matchedKeyword
                    };
                }

                // 🛡️ ЗАЩИТА ОТ ЛОЖНЫХ СИГНАЛОВ

                // 1. Проверяем что мы на правильной странице (appointment/booking)
                const isAppointmentPage = location.href.includes('appointment') ||
                    location.href.includes('booking') ||
                    location.href.includes('schedule');

                // 2. Проверяем признаки страниц ошибок
                const errorKeywords = ['error', 'something went wrong', 'page not found', '404', '500', 'unavailable', 'maintenance'];
                const hasError = errorKeywords.some(kw => pageText.includes(kw) && pageText.length < 1000);

                // 3. Проверяем что это НЕ страница логина
                const isLoginPage = pageText.includes('login') || pageText.includes('sign in') || pageText.includes('password');

                // 4. Проверяем ключевые слова "нет слотов" (ВАЖНО: проверяем ПЕРВЫМ!)
                const hasNoSlots = keywordList.some(keyword => {
                    const normalizedKeyword = normalize(keyword);
                    const match = pageText.includes(normalizedKeyword);
                    console.log(`🔍 Проверка фразы: "${normalizedKeyword}" -> ${match ? '✅ НАЙДЕНО' : '❌ НЕ НАЙДЕНО'}`);
                    return match;
                });

                // 5. 🛡️ CAPTCHA DETECTION (только если НЕ найдено "no slots" - иначе страница работает!)
                // Убраны слишком общие слова типа "please wait"
                const captchaKeywords = [
                    'verify you are human', 'checking your browser',
                    'ddos protection', 'ray id:', 'attention required'
                ];
                const hasCaptcha = !hasNoSlots && captchaKeywords.some(kw => pageText.includes(kw));
                const hasCaptchaElement = !hasNoSlots && (
                    document.querySelector('[class*="captcha"]') ||
                    document.querySelector('[class*="turnstile"]') ||
                    document.querySelector('iframe[src*="captcha"]') ||
                    document.querySelector('iframe[src*="turnstile"]')
                );

                // 6. Проверяем что страница ПОЛНОСТЬЮ загружена (должен быть TLScontact footer)
                const hasFooter = pageText.includes('tlscontact') && pageText.includes('all rights reserved');
                const isPageLoaded = pageText.length > 500 && hasFooter;
                const isOnAuthUrl = location.href.includes('auth') || location.href.includes('login');

                // 🎯 НАДЁЖНАЯ ЛОГИКА С ЗАЩИТОЙ ОТ ЛОЖНЫХ СИГНАЛОВ:

                let slotsAvailable = false;
                let reason = '';

                // ВАЖНО: Сначала проверяем hasNoSlots - если найдено, страница 100% работает!
                if (hasNoSlots) {
                    // Явно написано "нет слотов" - страница работает, слотов нет
                    slotsAvailable = false;
                    reason = 'Найдена фраза "нет слотов"';
                } else if (!isPageLoaded) {
                    // Страница не загружена полностью - не сигналим
                    slotsAvailable = false;
                    reason = 'Страница не загружена (нет footer TLScontact)';
                } else if (hasCaptcha || hasCaptchaElement) {
                    // CAPTCHA/Challenge - не сигналим, уведомляем
                    slotsAvailable = false;
                    reason = '⚠️ CAPTCHA! Требуется ручное вмешательство';
                } else if (hasError) {
                    // Страница с ошибкой - не сигналим
                    slotsAvailable = false;
                    reason = 'Страница с ошибкой';
                } else if (isOnAuthUrl || (isLoginPage && !isAppointmentPage)) {
                    // Страница логина - не сигналим
                    slotsAvailable = false;
                    reason = 'Страница логина';
                } else if (!isAppointmentPage) {
                    // Не на странице бронирования - не сигналим
                    slotsAvailable = false;
                    reason = 'Не на странице appointment';
                } else {
                    // НА СТРАНИЦЕ APPOINTMENT, ЗАГРУЖЕНА, НЕТ CAPTCHA, НЕТ ФРАЗЫ "NO SLOTS" → СИГНАЛИМ!
                    slotsAvailable = true;
                    reason = '✅ Страница изменилась! Возможно есть слоты!';
                }

                console.log(`🎯 Результат: ${slotsAvailable ? '✅ СЛОТЫ ЕСТЬ' : '❌ Нет слотов'} (${reason})`);

                return {
                    hasSlots: slotsAvailable,
                    textLength: pageText.length,
                    debugText: pageText.substring(0, 200),
                    isRateLimited: false,
                    isAuthError: pageText.includes('invalid_grant') || pageText.includes('code not valid'),
                    reason: reason
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

        console.log('───────────────────────────────────────────');
        console.log('📊 РЕЗУЛЬТАТ ПРОВЕРКИ:');
        console.log('  → hasSlots:', results[0]?.result?.hasSlots);
        console.log('  → textLength:', results[0]?.result?.textLength);
        console.log('  → isRateLimited:', results[0]?.result?.isRateLimited);
        console.log('───────────────────────────────────────────');

        if (results && results[0] && results[0].result) {
            const { hasSlots, textLength, isRateLimited: pageRateLimited, isAuthError, reason } = results[0].result;

            // 🛑 AUTH ERROR (JSON response instead of HTML)
            if (isAuthError) {
                console.log('🚨 Auth Error detected (invalid_grant) -> Hard Reset');
                await hardResetAndRestart(targetTab.id, 'Auth Error: invalid_grant');
                return;
            }

            // 🛡️ RATE LIMIT DETECTION
            if (pageRateLimited) {
                console.log('🚫🚫🚫 RATE LIMIT ОБНАРУЖЕН! 🚫🚫🚫');
                await handleRateLimit();
                const afterBackoff = (await chrome.storage.local.get('rateLimitBackoff')).rateLimitBackoff;
                await addHistoryEntry('error', `⚠️ Rate limit! Ждём ${afterBackoff} мин...`);

                // 📨 Уведомление в Telegram
                await sendTelegramMessage(
                    `🚫 <b>RATE LIMIT!</b>\n\n` +
                    `Cloudflare заблокировал запросы.\n\n` +
                    `⏳ Пауза: <b>${afterBackoff} мин</b>\n\n` +
                    `Бот автоматически продолжит после паузы.`
                );
                return;
            }

            // 🧩 CAPTCHA DETECTION
            if (reason && reason.includes('CAPTCHA')) {
                console.log('🧩🧩🧩 CAPTCHA ОБНАРУЖЕНА! 🧩🧩🧩');
                await addHistoryEntry('error', '🧩 CAPTCHA! Зайдите в браузер');

                // 📨 Уведомление в Telegram
                await sendTelegramMessage(
                    `🧩 <b>CAPTCHA!</b>\n\n` +
                    `Cloudflare требует проверку.\n\n` +
                    `⚡ <b>Зайдите в браузер и пройдите проверку вручную!</b>\n\n` +
                    `После прохождения бот продолжит работу.`
                );
                return;
            }

            // 🛡️ ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА: Проверяем минимальную длину текста
            if (textLength < 300) {
                console.log('⚠️ Текст слишком короткий (' + textLength + ' символов), страница не загружена');
                await addHistoryEntry('skip', 'Страница загружается...');
                return;
            }

            if (hasSlots) {
                await addHistoryEntry('slots', '🎉 СЛОТЫ НАЙДЕНЫ!');
                await handleSlotsFound();
            } else {
                await addHistoryEntry('no_slots', 'Слотов нет');
                console.log('❌ Слотов нет');
            }
        } else {
            console.log('⚠️ Нет результата проверки');
            await addHistoryEntry('error', 'Нет результата');
        }
    } catch (e) {
        console.error('❌ Ошибка проверки:', e.message);
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
                    div.innerHTML = `
                        <div class="tls-alert-card">
                            <div class="tls-icon">🎉</div>
                            <h1>СЛОТЫ НАЙДЕНЫ!</h1>
                            <div class="tls-time">${new Date().toLocaleTimeString('ru-RU')}</div>
                            <p>Срочно проверьте доступные даты!</p>
                            <button>Я вижу!</button>
                        </div>
                        <style>
                            #tls-alert-overlay {
                                position: fixed;
                                top: 0; left: 0; right: 0; bottom: 0;
                                background: rgba(0, 0, 0, 0.85);
                                z-index: 2147483647;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                backdrop-filter: blur(5px);
                                animation: tls-fade-in 0.3s ease;
                            }
                            .tls-alert-card {
                                background: linear-gradient(135deg, #1a1a2e, #16213e);
                                padding: 40px;
                                border-radius: 24px;
                                text-align: center;
                                color: white;
                                border: 2px solid #00ff88;
                                box-shadow: 0 0 50px rgba(0, 255, 136, 0.3);
                                animation: tls-bounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                                max-width: 90%;
                                width: 400px;
                            }
                            .tls-icon { font-size: 64px; margin-bottom: 20px; animation: tls-pulse 1s infinite; }
                            #tls-alert-overlay h1 { font-size: 32px; margin: 0 0 10px 0; color: #00ff88; font-family: system-ui, sans-serif; font-weight: 800; }
                            .tls-time { font-size: 24px; font-weight: 600; margin-bottom: 20px; color: #fff; font-family: monospace; }
                            #tls-alert-overlay p { color: #aaa; margin-bottom: 30px; font-size: 16px; font-family: system-ui, sans-serif; }
                            #tls-alert-overlay button { background: #00ff88; color: #000; border: none; padding: 16px 32px; font-size: 18px; font-weight: bold; border-radius: 12px; cursor: pointer; transition: transform 0.2s; width: 100%; font-family: system-ui, sans-serif; }
                            #tls-alert-overlay button:hover { transform: scale(1.05); background: #00cc6a; }
                            @keyframes tls-fade-in { from { opacity: 0; } to { opacity: 1; } }
                            @keyframes tls-bounce { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                            @keyframes tls-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
                        </style>
                    `;
                    document.body.appendChild(div);
                    div.querySelector('button').addEventListener('click', () => div.remove());
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
