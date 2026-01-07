import cron from 'node-cron';
import { slotChecksDb, settingsDb } from '../database.js';
import { sendNotification } from './notifier.js';

let schedulerJob = null;
let isRunning = false;
let lastCheckTime = null;
let checkCount = 0;

/**
 * Запуск планировщика проверок
 * ПРИМЕЧАНИЕ: Автоматическая проверка через Puppeteer отключена.
 * Используйте скрипт в консоли браузера для мониторинга слотов.
 */
export function startScheduler() {
    if (schedulerJob) {
        console.log('⚠️ Планировщик уже запущен');
        return;
    }

    const interval = settingsDb.get('checkInterval') || '15';

    // Запускаем cron для отслеживания статуса
    schedulerJob = cron.schedule(`*/${interval} * * * *`, async () => {
        console.log(`⏰ [${new Date().toISOString()}] Планировщик активен (используйте скрипт в браузере)`);
        lastCheckTime = new Date().toISOString();
        checkCount++;
    });

    isRunning = true;
    console.log(`✅ Планировщик запущен. Интервал: ${interval} минут.`);
    console.log('💡 Для мониторинга слотов используйте Генератор скрипта');
}

/**
 * Остановка планировщика
 */
export function stopScheduler() {
    if (schedulerJob) {
        schedulerJob.stop();
        schedulerJob = null;
        isRunning = false;
        console.log('🛑 Планировщик остановлен');
    }
}

/**
 * Изменение интервала проверок
 */
export function updateSchedulerInterval(minutes) {
    settingsDb.set('checkInterval', String(minutes));

    if (isRunning) {
        stopScheduler();
        startScheduler();
    }

    console.log(`⏱️ Интервал изменён на ${minutes} минут`);
}

/**
 * Ручной запуск проверки - теперь просто возвращает инструкцию
 */
export async function runManualCheck() {
    console.log('👆 Ручная проверка...');
    console.log('💡 Используйте скрипт в консоли браузера для реальной проверки');

    lastCheckTime = new Date().toISOString();
    checkCount++;

    // Сохраняем запись
    slotChecksDb.create({
        availableSlots: [],
        status: 'info',
        errorMessage: 'Используйте скрипт в консоли браузера для мониторинга'
    });

    return {
        status: 'info',
        message: 'Откройте TLS Contact и используйте скрипт из Генератора',
        checkTime: lastCheckTime
    };
}

/**
 * Получение статуса планировщика
 */
export function getSchedulerStatus() {
    return {
        isRunning,
        interval: settingsDb.get('checkInterval') || '15',
        lastCheckTime,
        checkCount,
        browserRunning: false,
        browserChecking: false,
        note: 'Используйте скрипт в браузере'
    };
}

export default {
    startScheduler,
    stopScheduler,
    updateSchedulerInterval,
    runManualCheck,
    getSchedulerStatus
};
