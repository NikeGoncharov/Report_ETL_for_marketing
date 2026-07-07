import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { authApi } from "../lib/api";
import AuthModal, { AuthMode } from "../components/AuthModal";

/* Иконки блока «Что умеет Report» — единый стиль: stroke 1.8, скруглённые углы */
const featureIcons = {
  projects: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  integration: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  steps: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 5h-7M10 5H3M21 12h-9M8 12H3M21 19h-5M12 19H3" />
      <path d="M14 3v4M8 10v4M16 17v4" />
    </svg>
  ),
  merge: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  ),
  preview: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  ),
  export: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5M12 3v12" />
    </svg>
  ),
};

const FEATURES = [
  {
    icon: featureIcons.projects,
    color: "#2d73ff",
    title: "Все отчёты в одном сервисе",
    text: "Отдельный проект для каждого клиента или направления: свои подключения и отчёты, ничего не перемешивается.",
  },
  {
    icon: featureIcons.integration,
    color: "#f59e0b",
    title: "Нативная интеграция",
    text: "Прямое подключение к Директу, Метрике и Google Sheets по OAuth: без API-токенов, расширений и ручных выгрузок.",
  },
  {
    icon: featureIcons.steps,
    color: "#6366f1",
    title: "Трансформации без формул",
    text: "Фильтры, группировки, объединение источников и вычисляемые поля — по шагам, как конструктор.",
  },
  {
    icon: featureIcons.merge,
    color: "#FC3F1D",
    title: "Мэтчинг данных из разных источников",
    text: "Расход из Директа соединяется с целями Метрики: CPA, ДРР и ROI считаются по кампаниям и UTM-меткам автоматически.",
  },
  {
    icon: featureIcons.preview,
    color: "#10b981",
    title: "Превью на каждом шаге",
    text: "Видно, как меняются данные после каждой трансформации — ошибка ловится до выгрузки, а не после.",
  },
  {
    icon: featureIcons.export,
    color: "#34A853",
    title: "Экспорт туда, где работаете",
    text: "Новая Google-таблица при каждом запуске или ваш лист в существующей. Нужен файл — скачайте CSV.",
  },
];

/* Карта подключений: координаты узлов в системе viewBox 1080×480,
   HTML-узлы позиционируются теми же координатами в процентах — пути и узлы не расходятся */
type VizItem = {
  name: string;
  type: string;
  color: string;
  live: boolean;
  x: number;
  y: number;
};

const VIZ_SOURCES: VizItem[] = [
  { name: "Яндекс Директ", type: "реклама", color: "#FC3F1D", live: true, x: 158, y: 52 },
  { name: "Яндекс Метрика", type: "аналитика", color: "#FFBA00", live: true, x: 108, y: 128 },
  { name: "ПромоСтраницы", type: "реклама", color: "#f97316", live: false, x: 88, y: 204 },
  { name: "Google Ads", type: "реклама", color: "#4285F4", live: false, x: 88, y: 280 },
  { name: "VK Реклама", type: "реклама", color: "#0077FF", live: false, x: 108, y: 356 },
  { name: "Google Analytics", type: "аналитика", color: "#F9AB00", live: false, x: 158, y: 430 },
];

const VIZ_DESTS: VizItem[] = [
  { name: "Google Sheets", type: "экспорт", color: "#34A853", live: true, x: 935, y: 160 },
  { name: "CSV-файл", type: "экспорт", color: "#7c8aa5", live: true, x: 935, y: 320 },
];

// Кривые от узла к ядру (слева) и от ядра к назначениям (справа)
const srcPath = (x: number, y: number) =>
  `M ${x} ${y} C ${x + 150} ${y}, 405 ${240 + (y - 240) * 0.3}, 462 ${240 + (y - 240) * 0.2}`;
const dstPath = (x: number, y: number) =>
  `M 618 ${240 + (y - 240) * 0.2} C 720 ${y}, 810 ${y}, ${x - 70} ${y}`;

function VizNode({ n }: { n: VizItem }) {
  return (
    <div
      className={`viz-node${n.live ? "" : " plan"}`}
      style={{ left: `${(n.x / 1080) * 100}%`, top: `${(n.y / 480) * 100}%` }}
    >
      <span className="flow-dot" style={{ background: n.color, opacity: n.live ? 1 : 0.55 }} />
      <span>
        <b>{n.name}</b>
        <small>{n.type}</small>
      </span>
    </div>
  );
}

