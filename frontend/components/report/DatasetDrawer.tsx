// Выплывающая панель выгрузки датасета: параметры (кампании/срезы/показатели
// или счётчик/метрики) + предварительная выгрузка (stage=fetched).
// Трансформация живёт отдельно — в модальном окне TransformModal.
import { useEffect, useState } from "react";
import {
  Catalog, DatasetConfig, DirectCampaign, MetrikaCounter, MetrikaGoal,
  PipelineStage, PreviewResult,
} from "../../types/report";
import { metrikaApi } from "../../lib/api";
import { CheckboxGrid } from "./fields";
import PreviewTable from "./PreviewTable";
import { formatApiError } from "./format";

export default function DatasetDrawer({
  dataset,
  projectId,
  catalog,
  campaigns,
  counters,
  fetched,
  onChange,
  onClose,
  onOpenTransform,
  onPreview,
  onFetched,
}: {
  dataset: DatasetConfig;
  projectId: number;
  catalog: Catalog;
  campaigns: DirectCampaign[];
  counters: MetrikaCounter[];
  // датасет уже успешно выгружался в этой сессии
  fetched: boolean;
  onChange: (dataset: DatasetConfig) => void;
  onClose: () => void;
  // «К трансформации»: закрыть панель и открыть модалку шагов
  onOpenTransform: () => void;
  onPreview: (datasetId: string, stage: PipelineStage, refresh?: boolean) => Promise<PreviewResult>;
  onFetched: (datasetId: string, stage: "fetched" | "transformed", rows: number) => void;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // выгрузка сделана в этом открытии панели (для подписи под таблицей)
  const [fetchedNow, setFetchedNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goals, setGoals] = useState<MetrikaGoal[]>([]);

  // Esc закрывает панель, скролл страницы блокируется
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

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

  const runPreview = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await onPreview(dataset.id, "fetched", refresh);
      setPreview(result);
      setFetchedNow(true);
      onFetched(dataset.id, "fetched", result.row_count);
    } catch (e) {
      setPreview(null);
      setFetchedNow(false);
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const directDimensions = catalog.direct_fields.filter((f) => f.kind === "dimension");
  const directMetrics = catalog.direct_fields.filter((f) => f.kind === "metric");
  const isDirect = dataset.type === "direct";

  return (
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Настройка: ${dataset.label || dataset.id}`}>
        <div className="drawer-head">
          <span className={`dataset-badge dataset-badge-${dataset.type}`}>
            {isDirect ? "Директ" : "Метрика"}
          </span>
          <input
            className="dataset-name-input"
            value={dataset.label || ""}
            onChange={(e) => onChange({ ...dataset, label: e.target.value })}
            placeholder={isDirect ? "Яндекс.Директ" : "Яндекс.Метрика"}
          />
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="drawer-body">
          {isDirect ? (
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

          <PreviewTable preview={preview} loading={loading} error={error} />
          {fetchedNow && !loading && !error && (
            <div className="preview-stage-label" style={{ marginTop: 6 }}>
              Состояние 1: как выгружено
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-primary" onClick={() => runPreview()} disabled={loading}>
            {loading ? "Выгрузка..." : fetched ? "Выгрузить заново" : "Предварительная выгрузка"}
          </button>
          {fetched && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => runPreview(true)}
                disabled={loading}
                title="Заново сходить в API, минуя кэш"
              >
                ⟳ Из API
              </button>
              <button type="button" className="btn btn-secondary" onClick={onOpenTransform}>
                К трансформации →
              </button>
            </>
          )}
          <span className="drawer-foot-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Готово
          </button>
        </div>
      </aside>
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
