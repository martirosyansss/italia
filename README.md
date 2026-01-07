# 🇮🇹 TLS Appointment Manager

Профессиональная система управления записями в посольство Италии через TLS Contact.

![Status](https://img.shields.io/badge/status-active-success)
![Version](https://img.shields.io/badge/version-1.0.0-blue)

## ✨ Возможности

- 📋 **Управление клиентами** — добавление, редактирование и отслеживание статуса клиентов
- 🔍 **Мониторинг слотов** — автоматическая проверка свободных мест для записи
- ⏰ **Планировщик** — настраиваемые интервалы проверки (5-60 минут)
- 📱 **Telegram уведомления** — мгновенные оповещения о найденных слотах
- 🎨 **Современный UI** — премиум дизайн с glassmorphism и анимациями

## 🛠️ Технологии

| Компонент | Технологии |
|-----------|------------|
| **Frontend** | React 18, Vite, Lucide React |
| **Backend** | Node.js, Express |
| **Database** | SQLite (better-sqlite3) |
| **Автоматизация** | Puppeteer |
| **Уведомления** | Telegram Bot API |

## 📦 Установка

### 1. Клонирование и зависимости

```bash
# Backend
cd /Users/sergeymartirosyan/Documents/italia/server
npm install

# Frontend  
cd /Users/sergeymartirosyan/Documents/italia/client
npm install
```

### 2. Запуск

```bash
# Терминал 1 — Backend (порт 3001)
cd /Users/sergeymartirosyan/Documents/italia/server
npm run dev

# Терминал 2 — Frontend (порт 5173)
cd /Users/sergeymartirosyan/Documents/italia/client
npm run dev
```

### 3. Открыть приложение

Перейдите на http://localhost:5173

## 🔧 Первоначальная настройка

### Cloudflare проверка

> ⚠️ **Важно!** При первом запуске проверки слотов откроется браузер Chrome.  
> Вам нужно **один раз вручную** пройти проверку "Я не робот" на сайте TLS Contact.  
> После этого система запомнит сессию и будет работать автоматически.

### Telegram уведомления (опционально)

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Получите свой Chat ID через [@userinfobot](https://t.me/userinfobot)
3. Введите данные в разделе **Настройки** приложения

## 📁 Структура проекта

```
italia/
├── client/                 # React приложение
│   ├── src/
│   │   ├── components/     # UI компоненты
│   │   ├── hooks/          # React хуки
│   │   ├── styles/         # CSS стили
│   │   └── App.jsx
│   ├── index.html
│   └── package.json
│
├── server/                 # Node.js сервер
│   ├── services/
│   │   ├── puppeteer.js    # Автоматизация браузера
│   │   ├── scheduler.js    # Планировщик задач
│   │   └── notifier.js     # Telegram уведомления
│   ├── database.js         # SQLite база данных
│   ├── server.js           # Express API
│   └── package.json
│
├── browser-profile/        # Профиль Chrome (создаётся автоматически)
└── README.md
```

## 🔐 API Endpoints

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `GET` | `/api/clients` | Список всех клиентов |
| `POST` | `/api/clients` | Добавить клиента |
| `PUT` | `/api/clients/:id` | Обновить клиента |
| `DELETE` | `/api/clients/:id` | Удалить клиента |
| `GET` | `/api/slots/latest` | Последняя проверка |
| `POST` | `/api/slots/check` | Запустить проверку |
| `GET` | `/api/settings` | Получить настройки |
| `PUT` | `/api/settings` | Сохранить настройки |
| `GET` | `/api/stats` | Статистика системы |

## ⚠️ Важные замечания

1. **Cloudflare защита** — сайт TLS Contact использует Cloudflare, поэтому при первом запуске требуется ручная авторизация
2. **Интервал проверки** — рекомендуется 10-15 минут, слишком частые запросы могут привести к блокировке
3. **Легальность** — используйте для личных целей, массовое бронирование может нарушать условия TLS Contact

## 📄 Лицензия

MIT License

---

Разработано с ❤️ для упрощения процесса записи в посольство Италии
