// Общие метки и цвета интеграций (карточки клиентов, страница клиента)
export type IntegrationMeta = { label: string; short: string; color: string };

export const INTEGRATION_META: Record<string, IntegrationMeta> = {
  yandex_direct: { label: "Яндекс Директ", short: "Директ", color: "#FC3F1D" },
  yandex_metrika: { label: "Яндекс Метрика", short: "Метрика", color: "#FC3F1D" },
  google_sheets: { label: "Google Sheets", short: "Google Sheets", color: "#34A853" },
};

export const INTEGRATION_TYPES = Object.keys(INTEGRATION_META);

// Что настраивается не в подключении, а в отчёте — подсказка на карточке
export const INTEGRATION_HINTS: Record<string, string> = {
  yandex_direct: "Кампании и поля выбираются в настройках отчёта",
  yandex_metrika: "Счётчик, метрики и цели выбираются в настройках отчёта",
  google_sheets: "Таблица и лист задаются в настройках отчёта",
};
