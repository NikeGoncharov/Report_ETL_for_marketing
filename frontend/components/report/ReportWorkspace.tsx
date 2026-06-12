// Рабочее пространство отчёта: единый редактор пайплайна.
// Этапы: 1) датасеты выгружены -> 2) трансформированы -> 3) сшиты и
// сгруппированы -> 4) выгрузка. Каждый этап контролируется превью.
import { useEffect, useRef, useState } from "react";
import {
  Catalog, DatasetConfig, DatasetType, DirectCampaign, MetrikaCounter,
  PipelineStage, PreviewResult, Report, ReportConfigV2, ReportRun,
  defaultDataset, ensureConfigV2,
} from "../../types/report";
import { catalogApi, directApi, metrikaApi, reportsApi } from "../../lib/api";
import PeriodPicker from "./PeriodPicker";
import DatasetCard, { formatApiError } from "./DatasetCard";
import StageThreePanel from "./StageThreePanel";
import ExportPanel from "./ExportPanel";

export default function ReportWorkspace({
  projectId,
  report,
}: {
  projectId: number;
  report: Report;
}) {
  const [name, setName] = useState(report.name);
  const [config, setConfig] = useState<ReportConfigV2>(() => ensureConfigV2(report.config));
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [campaigns, setCampaigns] = useState<DirectCampaign[]>([]);
  const [counters, setCounters] = useState<MetrikaCounter[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [finalPreview, setFinalPreview] = useState<PreviewResult | null>(null);
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    catalogApi.get().then(setCatalog).catch(() => setCatalog(null));
    directApi.campaigns(projectId).then((d) => setCampaigns(d || [])).catch(() => setCampaigns([]));
    metrikaApi.counters(projectId).then((d) => setCounters(d || [])).catch(() => setCounters([]));
    reportsApi.runs(projectId, report.id).then((d) => setRuns(d || [])).catch(() => setRuns([]));
  }, [projectId, report.id]);

  const updateConfig = (next: ReportConfigV2) => {
    dirty.current = true;
    setConfig(next);
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      await reportsApi.update(projectId, report.id, {
        name,
        config: sanitizeConfig(config) as unknown as Record<string, unknown>,
      });
      dirty.current = false;
      setSavedAt(new Date());
      return true;
    } catch (e) {
      setSaveError(formatApiError(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Превью любой стадии. Для стадий 3-4 запоминаем колонки результата —
  // они служат подсказками для ключей сшивки и группировки.
  const preview = async (
    stage: PipelineStage,
    datasetId?: string,
    refresh?: boolean,
  ): Promise<PreviewResult> => {
    const result: PreviewResult = await reportsApi.preview(
      projectId,
      config as unknown as Record<string, unknown>,
      { stage, dataset_id: datasetId, refresh },
    );
    if (stage === "fetched" || stage === "transformed") {
      // колонки датасетов тоже пригодятся для ключей сшивки
      setResultColumns((prev) => mergeColumns(prev, result.columns));
    } else {
      setResultColumns(result.columns);
    }
    if (stage === "final") {
      setFinalPreview(result);
    }
    return result;
  };

  const run = async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      if (dirty.current || name !== report.name) {
        const ok = await save();
        if (!ok) return;
      }
      const result: ReportRun = await reportsApi.run(projectId, report.id);
      if (result.status === "completed") {
        if (result.result_url) {
          window.open(result.result_url, "_blank");
        }
        setRunMessage("Выгрузка завершена успешно.");
      } else {
        setRunMessage(`Ошибка выгрузки: ${result.error_message || "неизвестная ошибка"}`);
      }
      const updatedRuns = await reportsApi.runs(projectId, report.id).catch(() => null);
      if (updatedRuns) setRuns(updatedRuns);
    } catch (e) {
      setRunMessage(`Ошибка выгрузки: ${formatApiError(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const downloadCsv = () => {
    if (!finalPreview) return;
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      finalPreview.columns.map(escape).join(";"),
      ...finalPreview.data.map((row) => finalPreview.columns.map((c) => escape(row[c])).join(";")),
    ];
    // BOM, чтобы Excel корректно открыл кириллицу
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addDataset = (type: DatasetType) => {
    const ds = defaultDataset(type, config.datasets.map((d) => d.id));
    updateConfig({ ...config, datasets: [...config.datasets, ds] });
  };

  const updateDataset = (index: number, dataset: DatasetConfig) => {
    const datasets = config.datasets.map((d, i) => (i === index ? dataset : d));
    updateConfig({ ...config, datasets });
  };

  const removeDataset = (index: number) => {
    const removed = config.datasets[index];
    const datasets = config.datasets.filter((_, i) => i !== index);
    const next = { ...config, datasets };
    if (next.merge.left === removed.id || next.merge.right === removed.id) {
      next.merge = { ...next.merge, enabled: false };
    }
    updateConfig(next);
  };

  if (!catalog) {
    return <div className="loading"><p>Загрузка конструктора...</p></div>;
  }

  return (
    <div className="workspace">
      {/* Шапка: название + период + сохранение */}
      <section className="card stage-card">
        <div className="card-body">
          <div className="workspace-header">
            <input
              className="input report-name-input"
              value={name}
              onChange={(e) => {
                dirty.current = true;
                setName(e.target.value);
              }}
              placeholder="Название отчёта"
            />
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
            {savedAt && !saving && !saveError && (
              <span className="field-hint">Сохранено {savedAt.toLocaleTimeString("ru-RU")}</span>
            )}
          </div>
          {saveError && <div className="alert alert-danger">{saveError}</div>}
          <div className="field-hint" style={{ marginTop: 12 }}>Период отчёта:</div>
          <PeriodPicker
            period={config.period}
            presets={catalog.periods}
            onChange={(period) => updateConfig({ ...config, period })}
          />
        </div>
      </section>

      {/* Этапы 1-2: датасеты */}
      <section className="card stage-card">
        <div className="card-header stage-header">
          <span className="stage-num">1–2</span>
          <div>
            <h3>Данные</h3>
            <div className="stage-desc">
              Каждый датасет выгружается отдельно (состояние 1) и проходит свои шаги
              трансформации (состояние 2).
            </div>
          </div>
        </div>
        <div className="card-body">
          {config.datasets.length === 0 && (
            <div className="empty-state">Добавьте первый датасет — Директ или Метрику.</div>
          )}
          {config.datasets.map((dataset, i) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              projectId={projectId}
              catalog={catalog}
              campaigns={campaigns}
              counters={counters}
              onChange={(d) => updateDataset(i, d)}
              onRemove={() => removeDataset(i)}
              onPreview={(datasetId, stage, refresh) => preview(stage, datasetId, refresh)}
            />
          ))}
          <div className="dataset-add">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addDataset("direct")}>
              + Датасет из Директа
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addDataset("metrika")}>
              + Датасет из Метрики
            </button>
          </div>
        </div>
      </section>

      {/* Этап 3: сшивка и группировка */}
      <section className="card stage-card">
        <div className="card-header stage-header">
          <span className="stage-num">3</span>
          <div>
            <h3>Сшивка и группировка</h3>
            <div className="stage-desc">
              Кампании из кабинета сшиваются с UTM-метками Метрики, затем строки
              можно сгруппировать (например, Поиск и РСЯ отдельно).
            </div>
          </div>
        </div>
        <div className="card-body">
          <StageThreePanel
            merge={config.merge}
            grouping={config.grouping}
            datasets={config.datasets}
            columnsHint={resultColumns}
            catalog={catalog}
            onMergeChange={(merge) => updateConfig({ ...config, merge })}
            onGroupingChange={(grouping) => updateConfig({ ...config, grouping })}
            onPreview={(stage) => preview(stage)}
          />
        </div>
      </section>

      {/* Этап 4: экспорт */}
      <section className="card stage-card">
        <div className="card-header stage-header">
          <span className="stage-num">4</span>
          <div>
            <h3>Выгрузка</h3>
            <div className="stage-desc">
              Итоговый результат (после этапа 3) уходит в Google Sheets. Перед выгрузкой
              изменения сохраняются автоматически.
            </div>
          </div>
        </div>
        <div className="card-body">
          {runMessage && (
            <div className={`alert ${runMessage.startsWith("Ошибка") ? "alert-danger" : "alert-success"}`}>
              {runMessage}
            </div>
          )}
          <ExportPanel
            exportConfig={config.export}
            onChange={(exportConfig) => updateConfig({ ...config, export: exportConfig })}
            onRun={run}
            running={running}
            runs={runs}
            onDownloadCsv={downloadCsv}
            csvAvailable={Boolean(finalPreview && finalPreview.row_count > 0)}
          />
        </div>
      </section>
    </div>
  );
}

function mergeColumns(prev: string[], next: string[]): string[] {
  const result = [...prev];
  for (const col of next) {
    if (!result.includes(col)) result.push(col);
  }
  return result;
}

// Недозаполненные строки редакторов (пустой ключ агрегации/переименования)
// не должны попадать в сохранённый конфиг.
function dropEmptyKeys(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record) return record;
  const cleaned = Object.fromEntries(Object.entries(record).filter(([k]) => k.trim() !== ""));
  return cleaned;
}

function sanitizeConfig(config: ReportConfigV2): ReportConfigV2 {
  return {
    ...config,
    datasets: config.datasets.map((d) => ({
      ...d,
      steps: d.steps.map((s) => ({
        ...s,
        aggregations: dropEmptyKeys(s.aggregations),
        mapping: dropEmptyKeys(s.mapping),
      })),
    })),
    grouping: {
      ...config.grouping,
      aggregations: dropEmptyKeys(config.grouping.aggregations) || {},
    },
  };
}