const STEPS = [
  { num: "01", title: "Проект", text: "Создайте проект под клиента или направление — их может быть сколько угодно." },
  { num: "02", title: "OAuth", text: "Подключите Директ, Метрику и Google в официальных окнах авторизации — без токенов и паролей." },
  { num: "03", title: "Конструктор", text: "Период → источники → шаги трансформаций → превью результата." },
  { num: "04", title: "Выгрузка", text: "Google Sheets или CSV. Повторный запуск — одна кнопка." },
];

const SECURITY = [
  {
    title: "OAuth 2.0 вместо паролей",
    text: "Вы авторизуетесь в официальном окне Яндекса или Google. Сервис получает токен доступа — пароль он не видит никогда.",
  },
  {
    title: "Только чтение статистики",
    text: "Report запрашивает отчётные данные и не управляет кампаниями: не меняет ставки, не останавливает объявления.",
  },
  {
    title: "Ваши данные — только ваши",
    text: "Никакой рекламы, перепродажи и «обезличенной аналитики». Статистика используется для одного: построить ваш отчёт и выгрузить его в вашу таблицу.",
  },
  {
    title: "Отзыв доступа в один клик",
    text: "Отключите интеграцию в проекте или отзовите доступ в Яндекс ID / аккаунте Google — токен сразу перестаёт работать.",
  },
];

const COMPARE = [
  ["Выгрузить CSV из Директа, отчёт из Метрики", "Данные приходят по API за нужный период"],
  ["Склеить VLOOKUP и сводными таблицами", "Объединение источников настраивается один раз"],
  ["Пересчитать CPA и ДРР руками", "Вычисляемые метрики считаются сами"],
  ["Повторить всё в следующий понедельник", "Открыть отчёт → «Запустить» → готово"],
];

const ROADMAP = [
  {
    status: "Уже работает",
    live: true,
    title: "Выгрузка данных",
    text: "Директ и Метрика → трансформации → Google Sheets или CSV. Ядро сервиса, которым можно пользоваться уже сейчас.",
  },
  {
    status: "На подходе",
    live: false,
    title: "Семантическое ядро",
    text: "Скрипт соберёт и сгруппирует поисковые запросы — готовая семантика для новых кампаний.",
  },
  {
    status: "На подходе",
    live: false,
    title: "Аналитический блок",
    text: "Динамика кампаний и визуализации прямо в сервисе: тренды видно без выгрузки в BI.",
  },
];

const FAQ = [
  {
    q: "Что сервис видит в моих аккаунтах?",
    a: "Только статистику: отчёты кампаний Директа и данные о визитах и целях Метрики по официальным API. Report не управляет кампаниями — не меняет ставки и не останавливает объявления.",
  },
  {
    q: "Почему бесплатно?",
    a: "Report — некоммерческий проект: без тарифов, рекламы и монетизации данных. Сервис развивается как инструмент для маркетологов, а не как бизнес.",
  },
  {
    q: "Храните ли вы мою статистику?",
    a: "Постоянно хранятся только настройки отчётов и токены доступа. Статистика загружается в момент построения отчёта, результат уходит в вашу Google-таблицу и никому не передаётся.",
  },
  {
    q: "Как отозвать доступ?",
    a: "Отключите интеграцию в настройках проекта одним кликом — или отзовите доступ приложению в Яндекс ID и настройках аккаунта Google. Токен сразу перестаёт действовать.",
  },
  {
    q: "Сколько проектов и отчётов можно создать?",
    a: "Ограничений нет: создавайте отдельный проект под каждого клиента или направление.",
  },
  {
    q: "Какие источники появятся дальше?",
    a: "На карте подключений — Яндекс ПромоСтраницы, Google Ads, VK Реклама и Google Analytics; порядок зависит от запросов пользователей. Параллельно готовятся инструменты из раздела «Развитие»: сборка семантического ядра и аналитический блок.",
  },
];

const NAV_LINKS = [
  { href: "#features", label: "Возможности" },
  { href: "#channels", label: "Источники" },
  { href: "#how", label: "Как это работает" },
  { href: "#security", label: "Безопасность" },
  { href: "#roadmap", label: "Развитие" },
  { href: "#faq", label: "FAQ" },
];

