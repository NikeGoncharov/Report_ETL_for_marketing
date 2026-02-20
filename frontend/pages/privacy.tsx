import Head from "next/head";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <>
      <Head>
        <title>Политика конфиденциальности — Report</title>
        <meta name="description" content="Политика конфиденциальности сервиса Report (report-analytics.ru)" />
      </Head>
      <div className="privacy-page">
        <header className="privacy-header">
          <div className="privacy-container">
            <Link href="/" className="privacy-logo-link">
              <img src="/logo.png" alt="Report" className="privacy-logo" />
            </Link>
            <Link href="/" className="privacy-back">
              ← На главную
            </Link>
          </div>
        </header>

        <main className="privacy-main">
          <div className="privacy-container">
            <h1 className="privacy-title">Политика конфиденциальности</h1>
            <p className="privacy-updated">Дата размещения: 2026 год. Сервис Report (report-analytics.ru).</p>

            <section className="privacy-section">
              <h2>1. Общие положения</h2>
              <p>
                Настоящая политика конфиденциальности описывает, какие данные собирает и обрабатывает сервис Report
                (report-analytics.ru) и с какой целью. Используя сервис, вы соглашаетесь с этой политикой.
              </p>
            </section>

            <section className="privacy-section">
              <h2>2. Данные, которые мы собираем</h2>
              <ul>
                <li>
                  <strong>Учётная запись:</strong> адрес электронной почты и хеш пароля при регистрации и входе.
                </li>
                <li>
                  <strong>Проекты и отчёты:</strong> названия проектов, конфигурации отчётов (выбранные источники,
                  кампании, счётчики, настройки трансформаций и экспорта).
                </li>
                <li>
                  <strong>Интеграции:</strong> при подключении Яндекс.Директ, Яндекс.Метрика или Google Таблицы мы
                  сохраняем токены доступа и обновления (OAuth), необходимые для запросов к API от вашего имени.
                  Данные аккаунта (логин, имя, email) от провайдера отображаются только в интерфейсе для вашего удобства.
                </li>
                <li>
                  <strong>Технические данные:</strong> для работы сессии мы используем cookie (идентификатор сессии).
                </li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>3. Цели обработки</h2>
              <p>
                Данные используются исключительно для работы сервиса: аутентификация, хранение проектов и отчётов,
                запросы к API Яндекса и Google по вашему запросу, формирование и экспорт отчётов в Google Таблицы.
              </p>
            </section>

            <section className="privacy-section">
              <h2>4. Хранение и защита</h2>
              <p>
                Данные хранятся на серверах, на которых развёрнут сервис. Пароли хранятся в виде криптографических хешей.
                Токены интеграций хранятся в зашифрованном виде и используются только для выполнения запросов к API по
                вашим действиям (запуск отчёта, экспорт и т.д.).
              </p>
            </section>

            <section className="privacy-section">
              <h2>5. Передача данных третьим лицам</h2>
              <p>
                Данные передаются третьим лицам только в объёме, необходимом для работы интеграций:
              </p>
              <ul>
                <li>
                  <strong>Яндекс</strong> — при подключении Директа или Метрики и при запросах к API (списки кампаний,
                  статистика и т.д.) в соответствии с политикой Яндекса.
                </li>
                <li>
                  <strong>Google</strong> — при подключении Google Таблиц и при экспорте отчётов (создание/запись
                  таблиц) в соответствии с политикой Google.
                </li>
              </ul>
              <p>
                Мы не продаём и не передаём ваши персональные данные в рекламные или аналитические сервисы третьих
                лиц в маркетинговых целях.
              </p>
            </section>

            <section className="privacy-section">
              <h2>6. Ваши права</h2>
              <p>
                Вы можете запросить доступ к своим данным, их исправление или удаление. Для удаления аккаунта и связанных
                данных обратитесь по контактному адресу, указанному ниже. Отключение интеграций удаляет сохранённые
                токены доступа к соответствующим сервисам.
              </p>
            </section>

            <section className="privacy-section">
              <h2>7. Изменения политики</h2>
              <p>
                Мы можем обновлять эту политику. Актуальная версия всегда доступна по адресу{" "}
                <a href="https://report-analytics.ru/privacy" className="privacy-link">
                  https://report-analytics.ru/privacy
                </a>
                . Существенные изменения будут отражены на этой странице с указанием даты.
              </p>
            </section>

            <section className="privacy-section">
              <h2>8. Контакты</h2>
              <p>
                По вопросам обработки персональных данных и политики конфиденциальности:{" "}
                <a href="mailto:report-analytics@yandex.ru" className="privacy-link">
                  report-analytics@yandex.ru
                </a>
                .
              </p>
            </section>

            <p className="privacy-footer-note">
              <Link href="/" className="privacy-link">
                Вернуться на главную
              </Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
