// Окно трансформации: вертикальный workflow контейнеров. Шаг 0 — данные
// как выгружено, дальше каждый шаг — карточка «форма + таблица после шага».
// Правка шага помечает таблицы ниже устаревшими и пересчитывает только их;
// сырые данные при этом берутся из серверного кэша выгрузки. Заголовки
// итоговой таблицы можно перетаскивать — порядок сохраняется шагом «columns».
import { useEffect, useRef, useState } from "react";
import {
  Catalog, DatasetConfig, PipelineStage, PreviewResult, StepConfig, StepType,
} from "../../types/report";
import { StepForm, DEFAULT_STEPS } from "./StepsEditor";
import { formatCell } from "./PreviewTable";
import { formatApiError } from "./format";

const ROWS_MID = 8;
const ROWS_LAST = 30;

type StagePreview = {
  result: PreviewResult | null;
  error: string | null;
  stale?: boolean;
};

export default function TransformModal({
  dataset,
  catalog,
  onChange,
  onClose,
  onOpenFetch,
  onPreview,
  onFetched,
}: {
  dataset: DatasetConfig;
  catalog: Catalog;
  onChange: (dataset: DatasetConfig) => void;
  onClose: () => void;
  // «Настроить выгрузку» из шага 0: закрыть это окно, открыть окно выгрузки
  onOpenFetch: () => void;
  onPreview: (
    datasetId: string,
    stage: PipelineStage,
    refresh?: boolean,
    stepsOverride?: StepConfig[],
  ) => Promise<PreviewResult>;
  onFetched: (datasetId: string, stage: "fetched" | "transformed", rows: number) => void;
}) {
  const steps = dataset.steps;
  // previews[i] — таблица ПОСЛЕ i шагов (0 = как выгружено)
  const [previews, setPreviews] = useState<StagePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // Применяем только ответы последнего пересчёта (защита от гонок)
  const seq = useRef(0);
  // Перестановка колонок применяется локально — автопересчёт не нужен
  const skipAuto = useRef(false);
  const prevStepsRef = useRef<string[] | null>(null);
  const pendingFrom = useRef(Infinity);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;

  // Пересчёт таблиц с индекса fromIndex до конца, последовательно сверху вниз
  const recalc = async (fromIndex: number, refresh = false) => {
    const my = ++seq.current;
    const ds = datasetRef.current;
    const total = ds.steps.length + 1;
    setBusy(true);
    setPreviews((p) => p.slice(0, total));
    for (let i = Math.max(0, Math.min(fromIndex, total - 1)); i < total; i++) {
      try {
        const result = await onPreview(ds.id, "transformed", refresh && i === fromIndex, ds.steps.slice(0, i));
        if (my !== seq.current) return;
        setPreviews((p) => {
          const next = [...p];
          next[i] = { result, error: null };
          return next;
        });
        if (i === total - 1) {
          onFetched(ds.id, ds.steps.length > 0 ? "transformed" : "fetched", result.row_count);
        }
      } catch (e) {
        if (my !== seq.current) return;
        setPreviews((p) => {
          const next = [...p];
          next[i] = { result: next[i]?.result || null, error: formatApiError(e) };
          return next;
        });
        break; // ниже по цепочке считать нет смысла
      }
    }
    if (my === seq.current) setBusy(false);
  };

  // Первая загрузка + отмена хвостов при размонтировании
  useEffect(() => {
    recalc(0);
    return () => {
      // намеренно свежее значение: инвалидируем пересчёт, идущий в момент закрытия
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Автопересчёт: находим первый изменённый шаг, всё ниже — устарело
  const stepsJson = JSON.stringify(steps);
  useEffect(() => {
    const cur = steps.map((s) => JSON.stringify(s));
    const prev = prevStepsRef.current;
    prevStepsRef.current = cur;
    if (prev === null) return; // маунт покрыт первой загрузкой
    if (skipAuto.current) {
      skipAuto.current = false;
      return;
    }
    let d = 0;
    const minLen = Math.min(prev.length, cur.length);
    while (d < minLen && prev[d] === cur[d]) d++;
    if (d === cur.length && cur.length === prev.length) return;
    pendingFrom.current = Math.min(pendingFrom.current, d + 1);
    const from = pendingFrom.current;
    setPreviews((p) => p.map((sp, i) => (sp && i >= from ? { ...sp, stale: true } : sp)));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const start = pendingFrom.current;
      pendingFrom.current = Infinity;
      recalc(start);
    }, 900);
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

  const stepLabel = (type: string) =>
    catalog.step_types.find((s) => s.id === type)?.label || type;

  const updateStep = (index: number, patch: Partial<StepConfig>) => {
    onChange({
      ...dataset,
      steps: steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  };

  const removeStep = (index: number) => {
    onChange({ ...dataset, steps: steps.filter((_, i) => i !== index) });
  };

  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...dataset, steps: next });
  };

  const addStep = (type: StepType) => {
    onChange({ ...dataset, steps: [...steps, { ...DEFAULT_STEPS[type] }] });
  };

  // Перенос колонки в итоговой таблице -> шаг «columns» + локальное применение
  const moveColumn = (from: string, to: string) => {
    const lastIdx = steps.length;
    const sp = previews[lastIdx];
    if (!sp?.result || from === to) return;
    const cols = [...sp.result.columns];
    const fromPos = cols.indexOf(from);
    const toPos = cols.indexOf(to);
    if (fromPos < 0 || toPos < 0) return;
    cols.splice(toPos, 0, ...cols.splice(fromPos, 1));

    const nextSteps = [...steps];
    const last = nextSteps[nextSteps.length - 1];
    const appended = !(last && last.type === "columns");
    if (appended) {
      nextSteps.push({ type: "columns", columns: cols });
    } else {
      nextSteps[nextSteps.length - 1] = { ...last, columns: cols };
    }
    skipAuto.current = true;
    onChange({ ...dataset, steps: nextSteps });
    setPreviews((p) => {
      const next = [...p];
      const updated: StagePreview = { result: { ...sp.result!, columns: cols }, error: null };
      next[appended ? lastIdx + 1 : lastIdx] = updated;
      return next;
    });
  };

  const isDirect = dataset.type === "direct";
  const fetchSummary = isDirect
    ? dataset.campaign_ids && dataset.campaign_ids.length > 0
      ? `кампаний: ${dataset.campaign_ids.length}`
      : "все кампании"
    : dataset.counter_id
      ? `счётчик ${dataset.counter_id}`
      : "счётчик не выбран";
  const finalPreview = previews[steps.length];

  return (
    <div
      className="tmodal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tmodal tmodal-wide" role="dialog" aria-modal="true" aria-label={`Трансформация: ${dataset.label || dataset.id}`}>
        <div className="tmodal-head">
          <span className={`dataset-badge dataset-badge-${dataset.type}`}>
            {isDirect ? "Директ" : "Метрика"}
          </span>
          <b>{dataset.label || (isDirect ? "Яндекс.Директ" : "Яндекс.Метрика")}</b>
          <span className="tmodal-sub">Трансформация данных: каждый шаг — новая таблица</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="tflow">
          {/* Шаг 0: исходные данные */}
          <section className="tstep">
            <div className="tstep-head">
              <span className="step-num">0</span>
              <b>Исходные данные</b>
              <span className="field-hint">{fetchSummary}</span>
              <span className="tstep-head-spacer" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenFetch}>
                Настроить выгрузку
              </button>
            </div>
            <StageTable
              sp={previews[0]}
              maxRows={steps.length === 0 ? ROWS_LAST : ROWS_MID}
              draggable={steps.length === 0}
              dragCol={dragCol}
              overCol={overCol}
              onDragStart={setDragCol}
              onDragOver={setOverCol}
              onDrop={moveColumn}
              onDragEnd={() => {
                setDragCol(null);
                setOverCol(null);
              }}
            />
          </section>

          {/* Контейнеры шагов */}
          {steps.map((step, i) => {
            const sp = previews[i + 1];
            const isLast = i === steps.length - 1;
            const pristine = JSON.stringify(step) === JSON.stringify(DEFAULT_STEPS[step.type]);
            return (
              <section className="tstep" key={i}>
                <div className="tstep-head">
                  <span className="step-num">{i + 1}</span>
                  <b>{stepLabel(step.type)}</b>
                  <span className="tstep-head-spacer" />
                  <span className="step-actions">
                    <button type="button" className="step-btn" onClick={() => moveStep(i, -1)} disabled={i === 0} title="Выше">↑</button>
                    <button type="button" className="step-btn" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} title="Ниже">↓</button>
                    <button type="button" className="step-btn step-btn-danger" onClick={() => removeStep(i)} title="Удалить шаг">×</button>
                  </span>
                </div>
                <div className="tstep-body">
                  <div className="tstep-form">
                    <StepForm
                      step={step}
                      columns={previews[i]?.result?.columns || []}
                      catalog={catalog}
                      onChange={(patch) => updateStep(i, patch)}
                    />
                    {sp?.error && (
                      <div className={pristine ? "field-hint tstep-note" : "alert alert-danger tstep-error"}>
                        {pristine
                          ? "Заполните поля шага — таблица обновится сама."
                          : `Шаг не применён: ${sp.error}`}
                      </div>
                    )}
                  </div>
                  <StageTable
                    sp={sp}
                    maxRows={isLast ? ROWS_LAST : ROWS_MID}
                    draggable={isLast}
                    dragCol={dragCol}
                    overCol={overCol}
                    onDragStart={setDragCol}
                    onDragOver={setOverCol}
                    onDrop={moveColumn}
                    onDragEnd={() => {
                      setDragCol(null);
                      setOverCol(null);
                    }}
                  />
                </div>
              </section>
            );
          })}

          <div className="tflow-add">
            <select
              className="input"
              value=""
              onChange={(e) => {
                if (e.target.value) addStep(e.target.value as StepType);
              }}
            >
              <option value="">+ Добавить шаг...</option>
              {catalog.step_types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="tmodal-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => recalc(0)} disabled={busy}>
            ⟳ Пересчитать всё
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => recalc(0, true)}
            disabled={busy}
            title="Заново сходить в API, минуя кэш"
          >
            ⟳ Из API
          </button>
          <span className="tmodal-status">
            {busy
              ? "Пересчёт..."
              : finalPreview?.result
                ? `Итог: ${finalPreview.result.row_count} строк`
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

// Таблица одного контейнера; в итоговой заголовки можно перетаскивать
function StageTable({
  sp,
  maxRows,
  draggable,
  dragCol,
  overCol,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  sp?: StagePreview;
  maxRows: number;
  draggable: boolean;
  dragCol: string | null;
  overCol: string | null;
  onDragStart: (col: string) => void;
  onDragOver: (col: string) => void;
  onDrop: (from: string, to: string) => void;
  onDragEnd: () => void;
}) {
  if (!sp || (!sp.result && !sp.error)) {
    return <div className="tstep-table"><div className="preview-status">Пересчёт...</div></div>;
  }
  if (!sp.result) {
    return <div className="tstep-table"><div className="preview-status">Таблица появится после исправления шага.</div></div>;
  }
  const { result } = sp;
  if (result.row_count === 0) {
    return <div className="tstep-table"><div className="preview-status">Данных нет (0 строк).</div></div>;
  }
  const rows = result.data.slice(0, maxRows);

  return (
    <div className={`tstep-table${sp.stale ? " is-stale" : ""}`}>
      <div className="tstep-scroll">
        <table className="table preview-table tmodal-table">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  draggable={draggable}
                  className={
                    (draggable && dragCol === col ? "th-dragging" : "") +
                    (draggable && overCol === col && dragCol && dragCol !== col ? " th-over" : "")
                  }
                  onDragStart={(e) => {
                    onDragStart(col);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", col);
                  }}
                  onDragOver={(e) => {
                    if (!draggable) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overCol !== col) onDragOver(col);
                  }}
                  onDrop={(e) => {
                    if (!draggable) return;
                    e.preventDefault();
                    // имя колонки несёт dataTransfer — state может отставать
                    const from = e.dataTransfer.getData("text/plain") || dragCol;
                    if (from) onDrop(from, col);
                    onDragEnd();
                  }}
                  onDragEnd={onDragEnd}
                  title={draggable ? "Перетащите, чтобы изменить порядок колонок" : undefined}
                >
                  {draggable && <span className="th-grip" aria-hidden="true">⠿</span>}
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {result.columns.map((col) => (
                  <td key={col}>{formatCell(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tstep-count">
        {result.row_count} строк{result.row_count > maxRows ? ` · показаны первые ${maxRows}` : ""}
        {sp.stale ? " · обновляется..." : ""}
      </div>
    </div>
  );
}
