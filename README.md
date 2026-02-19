# RePort

Сервис аналитики для маркетологов. Позволяет подключиться к Яндекс.Директ и Яндекс.Метрике, собирать данные по рекламным кампаниям, трансформировать их и выгружать в Google Sheets.

## Возможности

- **Авторизация** — JWT-based аутентификация с поддержкой нескольких пользователей
- **Проекты** — группировка кампаний и отчётов по клиентам
- **Интеграции**:
  - Яндекс.Директ (OAuth)
  - Яндекс.Метрика (OAuth)
  - Google Sheets (OAuth)
- **Конструктор отчётов** с pipeline трансформаций:
  - `extract` — извлечение части строки (regex)
  - `group_by` — группировка и агрегация
  - `join` — объединение данных из разных источников
  - `rename` — переименование колонок
  - `filter` — фильтрация строк
  - `calculate` — вычисляемые поля
  - `sort` — сортировка
- **Экспорт** в Google Sheets
- **Расписание** — автоматический запуск отчётов по расписанию (APScheduler)

## Технологии

- **Backend**: FastAPI, SQLAlchemy, SQLite, Alembic
- **Frontend**: Next.js, TypeScript
- **Auth**: JWT (python-jose), bcrypt
- **External APIs**: httpx

## Локальная разработка

### Backend

```bash
cd backend

# Создать виртуальное окружение
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или: venv\Scripts\activate  # Windows

# Установить зависимости
pip install -r requirements.txt

# Скопировать и настроить .env
cp .env.example .env

# Запустить миграции
alembic upgrade head

# Запустить сервер
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend

# Установить зависимости
npm install

# Скопировать .env
cp .env.example .env.local

# Запустить dev-сервер
npm run dev
```

Откройте http://localhost:3000

## Настройка OAuth

### Яндекс

1. Зайдите на https://oauth.yandex.ru
2. Создайте приложение
3. Добавьте права: `direct:api`, `metrika:read`
4. Укажите Callback URL: `http://localhost:8000/integrations/yandex/callback`
5. Скопируйте Client ID и Client Secret в `.env`

### Google

1. Зайдите в https://console.cloud.google.com
2. Создайте проект
3. Включите Google Sheets API и Google Drive API
4. Создайте OAuth 2.0 credentials
5. Добавьте Redirect URI: `http://localhost:8000/integrations/google/callback`
6. Скопируйте Client ID и Client Secret в `.env`

## Деплой на сервер

См. файлы в папке `deploy/`:

```bash
# На сервере
sudo bash deploy/setup.sh
```

Или вручную:

1. Создайте пользователя `report`
2. Установите Python 3.11+, Node.js 18+, nginx
3. Клонируйте репозиторий в `/home/report/RePort`
4. Настройте systemd-сервисы из `deploy/`
5. Настройте nginx из `deploy/nginx.conf`
6. Получите SSL сертификат: `certbot --nginx -d your-domain.ru`

## Ограничение регистрации

Чтобы разрешить регистрацию только определённым пользователям (например, команде), задайте в `.env` бэкенда переменную **ALLOWED_REGISTRATION_EMAILS** — список email через запятую:

```env
ALLOWED_REGISTRATION_EMAILS=user1@company.com,user2@company.com
```

Если переменная задана и не пустая, зарегистрироваться смогут только перечисленные адреса. При попытке регистрации с другого email вернётся ошибка 403. Если переменная не задана или пустая, регистрация открыта для всех (удобно для локальной разработки).

## API Endpoints

### Auth
- `POST /register` — регистрация
- `POST /login` — вход
- `POST /refresh` — обновление токена
- `POST /logout` — выход
- `GET /me` — текущий пользователь

### Projects
- `GET /projects` — список проектов
- `POST /projects` — создать проект
- `GET /projects/{id}` — получить проект
- `PUT /projects/{id}` — обновить проект
- `DELETE /projects/{id}` — удалить проект

### Integrations
- `GET /integrations/yandex/auth-url` — URL для OAuth Яндекс
- `GET /integrations/google/auth-url` — URL для OAuth Google
- `GET /integrations/projects/{id}` — список интеграций проекта
- `DELETE /integrations/{id}` — удалить интеграцию

### Yandex.Direct
- `GET /direct/campaigns` — список кампаний
- `GET /direct/stats` — статистика

### Yandex.Metrika
- `GET /metrika/counters` — список счётчиков
- `GET /metrika/goals` — цели счётчика
- `GET /metrika/stats` — статистика

### Google Sheets
- `GET /sheets/list` — список таблиц
- `POST /sheets/create` — создать таблицу
- `POST /sheets/export` — экспортировать данные

### Reports
- `GET /projects/{id}/reports` — список отчётов
- `POST /projects/{id}/reports` — создать отчёт
- `POST /projects/{id}/reports/preview` — превью данных
- `POST /projects/{id}/reports/{reportId}/run` — запустить отчёт
- `GET /projects/{id}/reports/{reportId}/runs` — история запусков

## Лицензия

MIT
