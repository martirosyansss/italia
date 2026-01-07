import TelegramBot from 'node-telegram-bot-api';
import { settingsDb } from '../database.js';

let bot = null;
let pollingBot = null;

/**
 * Инициализация Telegram бота
 */
export function initTelegramBot() {
    const token = settingsDb.get('telegramBotToken');

    if (!token) {
        console.log('⚠️ Telegram бот не настроен. Укажите токен в настройках.');
        return null;
    }

    try {
        bot = new TelegramBot(token, { polling: false });
        console.log('✅ Telegram бот инициализирован');

        // Запускаем бота с polling для обработки команд
        startPollingBot(token);

        return bot;
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram бота:', error.message);
        return null;
    }
}

/**
 * Запуск бота в режиме polling для обработки команд
 */
function startPollingBot(token) {
    if (pollingBot) {
        return; // Уже запущен
    }

    try {
        pollingBot = new TelegramBot(token, { polling: true });
        console.log('🤖 Telegram бот запущен в режиме polling');

        // Команда /start
        pollingBot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const firstName = msg.from.first_name || 'пользователь';
            pollingBot.sendMessage(chatId,
                `👋 Привет, ${firstName}!\n\n` +
                `🇮🇹 Я бот для отслеживания слотов на запись в визовый центр Италии.\n\n` +
                `📋 Доступные команды:\n` +
                `/myid - узнать ваш Chat ID\n` +
                `/status - статус системы\n` +
                `/help - справка`
            );
        });

        // Команда /myid
        pollingBot.onText(/\/myid/, (msg) => {
            const chatId = msg.chat.id;
            pollingBot.sendMessage(chatId,
                `🆔 Ваш Chat ID: <code>${chatId}</code>\n\n` +
                `Используйте этот ID для настройки уведомлений.`,
                { parse_mode: 'HTML' }
            );
        });

        // Команда /status
        pollingBot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            const savedChatId = settingsDb.get('telegramChatId');
            const notificationsEnabled = settingsDb.get('notificationsEnabled') === 'true';
            const checkInterval = settingsDb.get('checkInterval') || '15';

            const isConfigured = savedChatId === String(chatId);

            pollingBot.sendMessage(chatId,
                `📊 <b>Статус системы</b>\n\n` +
                `🔔 Уведомления: ${notificationsEnabled ? '✅ Включены' : '❌ Выключены'}\n` +
                `⏱ Интервал проверки: ${checkInterval} мин\n` +
                `👤 Ваш Chat ID: <code>${chatId}</code>\n` +
                `📍 Настроен для вас: ${isConfigured ? '✅ Да' : '❌ Нет'}\n\n` +
                `${!isConfigured ? '⚠️ Чтобы получать уведомления, укажите ваш Chat ID в настройках системы.' : '✅ Вы будете получать уведомления о свободных слотах!'}`,
                { parse_mode: 'HTML' }
            );
        });

        // Команда /help
        pollingBot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            pollingBot.sendMessage(chatId,
                `📖 <b>Справка</b>\n\n` +
                `Этот бот отслеживает свободные слоты для записи в визовый центр Италии (TLS Contact).\n\n` +
                `<b>Команды:</b>\n` +
                `/myid - узнать ваш Chat ID\n` +
                `/status - статус системы и настроек\n` +
                `/help - эта справка\n\n` +
                `<b>Как настроить:</b>\n` +
                `1. Узнайте ваш Chat ID командой /myid\n` +
                `2. Укажите его в настройках веб-интерфейса\n` +
                `3. Включите уведомления\n\n` +
                `Когда появятся свободные слоты — вам придёт уведомление! 🎉`,
                { parse_mode: 'HTML' }
            );
        });

        pollingBot.on('polling_error', (error) => {
            console.error('❌ Telegram polling error:', error.message);
        });

    } catch (error) {
        console.error('❌ Ошибка запуска polling бота:', error.message);
    }
}

/**
 * Остановка polling бота
 */
export function stopPollingBot() {
    if (pollingBot) {
        pollingBot.stopPolling();
        pollingBot = null;
        console.log('🛑 Telegram polling остановлен');
    }
}

/**
 * Отправка уведомления в Telegram
 */
export async function sendTelegramNotification(message) {
    const token = settingsDb.get('telegramBotToken');
    const chatId = settingsDb.get('telegramChatId');

    if (!token || !chatId) {
        console.log('⚠️ Telegram не настроен. Уведомление не отправлено.');
        return false;
    }

    try {
        if (!bot) {
            bot = new TelegramBot(token, { polling: false });
        }

        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log('📨 Telegram уведомление отправлено');
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки Telegram уведомления:', error.message);
        return false;
    }
}

/**
 * Отправка уведомления о найденных слотах
 */
export async function sendNotification({ title, message, slots }) {
    const notificationsEnabled = settingsDb.get('notificationsEnabled') === 'true';

    if (!notificationsEnabled) {
        console.log('ℹ️ Уведомления отключены');
        return false;
    }

    // Формируем красивое сообщение
    let telegramMessage = `<b>🇮🇹 ${title}</b>\n\n`;
    telegramMessage += `${message}\n\n`;

    if (slots && slots.length > 0) {
        telegramMessage += `<b>📅 Доступные даты:</b>\n`;
        slots.slice(0, 10).forEach((slot, index) => {
            telegramMessage += `   ${index + 1}. ${slot.date || slot}\n`;
        });

        if (slots.length > 10) {
            telegramMessage += `   ...и ещё ${slots.length - 10} дат\n`;
        }
    }

    telegramMessage += `\n⏰ ${new Date().toLocaleString('ru-RU')}`;
    telegramMessage += `\n\n🔗 <a href="https://visas-it.tlscontact.com/ru-ru">Перейти на сайт TLS</a>`;

    return await sendTelegramNotification(telegramMessage);
}

/**
 * Тестирование подключения к Telegram
 */
export async function testTelegramConnection() {
    const token = settingsDb.get('telegramBotToken');
    const chatId = settingsDb.get('telegramChatId');

    if (!token || !chatId) {
        return {
            success: false,
            message: 'Укажите токен бота и Chat ID в настройках'
        };
    }

    try {
        const testBot = new TelegramBot(token, { polling: false });
        await testBot.sendMessage(chatId, '✅ Тестовое сообщение от TLS Appointment Manager\n\nПодключение успешно настроено!');

        return {
            success: true,
            message: 'Тестовое сообщение отправлено успешно'
        };
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
}

export default {
    initTelegramBot,
    stopPollingBot,
    sendTelegramNotification,
    sendNotification,
    testTelegramConnection
};
