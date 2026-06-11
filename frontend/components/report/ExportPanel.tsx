// Этап 4: экспорт в Google Sheets, скачивание CSV, история запусков.
import { ExportConfig, ReportRun } from "../../types/report";
import { parseSpreadsheetId } from "../../types/report";

export default function ExportPanel({
  exportConfig,
  onChange,
  onRun,
  running,
  runs,
  onDownloadCsv,
  csvAvailable,
}: {
  exportConfig: ExportConfig;
  onChange: (config: ExportConfig) => void;
  onRun: () => void;
  running: boolean;
  runs: ReportRun[];
  onDownloadCsv: () => void;
  csvAvailable: boolean;
}) {
  return (
    <div className="export-panel">
      <div className="merge-fields">
        <label className="inline-checkbox">
          <input
            type="checkbox"
            checked={exportConfig.create_new}
            onChange={(e) => onChange({ ...exportConfig, create_new: e.target.checked })}
          />
          Создавать новую таблицу при каждом запуске
        </label>

        {!exportConfig.create_new && (
          <label className="input-label">
            Ссылка на Google-таблицу (или её ID)
            <input
              className="input"
              value={exportConfig.spreadsheet_id || ""}
              onChange={(e) =>
                onChange({ ...exportConfig, spreadsheet_id: parseSpreadsheetId(e.target.value) || null })
              }
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </label>
        )}

        <label className="input-label">
          Название листа (пусто = название отчёта)
          <input
            className="input"
            value={exportConfig.sheet_name || ""}
            onChange={(e) => onChange({ ...exportConfig, sheet_name: e.target.value || null })}
            placeholder="Report"
          />
        </label>
      </div>

      <div className="dataset-preview-actions">
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={running}>
          {running ? "Выгрузка..." : "Выгрузить в Google Sheets"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onDownloadCsv}
          disabled={!csvAvailable}
          title={csvAvailable ? "" : "Сначала сделайте «Превью результата»"}
        >
          Скачать CSV
        </button>
      </div>

      {runs.length > 0 && (
        <div className="runs-history">
          <div className="field-hint">История запусков:</div>
          <div className="list-grid">
            {runs.map((run) => (
              <div key={run.id} className="list-row">
                <div className="list-row-title">
                  {formatRunDate(run.started_at)}
                  {run.error_message && (
                    <span className="run-error" title={run.error_message}>
                      {" — "}{truncate(run.error_message, 120)}
                    </span>
                  )}
                </div>
                <div className="list-row-actions">
                  <span className={`status-pill ${run.status === "failed" ? "status-pill-failed" : ""}`}>
                    {runStatusLabel(run.status)}
                  </span>
                  {run.result_url && (
                    <a href={run.result_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                      Открыть таблицу
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function runStatusLabel(status: ReportRun["status"]): string {
  switch (status) {
    case "completed":
      return "Готово";
    case "failed":
      return "Ошибка";
    case "running":
      return "Выполняется";
    default:
      return "В очереди";
  }
}

function formatRunDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
