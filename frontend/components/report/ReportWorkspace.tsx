// Рабочее пространство отчёта: направляемый пайплайн.
// Система ведёт датасет по состояниям: пусто → добавить источник → настроить
// и выгрузить (панель) → трансформировать → добавить следующий источник →
// сшить и выгрузить. Компактные карточки идут слева направо; сшивка и экспорт
// появляются только после первой успешной выгрузки.
import { useEffect, useRef, useState } from "react";
import {
  Catalog, DatasetConfig, DatasetType, DirectCampaign, MetrikaCounter,
  PipelineStage, PreviewResult, Report, ReportConfigV2, ReportRun, StepConfig,
  defaultDataset, ensureConfigV2,
} from "../../types/report";
import { catalogApi, directApi, metrikaApi, reportsApi } from "../../lib/api";
import PeriodPicker from "./PeriodPicker";
import DatasetCard, { DatasetFetchState } from "./DatasetCard";
import FetchModal from "./FetchModal";
import TransformModal from "./TransformModal";
import StageThreePanel from "./StageThreePanel";
import ExportPanel from "./ExportPanel";
import { formatApiError } from "./format";

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
  // Состояние выгрузки датасетов в этой сессии: id -> {stage, rows}
  const [fetchStates, setFetchStates] = useState<Record<string, DatasetFetchState>>({});
  // Открытая панель выгрузки (справа) и окно трансформации (поверх экрана)
  const [drawer, setDrawer] = useState<{ id: string } | null>(null);
  const [transform, setTransform] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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
  // stepsOverride позволяет workflow трансформации смотреть промежуточные
  // состояния: датасет отправляется с обрезанной цепочкой шагов.
  const preview = async (
    stage: PipelineStage,
    datasetId?: string,
    refresh?: boolean,
    stepsOverride?: StepConfig[],
  ): Promise<PreviewResult> => {
    const effectiveConfig =
      stepsOverride && datasetId
        ? {
            ...config,
            datasets: config.datasets.map((d) =>
              d.id === datasetId ? { ...d, steps: stepsOverride } : d,
            ),
          }
        : config;
    const result: PreviewResult = await reportsApi.preview(
      projectId,
      effectiveConfig as unknown as Record<string, unknown>,
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

  // Добавление источника сразу открывает панель настройки — система ведёт дальше
  const addDataset = (type: DatasetType) => {
    const ds = defaultDataset(type, config.datasets.map((d) => d.id));
    updateConfig({ ...config, datasets: [...config.datasets, ds] });
    setAddOpen(false);
    setDrawer({ id: ds.id });
  };

  const updateDataset = (id: string, dataset: DatasetConfig) => {
    const datasets = config.datasets.map((d) => (d.id === id ? dataset : d));
    updateConfig({ ...config, datasets });
  };

  const removeDataset = (id: string) => {
    const datasets = config.datasets.filter((d) => d.id !== id);
    const next = { ...config, datasets };
    if (next.merge.left === id || next.merge.right === id) {
      next.merge = { ...next.merge, enabled: false };
    }
    updateConfig(next);
    setFetchStates((prev) => {
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
    if (drawer?.id === id) setDrawer(null);
    if (transform === id) setTransform(null);
  };

  const markFetched = (datasetId: string, stage: "fetched" | "transformed", rows: number) => {
    setFetchStates((prev) => ({ ...prev, [datasetId]: { stage, rows } }));
  };

  if (!catalog) {
    return <div className="loading"><p>Загрузка конструктора...</p></div>;
  }

  const anyFetched = config.datasets.some((d) => fetchStates[d.id]);
  const drawerDataset = drawer ? config.datasets.find((d) => d.id === drawer.id) : undefined;
  const transformDataset = transform ? config.datasets.find((d) => d.id === transform) : undefined;

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

      {/* Источники: пустое поле или лента карточек слева направо */}
      {config.datasets.length === 0 ? (
        <section className="ds-empty">
          <h3>Добавьте первый источник данных</h3>
          <p>
            Отчёт собирается по шагам: выгрузите данные источника, при необходимости
            трансформируйте их — затем добавьте следующий источник.
          </p>
          <div className="ds-empty-actions">
            <button type="button" className="btn btn-primary" onClick={() => addDataset("direct")}>
              + Яндекс Директ
            </button>
            <button type="button" className="btn btn-primary" onClick={() => addDataset("metrika")}>
              + Яндекс Метрика
            </button>
          </div>
        </section>
      ) : (
        <section className="ds-flow-section">
          <div className="ds-flow-head">
            <h3>Источники данных</h3>
            <span className="field-hint">
              {anyFetched
                ? "Данные выгружены — ниже доступны сшивка, группировка и выгрузка."
                : "Выгрузите данные хотя бы одного источника, чтобы двигаться дальше."}
            </span>
          </div>
          <div className="ds-flow">
            {config.datasets.map((dataset) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                fetchState={fetchStates[dataset.id]}
                onOpen={(target) =>
                  target === "steps" ? setTransform(dataset.id) : setDrawer({ id: dataset.id })
                }
                onRemove={() => removeDataset(dataset.id)}
              />
            ))}
            <div className={`ds-add-card${addOpen ? " open" : ""}`}>
              {addOpen ? (
                <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addDataset("direct")}>
                    + Директ
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addDataset("metrika")}>
                    + Метрика
                  </button>
                  <button type="button" className="step-btn" onClick={() => setAddOpen(false)}>
                    отмена
                  </button>
                </>
              ) : (
                <button type="button" className="ds-add-btn" onClick={() => setAddOpen(true)}>
                  + Добавить источник
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Итог появляется после первой выгрузки: сшивка/группировка и экспорт */}
      {anyFetched && (
        <>
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
        </>
      )}

      {/* Окно выгрузки датасета (поверх экрана) */}
      {drawer && drawerDataset && (
        <FetchModal
          dataset={drawerDataset}
          projectId={projectId}
          catalog={catalog}
          campaigns={campaigns}
          counters={counters}
          fetched={Boolean(fetchStates[drawerDataset.id])}
          onChange={(d) => updateDataset(drawer.id, d)}
          onClose={() => setDrawer(null)}
          onOpenTransform={() => {
            setDrawer(null);
            setTransform(drawerDataset.id);
          }}
          onPreview={(datasetId, stage, refresh) => preview(stage, datasetId, refresh)}
          onFetched={markFetched}
        />
      )}

      {/* Окно трансформации: вертикальный workflow шагов */}
      {transformDataset && (
        <TransformModal
          dataset={transformDataset}
          catalog={catalog}
          onChange={(d) => updateDataset(transformDataset.id, d)}
          onClose={() => setTransform(null)}
          onOpenFetch={() => {
            setTransform(null);
            setDrawer({ id: transformDataset.id });
          }}
          onPreview={(datasetId, stage, refresh, stepsOverride) =>
            preview(stage, datasetId, refresh, stepsOverride)
          }
          onFetched={markFetched}
        />
      )}
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
