// Content Script - выполняется на странице TLS Contact

const NO_SLOTS_KEYWORDS = [
    "we currently don't have any appointment slots available",
    "no slots are currently available",
    "no appointment slots",
    "please check this page regularly"
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

function checkForSlots() {
    const pageText = document.body.innerText.toLowerCase();
    const hasNoSlots = NO_SLOTS_KEYWORDS.some(keyword =>
        pageText.includes(keyword.toLowerCase())
    );

    if (hasNoSlots) {
        console.log('🔍 TLS Monitor: Слотов нет');
        return { hasSlots: false };
    }

    console.log('✅ TLS Monitor: Возможно есть слоты!');
    return { hasSlots: true };
}

// Показать индикатор
function showIndicator() {
    const existing = document.getElementById('tls-ext-indicator');
    if (existing) return;

    const div = document.createElement('div');
    div.id = 'tls-ext-indicator';
    div.innerHTML = `
        <div id="tls-indicator-box" style="
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            font-family: -apple-system, sans-serif;
            font-size: 12px;
            z-index: 999999;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            cursor: pointer;
        ">
            <span>🇮🇹</span>
            <span>TLS Monitor</span>
            <span id="tls-status-dot" style="width:6px;height:6px;background:#0f0;border-radius:50%;animation:pulse 1s infinite"></span>
            <span style="font-size:10px;color:#888">✕</span>
        </div>
        <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style>
    `;
    document.body.appendChild(div);

    // Добавляем обработчик без inline onclick (CSP)
    document.getElementById('tls-indicator-box').addEventListener('click', () => div.remove());
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

            // Проверяем слоты
            const result = checkForSlots();
            if (result.hasSlots) {
                chrome.runtime.sendMessage({
                    action: 'slotsFound',
                    result: result
                });
            }
        } else {
            console.log('💤 TLS Monitor: Мониторинг не запущен');
        }
    } catch (e) {
        console.log('⚠️ TLS Monitor: Ошибка проверки статуса');
    }
});
