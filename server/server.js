import express from 'express';
import cors from 'cors';
import { initDatabase, clientsDb, slotChecksDb, settingsDb, appointmentsDb } from './database.js';
import { startScheduler, stopScheduler, runManualCheck, getSchedulerStatus } from './services/scheduler.js';
import { testTelegramConnection } from './services/notifier.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Логгирование запросов
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ============ CLIENTS API ============

// Получить всех клиентов
app.get('/api/clients', (req, res) => {
    try {
        const clients = clientsDb.getAll();
        res.json(clients);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить клиента по ID
app.get('/api/clients/:id', (req, res) => {
    try {
        const client = clientsDb.getById(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        res.json(client);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Создать клиента
app.post('/api/clients', (req, res) => {
    try {
        const { firstName, lastName, email, phone, passportNumber } = req.body;
        if (!firstName || !lastName || !email || !phone || !passportNumber) {
            return res.status(400).json({ error: 'Заполните все обязательные поля' });
        }
        const client = clientsDb.create(req.body);
        res.status(201).json(client);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить клиента
app.put('/api/clients/:id', (req, res) => {
    try {
        const client = clientsDb.update(req.params.id, req.body);
        res.json(client);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Удалить клиента
app.delete('/api/clients/:id', (req, res) => {
    try {
        clientsDb.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ SLOT CHECKS API ============

// Получить историю проверок
app.get('/api/slots/history', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const checks = slotChecksDb.getAll(limit);
        res.json(checks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить последнюю проверку
app.get('/api/slots/latest', (req, res) => {
    try {
        const latest = slotChecksDb.getLatest();
        res.json(latest || { message: 'Нет данных о проверках' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Запустить ручную проверку
app.post('/api/slots/check', async (req, res) => {
    try {
        const result = await runManualCheck();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Статус планировщика
app.get('/api/slots/scheduler', (req, res) => {
    try {
        const status = getSchedulerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Запустить/остановить планировщик
app.post('/api/slots/scheduler', (req, res) => {
    try {
        const { action } = req.body;
        if (action === 'start') {
            startScheduler();
            res.json({ status: 'started' });
        } else if (action === 'stop') {
            stopScheduler();
            res.json({ status: 'stopped' });
        } else {
            res.status(400).json({ error: 'Неверное действие. Используйте start или stop' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ APPOINTMENTS API ============

// Получить все записи
app.get('/api/appointments', (req, res) => {
    try {
        const appointments = appointmentsDb.getAll();
        res.json(appointments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Создать запись
app.post('/api/appointments', (req, res) => {
    try {
        const appointment = appointmentsDb.create(req.body);
        res.status(201).json(appointment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ SETTINGS API ============

// Получить все настройки
app.get('/api/settings', (req, res) => {
    try {
        const settings = settingsDb.getAll();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить настройки
app.put('/api/settings', (req, res) => {
    try {
        settingsDb.setMultiple(req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ STATS API ============

app.get('/api/stats', (req, res) => {
    try {
        const clients = clientsDb.getAll();
        const checks = slotChecksDb.getAll(10);
        const latestCheck = slotChecksDb.getLatest();
        const schedulerStatus = getSchedulerStatus();

        res.json({
            totalClients: clients.length,
            pendingClients: clients.filter(c => c.status === 'pending').length,
            scheduledClients: clients.filter(c => c.status === 'scheduled').length,
            completedClients: clients.filter(c => c.status === 'completed').length,
            lastCheck: latestCheck?.checkTime || null,
            totalChecks: checks.length,
            schedulerRunning: schedulerStatus.isRunning
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TELEGRAM API ============

// Тест Telegram соединения
app.post('/api/telegram/test', async (req, res) => {
    try {
        const result = await testTelegramConnection();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Запуск сервера с инициализацией базы данных
async function startServer() {
    try {
        await initDatabase();

        app.listen(PORT, () => {
            console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║   🇮🇹 TLS Appointment Manager - Server Started 🇮🇹   ║
  ╠══════════════════════════════════════════════════════╣
  ║   Port: ${PORT}                                        ║
  ║   API:  http://localhost:${PORT}/api                   ║
  ╚══════════════════════════════════════════════════════╝
      `);
        });
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();
