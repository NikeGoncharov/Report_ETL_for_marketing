import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { authApi } from "../lib/api";

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated
    authApi.me()
      .then(() => {
        router.push("/dashboard");
      })
      .catch(() => {
        setChecking(false);
      });
  }, []);

  if (checking) {
    return (
      <div className="landing-loading">
        <img src="/logo.png" alt="RePort" className="landing-logo-small" />
        <p>Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="landing">
      {/* Hero Section (dark) */}
      <section className="landing-hero landing-hero-dark">
        <div className="landing-container">
          <img src="/logo-white.png" alt="Report" className="landing-hero-logo" />
          <h1 className="landing-title landing-title-dark">
            ETL-платформа для маркетинга
          </h1>
          <p className="landing-subtitle landing-subtitle-dark">
            Собирайте данные из рекламных кабинетов, трансформируйте и выгружайте 
            в Google Sheets. Управляйте аналитикой нескольких проектов в одном месте.
          </p>
          <div className="landing-cta">
            <Link href="/register" className="landing-btn-primary landing-btn-large">
              Зарегистрироваться
            </Link>
            <Link href="/login" className="landing-btn-secondary-dark landing-btn-large">
              Войти
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="landing-features">
        <div className="landing-container">
          <h2 className="landing-section-title">Возможности платформы</h2>
          <div className="landing-features-grid">
            <div className="landing-feature-card">
              <div className="landing-feature-icon" style={{ backgroundColor: "#FC3F1D20" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FC3F1D" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <h3>Источники данных</h3>
              <p>
                Подключайте рекламные кабинеты и системы аналитики. 
                Получайте статистику по кампаниям, визитам и конверсиям в одном месте.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="landing-feature-icon" style={{ backgroundColor: "#6366f120" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
                  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                </svg>
              </div>
              <h3>Трансформация данных</h3>
              <p>
                Группируйте, фильтруйте, объединяйте источники. 
                Извлекайте UTM-метки, считайте ROI и другие метрики.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="landing-feature-icon" style={{ backgroundColor: "#34A85320" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34A853" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                  <line x1="9" y1="21" x2="9" y2="9"/>
                </svg>
              </div>
              <h3>Экспорт в Google Sheets</h3>
              <p>
                Выгружайте готовые отчёты в Google Таблицы. 
                Делитесь данными с командой и клиентами.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Target audience */}
      <section className="landing-audience">
        <div className="landing-container">
          <h2 className="landing-section-title">Для кого Report</h2>
          <div className="landing-audience-grid">
            <div className="landing-audience-card">
              <h3>Маркетологи</h3>
              <p>
                Управляйте данными из разных рекламных кабинетов в одном месте. 
                Экономьте время на ручном сборе статистики.
              </p>
            </div>
            <div className="landing-audience-card">
              <h3>Агентства</h3>
              <p>
                Ведите аналитику нескольких клиентов одновременно. 
                Создавайте отдельные проекты для каждого клиента.
              </p>
            </div>
            <div className="landing-audience-card">
              <h3>Фрилансеры</h3>
              <p>
                Быстро собирайте отчёты для клиентов. 
                Автоматизируйте рутину и сфокусируйтесь на результатах.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="landing-cta-section">
        <div className="landing-container">
          <h2>Начните работу с Report</h2>
          <p>Бесплатная регистрация, без привязки карты</p>
          <Link href="/register" className="landing-btn-primary landing-btn-large">
            Создать аккаунт
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-content">
            <img src="/logo-white.png" alt="RePort" className="landing-logo-small" />
            <p>© 2026 Report. ETL-платформа для маркетинга.</p>
            <Link href="/privacy" className="landing-footer-link">
              Политика конфиденциальности
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
