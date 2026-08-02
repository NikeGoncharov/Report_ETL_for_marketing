// Прогон отчёта выполняется фоновой задачей на бэкенде: POST /run отдаёт запись
// со статусом running, а результат приходится опрашивать. Раньше запрос висел до
// конца выгрузки, и Cloudflare Tunnel рвал его на ~100 с — пользователь видел
// ошибку, хотя выгрузка доходила до конца.
import { ApiError, reportsApi } from "./api";
import { ReportRun, isRunActive } from "../types/report";

export const RUN_POLL_INTERVAL_MS = 3000;
// Верхняя граница прогона на бэкенде: Директ ретраится до ~6 минут на датасет,
// плюс Метрика и запись в Sheets. Полчаса — заведомый запас.
export const RUN_POLL_TIMEOUT_MS = 30 * 60 * 1000;
// Сколько терпим НЕПРЕРЫВНЫЕ сетевые сбои. Считаем временем, а не попытками:
// счётчик попыток при интервале 3 с давал всего ~15 с офлайна на получасовой
// прогон, и мимолётный обрыв Wi-Fi терял отслеживание навсегда.
const FAILURE_BUDGET_MS = 2 * 60 * 1000;

export class RunPollTimeout extends Error {
  constructor() {
    super(
      "Не дождались ответа о завершении выгрузки. Прогон продолжается на сервере — " +
        "обновите страницу позже, результат появится в истории.",
    );
    this.name = "RunPollTimeout";
  }
}

export type PollRunOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  // Опрос прекращается, когда компонент размонтирован
  cancelled?: () => boolean;
  // Промежуточные статусы (для индикатора прогресса)
  onTick?: (run: ReportRun) => void;
};

/** Опрашивать статус прогона, пока он не завершится. null = опрос отменён. */
export async function pollRunUntilDone(
  projectId: number,
  reportId: number,
  runId: number,
  options: PollRunOptions = {},
): Promise<ReportRun | null> {
  const interval = options.intervalMs ?? RUN_POLL_INTERVAL_MS;
  const timeout = options.timeoutMs ?? RUN_POLL_TIMEOUT_MS;
  const startedAt = Date.now();
  let failingSince: number | null = null;

  for (;;) {
    if (options.cancelled?.()) return null;
    await sleep(interval);
    if (options.cancelled?.()) return null;

    try {
      const run: ReportRun = await reportsApi.runStatus(projectId, reportId, runId);
      failingSince = null;
      options.onTick?.(run);
      if (!isRunActive(run)) return run;
    } catch (e) {
      // 401 — сессия истекла, apiFetch уже увёл на главную; 404 — прогон удалён.
      // Повторять бессмысленно: это ещё 40 холостых запросов и редиректов.
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) throw e;
      failingSince = failingSince ?? Date.now();
      if (Date.now() - failingSince > FAILURE_BUDGET_MS) throw e;
    }

    if (Date.now() - startedAt > timeout) throw new RunPollTimeout();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
