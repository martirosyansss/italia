// Content Script - выполняется на странице TLS Contact

const NO_SLOTS_KEYWORDS = [
    "we currently don't have any appointment slots available",
    "no slots are currently available",
    "no appointment slots",
    "please check this page regularly"
];

const CAPTCHA_KEYWORDS = [
    'verify you are human',
    'checking your browser',
    'attention required',
    'captcha',
    'cloudflare'
];

const RATE_LIMIT_KEYWORDS = [
    'error 1015',
    'rate limited',
    'too many requests',
    'temporarily blocked',
    'access denied',
    'sorry, you have been blocked',
    'you have been blocked',
    'unable to access'
];

// Слушаем сообщения от background/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkSlots') {
        const result = checkForSlots();
        sendResponse(result);
    } else if (message.action === 'hideIndicator') {
        hideIndicator();
        sendResponse({ success: true });
    } else if (message.action === 'showIndicator') {
        showIndicator();
        sendResponse({ success: true });
    }
    return true;
});

function analyzePageState() {
    const pageText = (document.body?.innerText || '').toLowerCase();
    const url = location.href.toLowerCase();
    const hasNoSlots = NO_SLOTS_KEYWORDS.some(keyword => pageText.includes(keyword.toLowerCase()));
    const hasCaptcha = CAPTCHA_KEYWORDS.some(keyword => pageText.includes(keyword));
    const hasRateLimit = RATE_LIMIT_KEYWORDS.some(keyword => pageText.includes(keyword));
    const isLoginPage = url.includes('auth') || url.includes('login') || pageText.includes('sign in');
    const isAppointmentPage = url.includes('appointment') || url.includes('booking') || url.includes('schedule');
    const hasTlsFooter = pageText.includes('tlscontact') && pageText.includes('all rights reserved');
    const isLoaded = pageText.length > 500 && hasTlsFooter;

    let state = 'unknown';
    let reason = 'Состояние не распознано';
    let hasSlots = false;

    if (hasRateLimit) {
        state = 'rate_limited';
        reason = 'Обнаружен rate limit или блокировка';
    } else if (hasNoSlots) {
        state = 'no_slots';
        reason = 'Найдена фраза об отсутствии слотов';
    } else if (hasCaptcha) {
        state = 'captcha';
        reason = 'Обнаружен challenge/CAPTCHA';
    } else if (!isLoaded) {
        state = 'loading';
        reason = 'Страница ещё не прогрузилась';
    } else if (isLoginPage) {
        state = 'auth';
        reason = 'Открыта страница логина';
    } else if (!isAppointmentPage) {
        state = 'not_appointment';
        reason = 'Открыта не страница записи';
    } else {
        state = 'potential_slots';
        reason = 'Страница записи загружена без фразы no-slots';
        hasSlots = true;
    }

    return {
        state,
        reason,
        hasSlots,
        url,
        textLength: pageText.length
    };
}

function checkForSlots() {
    const result = analyzePageState();

    if (result.hasSlots) {
        console.log('✅ TLS Monitor: возможны слоты', result.reason);
    } else {
        console.log('🔍 TLS Monitor:', result.reason);
    }

    return result;
}

// Показать индикатор
function showIndicator() {
    const existing = document.getElementById('tls-ext-indicator');
    if (existing) return;

    const div = document.createElement('div');
    div.id = 'tls-ext-indicator';
    const box = document.createElement('div');
    box.id = 'tls-indicator-box';
    box.style.position = 'fixed';
    box.style.bottom = '10px';
    box.style.right = '10px';
    box.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
    box.style.color = 'white';
    box.style.padding = '8px 12px';
    box.style.borderRadius = '8px';
    box.style.fontFamily = '-apple-system, sans-serif';
    box.style.fontSize = '12px';
    box.style.zIndex = '999999';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.gap = '8px';
    box.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    box.style.cursor = 'pointer';

    const flag = document.createElement('span');
    flag.textContent = '🇮🇹';

    const title = document.createElement('span');
    title.textContent = 'TLS Monitor';

    const dot = document.createElement('span');
    dot.id = 'tls-status-dot';
    dot.style.width = '6px';
    dot.style.height = '6px';
    dot.style.background = '#0f0';
    dot.style.borderRadius = '50%';
    dot.style.animation = 'pulse 1s infinite';

    const close = document.createElement('span');
    close.style.fontSize = '10px';
    close.style.color = '#888';
    close.textContent = '✕';

    const style = document.createElement('style');
    style.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}';

    box.appendChild(flag);
    box.appendChild(title);
    box.appendChild(dot);
    box.appendChild(close);
    div.appendChild(box);
    div.appendChild(style);
    document.body.appendChild(div);

    // Добавляем обработчик без inline onclick (CSP)
    box.addEventListener('click', () => div.remove());
}

// Скрыть индикатор
function hideIndicator() {
    const indicator = document.getElementById('tls-ext-indicator');
    if (indicator) {
        indicator.remove();
        console.log('🛑 TLS Monitor: Остановлен');
    }
}

// При загрузке страницы — проверяем статус мониторинга
window.addEventListener('load', async () => {
    console.log('🇮🇹 TLS Slot Monitor: Страница загружена');

    // Проверяем, запущен ли мониторинг
    try {
        const { isRunning } = await chrome.storage.local.get('isRunning');

        if (isRunning) {
            // Показываем индикатор только если мониторинг запущен
            setTimeout(showIndicator, 2000);

            // Не шлём сигнал о слотах автоматически при загрузке страницы.
            // Фактическая проверка выполняется background worker, чтобы избежать ложных срабатываний.
            checkForSlots();
        } else {
            console.log('💤 TLS Monitor: Мониторинг не запущен');
        }
    } catch (e) {
        console.log('⚠️ TLS Monitor: Ошибка проверки статуса');
    }
});
