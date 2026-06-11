// Карточка датасета: параметры выгрузки (состояние 1) + шаги (состояние 2)
// + превью обоих состояний. Каждый датасет — самостоятельный кусочек данных.
import { useEffect, useState } from "react";
import {
  Catalog, DatasetConfig, DirectCampaign, MetrikaCounter, MetrikaGoal,
  PipelineStage, PreviewResult,
} from "../../types/report";
import { metrikaApi, ApiError } from "../../lib/api";
import { CheckboxGrid } from "./fields";
import StepsEditor from "./StepsEditor";
import PreviewTable from "./PreviewTable";

export default function DatasetCard({
  dataset,
  projectId,
  catalog,
  campaigns,
  counters,
  onChange,
  onRemove,
  onPreview,
}: {
  dataset: DatasetConfig;
  projectId: number;
  catalog: Catalog;
  campaigns: DirectCampaign[];
  counters: MetrikaCounter[];
  onChange: (dataset: DatasetConfig) => void;
  onRemove: () => void;
  onPreview: (datasetId: string, stage: PipelineStage, refresh?: boolean) => Promise<PreviewResult>;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewStage, setPreviewStage] = useState<PipelineStage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goals, setGoals] = useState<MetrikaGoal[]>([]);
  const [paramsOpen, setParamsOpen] = useState(true);

  // Цели Метрики подгружаются при выборе счётчика
  useEffect(() => {
    let active = true;
    if (dataset.type === "metrika" && dataset.counter_id) {
      metrikaApi
        .goals(projectId, dataset.counter_id)
        .then((data) => active && setGoals(data || []))
        .catch(() => active && setGoals([]));
    } else {
      setGoals([]);
    }
    return () => {
      active = false;
    };
  }, [dataset.type, dataset.counter_id, projectId]);

  const runPreview = async (stage: PipelineStage, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await onPreview(dataset.id, stage, refresh);
      setPreview(result);
      setPreviewStage(stage);
    } catch (e) {
      setPreview(null);
      setPreviewStage(null);
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const directDimensions = catalog.direct_fields.filter((f) => f.kind === "dimension");
  const directMetrics = catalog.direct_fields.filter((f) => f.kind === "metric");

  return (
    <div className="dataset-card">
      <div className="dataset-header">
        <span className={`dataset-badge dataset-badge-${dataset.type}`}>
          {dataset.type === "direct" ? "Директ" : "Метрика"}
        </span>
        <input
          className="dataset-name-input"
          value={dataset.label || ""}
          onChange={(e) => onChange({ ...dataset, label: e.target.value })}
          placeholder={dataset.type === "direct" ? "Яндекс.Директ" : "Яндекс.Метрика"}
        />
        <button type="button" className="step-btn" onClick={() => setParamsOpen(!paramsOpen)}>
          {paramsOpen ? "Свернуть" : "Параметры"}
        </button>
        <button type="button" className="step-btn step-btn-danger" onClick={onRemove} title="Удалить датасет">
          ×
        </button>
      </div>

      {paramsOpen && (
        <div className="dataset-params">
          {dataset.type === "direct" ? (
            <>
              <div className="param-block">
                <div className="field-hint">Кампании (пусто = все):</div>
                <CampaignPicker
                  campaigns={campaigns}
                  selected={dataset.campaign_ids || []}
                  onChange={(ids) => onChange({ ...dataset, campaign_ids: ids })}
                />
              </div>
              <div className="param-block param-row">
                <label className="input-label">
                  Детализация
                  <select
                    className="input"
                    value={dataset.group_by || "campaign"}
                    onChange={(e) => onChange({ ...dataset, group_by: e.target.value as "campaign" | "day" })}
                  >
                    <option value="campaign">По кампаниям</option>
                    <option value="day">По дням</option>
                  </select>
                </label>
                <label className="inline-checkbox vat-toggle">
                  <input
                    type="checkbox"
                    checked={dataset.include_vat !== false}
                    onChange={(e) => onChange({ ...dataset, include_vat: e.target.checked })}
                  />
                  Расход с НДС
                </label>
              </div>
              <div className="param-block">
                <div className="field-hint">Срезы:</div>
                <CheckboxGrid
                  options={directDimensions}
                  selected={(dataset.fields || []).filter((f) => directDimensions.some((d) => d.id === f))}
                  onChange={(dims) => {
                    const metrics = (dataset.fields || []).filter((f) => directMetrics.some((m) => m.id === f));
                    onChange({ ...dataset, fields: [...dims, ...metrics] });
                  }}
                />
              </div>
              <div className="param-block">
                <div className="field-hint">Показатели:</div>
                <CheckboxGrid
                  options={directMetrics}
                  selected={(dataset.fields || []).filter((f) => directMetrics.some((m) => m.id === f))}
                  onChange={(mets) => {
                    const dims = (dataset.fields || []).filter((f) => directDimensions.some((d) => d.id === f));
                    onChange({ ...dataset, fields: [...dims, ...mets] });
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="param-block param-row">
                <label className="input-label">
                  Счётчик
                  <select
                    className="input"
                    value={dataset.counter_id ?? ""}
                    onChange={(e) =>
                      onChange({ ...dataset, counter_id: e.target.value ? Number(e.target.value) : undefined })
                    }
                  >
                    <option value="">— выберите счётчик —</option>
                    {counters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="param-block">
                <div className="field-hint">Метрики:</div>
                <CheckboxGrid
                  options={catalog.metrika_metrics}
                  selected={dataset.metrics || []}
                  onChange={(metrics) => onChange({ ...dataset, metrics })}
                />
              </div>
              <div className="param-block">
                <div className="field-hint">Измерения (срезы):</div>
                <CheckboxGrid
                  options={catalog.metrika_dimensions}
                  selected={dataset.dimensions || []}
                  onChange={(dimensions) => onChange({ ...dataset, dimensions })}
                />
              </div>
              {goals.length > 0 && (
                <div className="param-block">
                  <div className="field-hint">Цели (добавят колонку goal…reaches):</div>
                  <CheckboxGrid
                    options={goals.map((g) => ({ id: String(g.id), label: g.name }))}
                    selected={(dataset.goals || []).map(String)}
                    onChange={(ids) => onChange({ ...dataset, goals: ids.map(Number) })}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="dataset-steps">
        <div className="field-hint">Шаги трансформации этого датасета:</div>
        <StepsEditor
          steps={dataset.steps}
          columns={preview?.columns || []}
          catalog={catalog}
          onChange={(steps) => onChange({ ...dataset, steps })}
        />
      </div>

      <div className="dataset-preview-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => runPreview("fetched")} disabled={loading}>
          {loading ? "Загрузка..." : "Выгрузить данные"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => runPreview("transformed")}
          disabled={loading || dataset.steps.length === 0}
          title={dataset.steps.length === 0 ? "Добавьте хотя бы один шаг" : ""}
        >
          Превью после шагов
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => runPreview(previewStage || "fetched", true)}
          disabled={loading}
          title="Заново сходить в API, минуя кэш"
        >
          ⟳ Обновить из API
        </button>
        {previewStage && !loading && !error && (
          <span className="preview-stage-label">
            {previewStage === "fetched" ? "Состояние 1: как выгружено" : "Состояние 2: после шагов"}
          </span>
        )}
      </div>

      <PreviewTable preview={preview} loading={loading} error={error} />
    </div>
  );
}

// Список кампаний с поиском и чекбоксами
function CampaignPicker({
  campaigns,
  selected,
  onChange,
}: {
  campaigns: DirectCampaign[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState("");

  if (campaigns.length === 0) {
    return <div className="field-hint">Кампании не загружены — проверьте подключение Директа.</div>;
  }

  const visible = campaigns.filter(
    (c) => !query || c.name.toLowerCase().includes(query.toLowerCase())
  );

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="campaign-picker">
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по названию..."
      />
      <div className="campaign-list">
        {visible.map((c) => (
          <label key={c.id} className="checkbox-grid-item">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>{c.name}</span>
          </label>
        ))}
        {visible.length === 0 && <div className="field-hint">Ничего не найдено</div>}
      </div>
    </div>
  );
}

export function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.message);
      if (typeof parsed.detail === "string") return parsed.detail;
      if (Array.isArray(parsed.detail)) {
        return parsed.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
      }
    } catch {
      // не JSON — показываем как есть, но укорачиваем
    }
    return e.message.length > 300 ? `${e.message.slice(0, 300)}…` : e.message;
  }
  return e instanceof Error ? e.message : "Неизвестная ошибка";
}
