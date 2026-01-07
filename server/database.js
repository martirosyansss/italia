import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'tls_appointments.db');

let db = null;

// Инициализация базы данных
async function initDatabase() {
  const SQL = await initSqlJs();

  // Загружаем существующую базу или создаём новую
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Создание таблиц
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      middleName TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      passportNumber TEXT NOT NULL,
      passportExpiry TEXT,
      birthDate TEXT,
      visaType TEXT DEFAULT 'tourist',
      preferredDates TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      status TEXT DEFAULT 'scheduled',
      confirmationNumber TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (clientId) REFERENCES clients(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS slot_checks (
      id TEXT PRIMARY KEY,
      checkTime TEXT DEFAULT CURRENT_TIMESTAMP,
      availableSlots TEXT,
      screenshot TEXT,
      status TEXT DEFAULT 'success',
      errorMessage TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Инициализация настроек по умолчанию
  const defaultSettings = [
    ['checkInterval', '15'],
    ['telegramBotToken', ''],
    ['telegramChatId', ''],
    ['notificationsEnabled', 'false'],
    ['autoBooking', 'false']
  ];

  defaultSettings.forEach(([key, value]) => {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  });

  saveDatabase();
  console.log('✅ База данных инициализирована');
  return db;
}

// Сохранение базы данных на диск
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Получение экземпляра базы данных
async function getDatabase() {
  if (!db) {
    await initDatabase();
  }
  return db;
}

// Вспомогательная функция для выполнения запросов
function runQuery(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// Функции для работы с клиентами
export const clientsDb = {
  getAll: () => getAll('SELECT * FROM clients ORDER BY createdAt DESC'),

  getById: (id) => getOne('SELECT * FROM clients WHERE id = ?', [id]),

  create: (client) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    runQuery(`
      INSERT INTO clients (id, firstName, lastName, middleName, email, phone, passportNumber, passportExpiry, birthDate, visaType, preferredDates, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, client.firstName, client.lastName, client.middleName || null, client.email, client.phone, client.passportNumber, client.passportExpiry || null, client.birthDate || null, client.visaType || 'tourist', client.preferredDates || null, client.notes || null, now, now]);
    return { id, ...client, createdAt: now, updatedAt: now };
  },

  update: (id, client) => {
    const now = new Date().toISOString();
    runQuery(`
      UPDATE clients SET firstName = ?, lastName = ?, middleName = ?, email = ?, phone = ?, passportNumber = ?, passportExpiry = ?, birthDate = ?, visaType = ?, preferredDates = ?, status = ?, notes = ?, updatedAt = ?
      WHERE id = ?
    `, [client.firstName, client.lastName, client.middleName || null, client.email, client.phone, client.passportNumber, client.passportExpiry || null, client.birthDate || null, client.visaType, client.preferredDates || null, client.status, client.notes || null, now, id]);
    return { id, ...client, updatedAt: now };
  },

  delete: (id) => {
    runQuery('DELETE FROM clients WHERE id = ?', [id]);
    return { deleted: true };
  },

  updateStatus: (id, status) => {
    runQuery('UPDATE clients SET status = ?, updatedAt = ? WHERE id = ?', [status, new Date().toISOString(), id]);
  }
};

// Функции для работы с проверками слотов
export const slotChecksDb = {
  getAll: (limit = 50) => getAll('SELECT * FROM slot_checks ORDER BY checkTime DESC LIMIT ?', [limit]),

  getLatest: () => getOne('SELECT * FROM slot_checks ORDER BY checkTime DESC LIMIT 1'),

  create: (check) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    runQuery(`
      INSERT INTO slot_checks (id, checkTime, availableSlots, screenshot, status, errorMessage)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, now, JSON.stringify(check.availableSlots || []), check.screenshot || null, check.status || 'success', check.errorMessage || null]);
    return { id, checkTime: now, ...check };
  }
};

// Функции для работы с настройками
export const settingsDb = {
  getAll: () => {
    const rows = getAll('SELECT * FROM settings');
    return rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
  },

  get: (key) => {
    const row = getOne('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  },

  set: (key, value) => {
    runQuery('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  },

  setMultiple: (settings) => {
    for (const [key, value] of Object.entries(settings)) {
      runQuery('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }
};

// Функции для работы с записями
export const appointmentsDb = {
  getAll: () => getAll(`
    SELECT a.*, c.firstName, c.lastName 
    FROM appointments a 
    LEFT JOIN clients c ON a.clientId = c.id 
    ORDER BY a.date DESC
  `),

  getByClientId: (clientId) => getAll('SELECT * FROM appointments WHERE clientId = ?', [clientId]),

  create: (appointment) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    runQuery(`
      INSERT INTO appointments (id, clientId, date, time, confirmationNumber, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, appointment.clientId, appointment.date, appointment.time || null, appointment.confirmationNumber || null, now]);
    return { id, ...appointment, createdAt: now };
  },

  updateStatus: (id, status) => {
    runQuery('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);
  }
};

// Экспорт инициализации
export { initDatabase, getDatabase };
export default { initDatabase, getDatabase, clientsDb, slotChecksDb, settingsDb, appointmentsDb };
