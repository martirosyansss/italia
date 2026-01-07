// ================================================
// 🇮🇹 TLS SLOT MONITOR - Автоматический мониторинг
// ================================================
// 
// КАК ИСПОЛЬЗОВАТЬ:
// 1. Откройте страницу TLS Contact с календарём записи
// 2. Нажмите F12 (или Cmd+Option+I на Mac)
// 3. Перейдите на вкладку Console
// 4. Скопируйте и вставьте весь этот скрипт
// 5. Нажмите Enter
// 
// Скрипт начнёт проверять страницу каждые 30 секунд.
// Когда появится свободный слот — вы услышите звук! 🔔
// ================================================

(function () {
    'use strict';

    // ============ НАСТРОЙКИ ============
    const CONFIG = {
        checkIntervalSeconds: 30,      // Интервал проверки (секунды)
        autoRefresh: true,             // Автообновление страницы
        refreshIntervalSeconds: 60,    // Интервал обновления страницы (секунды)
        soundEnabled: true,            // Звуковое уведомление
        telegramEnabled: true,         // Telegram уведомления ВКЛЮЧЕНЫ!
        telegramBotToken: '8322252798:AAEiyLviy0OU884DmnlI059EnLE2DkikMXw',
        telegramChatId: '838786551'
    };

    // ============ СЕЛЕКТОРЫ ДЛЯ ПОИСКА СЛОТОВ ============
    const SLOT_SELECTORS = [
        // Календарные элементы TLS Contact
        '.calendar-day.available',
        '.slot.available',
        '[data-available="true"]',
        '.timeslot:not(.disabled):not(.unavailable)',
        // Активная кнопка бронирования
        'button:not([disabled]):contains("Book")',
        'button.book-button:not([disabled])',
        // Ссылки на выбор слота
        'a[href*="slot"]',
        'a[href*="appointment"]:not([disabled])'
    ];

    // Текст, указывающий на доступные слоты
    const AVAILABLE_KEYWORDS = [
        'select a time',
        'select a date',
        'choose your slot',
        'available slot',
        'book now',
        'confirm booking'
    ];

    // Текст, указывающий на ОТСУТСТВИЕ слотов (ТОЧНЫЕ ФРАЗЫ С TLS!)
    const NO_SLOTS_KEYWORDS = [
        "we currently don't have any appointment slots available",
        "no slots are currently available",
        "no appointment slots",
        "no available slots",
        "fully booked",
        "please check this page regularly"
    ];

    // ============ СОСТОЯНИЕ ============
    let isRunning = true;
    let checkCount = 0;
    let lastCheckTime = null;
    let slotsFound = false;

    // ============ ЗВУКОВОЕ УВЕДОМЛЕНИЕ ============
    function playAlertSound() {
        if (!CONFIG.soundEnabled) return;

        // Создаём аудио контекст
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Играем несколько нот для привлечения внимания
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

        notes.forEach((freq, i) => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = freq;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + i * 0.2);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.2 + 0.3);

            oscillator.start(audioContext.currentTime + i * 0.2);
            oscillator.stop(audioContext.currentTime + i * 0.2 + 0.3);
        });

        // Повторяем звук 3 раза
        setTimeout(playAlertSound, 2000);
    }

    // ============ TELEGRAM УВЕДОМЛЕНИЕ ============
    async function sendTelegramNotification(message) {
        if (!CONFIG.telegramEnabled || !CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;

        try {
            await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CONFIG.telegramChatId,
                    text: message,
                    parse_mode: 'HTML'
                })
            });
            console.log('📱 Telegram уведомление отправлено');
        } catch (error) {
            console.error('❌ Ошибка отправки в Telegram:', error);
        }
    }

    // ============ ПРОВЕРКА СЛОТОВ ============
    function checkForSlots() {
        checkCount++;
        lastCheckTime = new Date();

        console.log(`\n🔍 Проверка #${checkCount} — ${lastCheckTime.toLocaleTimeString()}`);

        const pageText = document.body.innerText.toLowerCase();

        // Проверяем, есть ли текст об отсутствии слотов
        const hasNoSlotsText = NO_SLOTS_KEYWORDS.some(keyword =>
            pageText.includes(keyword.toLowerCase())
        );

        if (hasNoSlotsText) {
            console.log('❌ Слотов нет (обнаружен текст об отсутствии)');
            updateStatusDisplay(false);
            return false;
        }

        // Ищем доступные элементы
        let foundElements = [];

        SLOT_SELECTORS.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    const text = el.innerText.toLowerCase();
                    const isClickable = el.offsetParent !== null; // Видимый элемент

                    if (isClickable && !text.includes('unavailable') && !text.includes('disabled')) {
                        foundElements.push({
                            selector: selector,
                            text: el.innerText.substring(0, 50),
                            element: el
                        });
                    }
                });
            } catch (e) { }
        });

        // Проверяем ключевые слова доступности
        const hasAvailableKeyword = AVAILABLE_KEYWORDS.some(keyword =>
            pageText.includes(keyword.toLowerCase())
        );

        // Определяем, есть ли слоты
        const potentialSlots = foundElements.filter(f =>
            f.text &&
            !f.text.includes('cancel') &&
            !f.text.includes('close') &&
            f.text.length > 0
        );

        if (potentialSlots.length > 0 && hasAvailableKeyword) {
            console.log('✅ НАЙДЕНЫ ПОТЕНЦИАЛЬНЫЕ СЛОТЫ!');
            console.log('Элементы:', potentialSlots);

            if (!slotsFound) {
                slotsFound = true;
                alertUser();
            }

            updateStatusDisplay(true, potentialSlots.length);
            return true;
        }

        console.log('⏳ Слотов пока нет. Продолжаю мониторинг...');
        updateStatusDisplay(false);
        return false;
    }

    // ============ УВЕДОМЛЕНИЕ ПОЛЬЗОВАТЕЛЯ ============
    function alertUser() {
        // Звук
        playAlertSound();

        // Меняем заголовок вкладки
        document.title = '🔔 СЛОТ НАЙДЕН! — TLS Contact';

        // Браузерное уведомление
        if (Notification.permission === 'granted') {
            new Notification('🇮🇹 TLS Slot Monitor', {
                body: 'Найден свободный слот! Срочно проверьте страницу!',
                icon: '🇮🇹',
                requireInteraction: true
            });
        }

        // Telegram
        sendTelegramNotification('🔔 <b>НАЙДЕН СВОБОДНЫЙ СЛОТ!</b>\n\n🇮🇹 TLS Contact Италия\n\n⚡ Срочно откройте страницу и записывайтесь!');

        // Мигание вкладки
        let blink = true;
        const blinkInterval = setInterval(() => {
            document.title = blink ? '🔔 СЛОТ НАЙДЕН!' : '⚡ СРОЧНО ПРОВЕРЬТЕ!';
            blink = !blink;
        }, 500);

        // Остановка мигания через 30 секунд
        setTimeout(() => clearInterval(blinkInterval), 30000);
    }

    // ============ СТАТУС НА СТРАНИЦЕ ============
    function createStatusDisplay() {
        const existing = document.getElementById('tls-monitor-status');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'tls-monitor-status';
        div.innerHTML = `
            <div style="
                position: fixed;
                top: 10px;
                right: 10px;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 12px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                z-index: 999999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                min-width: 250px;
            ">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <span style="font-size: 20px;">🇮🇹</span>
                    <strong>TLS Slot Monitor</strong>
                    <span id="monitor-dot" style="
                        width: 8px; 
                        height: 8px; 
                        background: #00ff88; 
                        border-radius: 50%; 
                        animation: pulse 1s infinite;
                    "></span>
                </div>
                <div id="monitor-status" style="color: #888; font-size: 12px;">Мониторинг активен...</div>
                <div id="monitor-count" style="color: #666; font-size: 11px; margin-top: 5px;">Проверок: 0</div>
                <div style="margin-top: 10px; display: flex; gap: 8px;">
                    <button id="monitor-stop" style="
                        background: #ff5252;
                        border: none;
                        color: white;
                        padding: 5px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 11px;
                    ">Стоп</button>
                    <button id="monitor-check" style="
                        background: #00c853;
                        border: none;
                        color: white;
                        padding: 5px 12px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 11px;
                    ">Проверить</button>
                </div>
            </div>
            <style>
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            </style>
        `;
        document.body.appendChild(div);

        document.getElementById('monitor-stop').onclick = () => stopMonitor();
        document.getElementById('monitor-check').onclick = () => checkForSlots();
    }

    function updateStatusDisplay(hasSlots, count = 0) {
        const status = document.getElementById('monitor-status');
        const countEl = document.getElementById('monitor-count');
        const dot = document.getElementById('monitor-dot');

        if (status) {
            if (hasSlots) {
                status.innerHTML = `<span style="color: #00ff88; font-weight: bold;">✅ СЛОТЫ НАЙДЕНЫ! (${count})</span>`;
                dot.style.background = '#00ff88';
            } else {
                status.innerHTML = `<span style="color: #ffa500;">⏳ Слотов нет. Жду...</span>`;
                dot.style.background = '#ffa500';
            }
        }

        if (countEl) {
            countEl.innerText = `Проверок: ${checkCount} | Последняя: ${lastCheckTime?.toLocaleTimeString() || '-'}`;
        }
    }

    function stopMonitor() {
        isRunning = false;
        console.log('🛑 Мониторинг остановлен');

        const status = document.getElementById('monitor-status');
        if (status) {
            status.innerHTML = '<span style="color: #ff5252;">🛑 Мониторинг остановлен</span>';
        }

        const dot = document.getElementById('monitor-dot');
        if (dot) {
            dot.style.background = '#ff5252';
            dot.style.animation = 'none';
        }
    }

    // ============ ГЛАВНЫЙ ЦИКЛ ============
    function startMonitoring() {
        console.log('🚀 TLS Slot Monitor запущен!');
        console.log(`⏱ Интервал проверки: ${CONFIG.checkIntervalSeconds} сек`);
        console.log(`🔄 Автообновление: ${CONFIG.autoRefresh ? 'Да' : 'Нет'}`);

        // Запрашиваем разрешение на уведомления
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // Создаём UI
        createStatusDisplay();

        // Первая проверка
        checkForSlots();

        // Периодическая проверка
        setInterval(() => {
            if (isRunning) {
                checkForSlots();
            }
        }, CONFIG.checkIntervalSeconds * 1000);

        // Автообновление страницы
        if (CONFIG.autoRefresh) {
            setInterval(() => {
                if (isRunning && !slotsFound) {
                    console.log('🔄 Обновление страницы...');
                    location.reload();
                }
            }, CONFIG.refreshIntervalSeconds * 1000);
        }
    }

    // ============ ЗАПУСК ============
    startMonitoring();

})();