export default function LandingPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  // Вход/регистрация открываются попапом поверх лендинга; href остаётся для
  // открытия в новой вкладке и работы без JS
  const openAuth = (mode: AuthMode) => (e: React.MouseEvent) => {
    e.preventDefault();
    setAuthMode(mode);
  };

  // Авторизованных уводим в кабинет, но лендинг рендерим сразу, не дожидаясь ответа API
  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(() => {
        if (!cancelled) router.replace("/dashboard");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="landing">
      <Head>
        <title>Report — отчёты по рекламе в Google Sheets из Директа и Метрики</title>
        <meta
          name="description"
          content="Report подключается к Яндекс Директу и Метрике по OAuth, объединяет статистику, считает CPA, ДРР и ROI и выгружает готовый отчёт в Google Sheets. Некоммерческий сервис: бесплатно, без тарифов и карты."
        />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Report — статистика рекламы сама в вашей Google-таблице" />
        <meta
          property="og:description"
          content="Яндекс Директ + Метрика → трансформации без формул → Google Sheets. Бесплатный некоммерческий сервис для маркетологов."
        />
        <meta property="og:url" content="https://report-analytics.ru/" />
        <meta property="og:image" content="https://report-analytics.ru/logo.png" />
      </Head>

      {/* Шапка */}
      <header className="landing-header">
        <div className="landing-container landing-nav">
          <img src="/logo-white.png" alt="Report" className="landing-logo" />
          <nav className="landing-nav-links">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="landing-nav-auth">
            <Link href="/login" className="landing-btn landing-btn-ghost" onClick={openAuth("login")}>
              Войти
            </Link>
            <Link href="/register" className="landing-btn landing-btn-primary" onClick={openAuth("register")}>
              Зарегистрироваться
            </Link>
          </div>
        </div>
      </header>

      {/* Герой с анимацией пайплайна */}
      <section className="landing-hero">
        <div className="landing-container">
          <h1 className="landing-title">
            Статистика рекламы — <em>сама</em> в&nbsp;вашей Google-таблице
          </h1>
          <p className="landing-subtitle">
            Report подключается к Яндекс Директу и Метрике по OAuth, объединяет и пересчитывает данные
            и выгружает готовый отчёт в Google Sheets. Все проекты и клиенты — в одном аккаунте.
          </p>
          <div className="landing-cta">
            <Link href="/register" className="landing-btn landing-btn-primary landing-btn-large" onClick={openAuth("register")}>
              Создать аккаунт
            </Link>
            <Link href="/login" className="landing-btn landing-btn-ghost landing-btn-large" onClick={openAuth("login")}>
              Войти
            </Link>
          </div>
          <p className="landing-fineprint">Бесплатно — это некоммерческий проект. Без тарифов и привязки карты.</p>

          <div className="flow" aria-hidden="true">
            <div className="flow-col">
              <div className="flow-node">
                <span className="flow-dot" style={{ background: "#FC3F1D" }} />
                <span>
                  <b>Яндекс Директ</b>
                  <small>кампании · клики · расход</small>
                </span>
              </div>
              <div className="flow-node">
                <span className="flow-dot" style={{ background: "#FFBA00" }} />
                <span>
                  <b>Яндекс Метрика</b>
                  <small>визиты · цели · конверсии</small>
                </span>
              </div>
            </div>
            <div className="flow-mid">
              <span className="flow-link" />
              <div className="flow-core">
                <img src="/logo-white.png" alt="" />
                <div className="flow-core-ops">
                  фильтры · группировки · объединение
                  <br />
                  UTM · CPA / ДРР / ROI
                </div>
              </div>
              <span className="flow-link flow-link-late" />
            </div>
            <div className="flow-col">
              <div className="flow-node">
                <span className="flow-dot" style={{ background: "#34A853" }} />
                <span>
                  <b>Google Sheets</b>
                  <small>живой отчёт для команды</small>
                </span>
              </div>
              <div className="flow-node">
                <span className="flow-dot" style={{ background: "#7c8aa5" }} />
                <span>
                  <b>CSV</b>
                  <small>выгрузка в один клик</small>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Возможности */}
      <section className="landing-section landing-features" id="features">
        <div className="landing-container">
          <span className="landing-kicker">Возможности</span>
          <h2 className="landing-h2">Что умеет Report</h2>
          <p className="landing-sub">Каждый блок ниже закрывает конкретный шаг, который вы сейчас делаете руками.</p>
          <div className="landing-cards-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon" style={{ backgroundColor: `${f.color}18`, color: f.color }}>
                  {f.icon}
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Источники: карта подключений */}
      <section className="landing-section landing-channels" id="channels">
        <div className="landing-container">
          <span className="landing-kicker">Каналы</span>
          <h2 className="landing-h2">Доступные источники</h2>
          <p className="landing-sub">
            Данные стекаются в ядро Report и уходят в вашу таблицу. Стартуем с Яндекса — карта подключений растёт.
          </p>
          <div className="sources-viz">
            <svg className="viz-svg" viewBox="0 0 1080 480" preserveAspectRatio="none" aria-hidden="true">
              {VIZ_SOURCES.map((s) => (
                <path key={s.name} className={`viz-path ${s.live ? "live" : "plan"}`} d={srcPath(s.x, s.y)} />
              ))}
              {VIZ_DESTS.map((d) => (
                <path key={d.name} className="viz-path out" d={dstPath(d.x, d.y)} />
              ))}
            </svg>

            <div className="viz-group">
              <h3>Реклама</h3>
              {VIZ_SOURCES.filter((s) => s.type === "реклама").map((s) => (
                <VizNode key={s.name} n={s} />
              ))}
            </div>
            <div className="viz-group">
              <h3>Аналитика</h3>
              {VIZ_SOURCES.filter((s) => s.type === "аналитика").map((s) => (
                <VizNode key={s.name} n={s} />
              ))}
            </div>

            <div className="viz-core">
              <span className="viz-ring" aria-hidden="true" />
              <img src="/logo-white.png" alt="Report" />
              <small>
                объединение источников
                <br />
                CPA · ДРР · ROI
              </small>
            </div>

            <div className="viz-group">
              <h3>Куда выгружаем</h3>
              {VIZ_DESTS.map((d) => (
                <VizNode key={d.name} n={d} />
              ))}
            </div>
          </div>

          <div className="viz-legend">
            <span className="viz-legend-item">
              <span className="legend-dot live" /> уже работает
            </span>
            <span className="viz-legend-item">
              <span className="legend-dot plan" /> в планах
            </span>
          </div>
          <p className="channels-note">
            Не хватает вашего источника? Напишите нам — очередь интеграций обсуждается с пользователями.
          </p>
        </div>
      </section>

      {/* Как это работает */}
      <section className="landing-section landing-how" id="how">
        <div className="landing-container">
          <span className="landing-kicker">Как это работает</span>
          <h2 className="landing-h2">От регистрации до готового отчёта — четыре шага</h2>
          <div className="how-grid">
            {STEPS.map((s) => (
              <div key={s.num} className="how-step">
                <span className="how-num">{s.num}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Безопасность */}
      <section className="landing-section landing-security" id="security">
        <div className="landing-container">
          <span className="landing-kicker">Безопасность данных</span>
          <h2 className="landing-h2">Честно о доступе к вашим данным</h2>
          <p className="landing-sub">
            Report — некоммерческий проект, поэтому гарантии здесь архитектурные, а не маркетинговые.
          </p>
          <div className="security-grid">
            {SECURITY.map((s) => (
              <div key={s.title} className="security-card">
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Сравнение */}
      <section className="landing-section landing-compare">
        <div className="landing-container">
          <span className="landing-kicker">Сравнение</span>
          <h2 className="landing-h2">Понедельник без Report — и с ним</h2>
          <div className="compare-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Вручную</th>
                  <th>С Report</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([a, b]) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td className="win">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Развитие */}
      <section className="landing-section landing-roadmap" id="roadmap">
        <div className="landing-container">
          <span className="landing-kicker">Развитие</span>
          <h2 className="landing-h2">Выгрузка отчётов — только начало</h2>
          <p className="landing-sub">Сервис растёт вокруг одного сценария: меньше ручной работы с рекламными данными.</p>
          <div className="landing-cards-grid roadmap-grid">
            {ROADMAP.map((r) => (
              <div key={r.title} className="roadmap-card">
                <span className={`roadmap-pill ${r.live ? "is-live" : "is-next"}`}>{r.status}</span>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="landing-section landing-faq" id="faq">
        <div className="landing-container">
          <span className="landing-kicker">FAQ</span>
          <h2 className="landing-h2">Частые вопросы</h2>
          <div className="faq-list">
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Финальный CTA */}
      <section className="landing-cta-section">
        <div className="landing-container">
          <h2>Соберите первый отчёт за 10 минут</h2>
          <p>Регистрация бесплатна — Report существует, чтобы им пользовались.</p>
          <Link href="/register" className="landing-btn landing-btn-primary landing-btn-large" onClick={openAuth("register")}>
            Создать аккаунт
          </Link>
        </div>
      </section>

      {/* Футер */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-content">
          <img src="/logo-white.png" alt="Report" className="landing-logo-small" />
          <p>© 2026 Report — некоммерческий ETL-сервис для маркетинга</p>
          <Link href="/privacy" className="landing-footer-link">
            Политика конфиденциальности
          </Link>
        </div>
      </footer>

      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onSwitchMode={setAuthMode}
          onSuccess={() => router.push("/dashboard")}
        />
      )}
    </div>
  );
}
