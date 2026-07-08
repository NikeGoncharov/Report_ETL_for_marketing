// Модальное окно трансформации датасета поверх экрана: слева цепочка шагов,
// справа живая таблица предпросмотра. Превью грузится сразу при открытии и
// пересчитывается само после правок шагов; при ошибке недособранного шага
// таблица не пропадает. Заголовки колонок можно перетаскивать — порядок
// сохраняется шагом «Порядок колонок».
import { useEffect, useRef, useState } from "react";
import {
  Catalog, DatasetConfig, PipelineStage, PreviewResult,
} from "../../types/report";
import StepsEditor from "./StepsEditor";
import { formatCell } from "./PreviewTable";
import { formatApiError } from "./format";

const MAX_ROWS = 50;

export default function TransformModal({
  dataset,
  catalog,
  onChange,
  onClose,
  onPreview,
  onFetched,
}: {
  dataset: DatasetConfig;
  catalog: Catalog;
  onChange: (dataset: DatasetConfig) => void;
  onClose: () => void;
  onPreview: (datasetId: string, stage: PipelineStage, refresh?: boolean) => Promise<PreviewResult>;
  onFetched: (datasetId: string, stage: "fetched" | "transformed", rows: number) => void;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // Применяем только ответ последнего запроса (защита от гонок автопересчёта)
  const seq = useRef(0);
  // Перестановка колонок применяется к таблице локально — пересчёт не нужен
  const skipAuto = useRef(false);

  const runPreview = async (refresh = false) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const result = await onPreview(dataset.id, "transformed", refresh);
      if (my !== seq.current) return;
      setPreview(result);
      setError(null);
      onFetched(dataset.id, dataset.steps.length > 0 ? "transformed" : "fetched", result.row_count);
    } catch (e) {
      if (my !== seq.current) return;
      setError(formatApiError(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  // Таблица данных — сразу при открытии (сырые данные берутся из кэша выгрузки)
  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Автопересчёт: пауза после последней правки шагов
  const stepsJson = JSON.stringify(dataset.steps);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (skipAuto.current) {
      skipAuto.current = false;
      return;
    }
    const timer = setTimeout(() => runPreview(), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsJson]);

  // Esc закрывает, скролл страницы блокируется
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

  // Перенос колонки: новый порядок пишется в шаг «columns» (последний шаг
  // дополняется, иначе добавляется) и сразу применяется к таблице.
  const moveColumn = (from: string, to: string) => {
    if (!preview || from === to) return;
    const cols = [...preview.columns];
    const fromIdx = cols.indexOf(from);
    const toIdx = cols.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    cols.splice(toIdx, 0, ...cols.splice(fromIdx, 1));

    const steps = [...dataset.steps];
    const last = steps[steps.length - 1];
    if (last && last.type === "columns") {
      steps[steps.length - 1] = { ...last, columns: cols };
    } else {
      steps.push({ type: "columns", columns: cols });
    }
    skipAuto.current = true;
    onChange({ ...dataset, steps });
    setPreview({ ...preview, columns: cols });
  };

  const isDirect = dataset.type === "direct";
  const rows = preview ? preview.data.slice(0, MAX_ROWS) : [];

  return (
    <div
      className="tmodal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tmodal" role="dialog" aria-modal="true" aria-label={`Трансформация: ${dataset.label || dataset.id}`}>
        <div className="tmodal-head">
          <span className={`dataset-badge dataset-badge-${dataset.type}`}>
            {isDirect ? "Директ" : "Метрика"}
          </span>
          <b>{dataset.label || (isDirect ? "Яндекс.Директ" : "Яндекс.Метрика")}</b>
          <span className="tmodal-sub">Трансформация данных</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="tmodal-body">
          <div className="tmodal-steps">
            <div className="field-hint" style={{ marginBottom: 8 }}>
              Шаги применяются по порядку — таблица пересчитывается сама.
            </div>
            <StepsEditor
              steps={dataset.steps}
              columns={preview?.columns || []}
              catalog={catalog}
              onChange={(steps) => onChange({ ...dataset, steps })}
            />
          </div>

          <div className="tmodal-preview">
            {!preview && loading && <div className="preview-status">Загрузка данных...</div>}
            {!preview && !loading && error && <div className="alert alert-danger preview-error">{error}</div>}
            {preview && preview.row_count === 0 && (
              <div className="preview-status">Данных за выбранный период нет.</div>
            )}
            {preview && preview.row_count > 0 && (
              <div className="tmodal-scroll">
                <table className="table preview-table tmodal-table">
                  <thead>
                    <tr>
                      {preview.columns.map((col) => (
                        <th
                          key={col}
                          draggable
                          className={
                            (dragCol === col ? "th-dragging" : "") +
                            (overCol === col && dragCol && dragCol !== col ? " th-over" : "")
                          }
                          onDragStart={(e) => {
                            setDragCol(col);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", col);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (overCol !== col) setOverCol(col);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            // имя колонки несёт dataTransfer — state может отставать
                            const from = e.dataTransfer.getData("text/plain") || dragCol;
                            if (from) moveColumn(from, col);
                            setDragCol(null);
                            setOverCol(null);
                          }}
                          onDragEnd={() => {
                            setDragCol(null);
                            setOverCol(null);
                          }}
                          title="Перетащите, чтобы изменить порядок колонок"
                        >
                          <span className="th-grip" aria-hidden="true">⠿</span>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {preview.columns.map((col) => (
                          <td key={col}>{formatCell(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="tmodal-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => runPreview()} disabled={loading}>
            ⟳ Пересчитать
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => runPreview(true)}
            disabled={loading}
            title="Заново сходить в API, минуя кэш"
          >
            ⟳ Из API
          </button>
          <span className={`tmodal-status${error && preview ? " is-error" : ""}`}>
            {loading
              ? "Пересчёт..."
              : error && preview
                ? `Шаг не применён: ${error}`
                : preview && preview.row_count > 0
                  ? `Строк всего: ${preview.row_count}${preview.row_count > MAX_ROWS ? ` (показаны первые ${MAX_ROWS})` : ""}`
                  : ""}
          </span>
          <span className="drawer-foot-spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
