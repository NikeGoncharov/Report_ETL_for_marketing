// Редактор цепочки шагов трансформации датасета (состояние 2).
// Формы есть для всех типов шагов; подсказки колонок берутся из превью.
import { Catalog, StepConfig, StepType } from "../../types/report";
import { ColumnInput, ChipsInput } from "./fields";

const DEFAULT_STEPS: Record<StepType, StepConfig> = {
  filter: { type: "filter", column: "", operator: "eq", value: "" },
  extract: { type: "extract", column: "", pattern: "", output_column: "" },
  rename: { type: "rename", mapping: {} },
  calculate: { type: "calculate", output_column: "", formula: "" },
  group_by: { type: "group_by", columns: [], aggregations: {} },
  sort: { type: "sort", column: "", descending: false },
};

export default function StepsEditor({
  steps,
  columns,
  catalog,
  onChange,
}: {
  steps: StepConfig[];
  columns: string[];
  catalog: Catalog;
  onChange: (steps: StepConfig[]) => void;
}) {
  const stepLabel = (type: string) =>
    catalog.step_types.find((s) => s.id === type)?.label || type;

  const updateStep = (index: number, patch: Partial<StepConfig>) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addStep = (type: StepType) => {
    onChange([...steps, { ...DEFAULT_STEPS[type] }]);
  };

  return (
    <div className="steps-editor">
      {steps.map((step, i) => (
        <div key={i} className="step-row">
          <div className="step-row-header">
            <span className="step-num">{i + 1}</span>
            <span className="step-type">{stepLabel(step.type)}</span>
            <span className="step-actions">
              <button type="button" className="step-btn" onClick={() => moveStep(i, -1)} disabled={i === 0} title="Выше">↑</button>
              <button type="button" className="step-btn" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} title="Ниже">↓</button>
              <button type="button" className="step-btn step-btn-danger" onClick={() => removeStep(i)} title="Удалить шаг">×</button>
            </span>
          </div>
          <div className="step-row-body">
            <StepForm step={step} columns={columns} catalog={catalog} onChange={(patch) => updateStep(i, patch)} />
          </div>
        </div>
      ))}

      <div className="steps-add">
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
  );
}

function StepForm({
  step,
  columns,
  catalog,
  onChange,
}: {
  step: StepConfig;
  columns: string[];
  catalog: Catalog;
  onChange: (patch: Partial<StepConfig>) => void;
}) {
  switch (step.type) {
    case "filter": {
      const noValue = step.operator === "is_null" || step.operator === "not_null";
      return (
        <div className="step-fields">
          <ColumnInput value={step.column || ""} onChange={(v) => onChange({ column: v })} suggestions={columns} placeholder="Колонка" />
          <select className="input" value={step.operator || "eq"} onChange={(e) => onChange({ operator: e.target.value })}>
            {catalog.filter_operators.map((op) => (
              <option key={op.id} value={op.id}>{op.label}</option>
            ))}
          </select>
          {!noValue && (
            <input
              className="input"
              value={String(step.value ?? "")}
              onChange={(e) => {
                const raw = e.target.value;
                // числа сравниваются как числа: "100" в фильтре по клику — это 100
                const num = raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
                onChange({ value: num });
              }}
              placeholder="Значение"
            />
          )}
        </div>
      );
    }
    case "extract":
      return (
        <div className="step-fields">
          <ColumnInput value={step.column || ""} onChange={(v) => onChange({ column: v })} suggestions={columns} placeholder="Колонка-источник" />
          <input className="input" value={step.pattern || ""} onChange={(e) => onChange({ pattern: e.target.value })} placeholder="Regex, например cid[:_-]?(\d+)" />
          <input className="input" value={step.output_column || ""} onChange={(e) => onChange({ output_column: e.target.value })} placeholder="Новая колонка" />
        </div>
      );
    case "rename":
      return <MappingEditor mapping={step.mapping || {}} columns={columns} onChange={(mapping) => onChange({ mapping })} />;
    case "calculate":
      return (
        <div className="step-fields">
          <input className="input" value={step.output_column || ""} onChange={(e) => onChange({ output_column: e.target.value })} placeholder="Новая колонка (например cpc)" />
          <input className="input step-grow" value={step.formula || ""} onChange={(e) => onChange({ formula: e.target.value })} placeholder="Формула, например cost / clicks" />
        </div>
      );
    case "group_by":
      return (
        <div className="step-fields-column">
          <div>
            <div className="field-hint">Группировать по колонкам:</div>
            <ChipsInput values={step.columns || []} onChange={(v) => onChange({ columns: v })} suggestions={columns} />
          </div>
          <div>
            <div className="field-hint">Агрегации:</div>
            <AggregationsEditor
              aggregations={step.aggregations || {}}
              columns={columns}
              catalogAggs={catalog.aggregations}
              onChange={(aggregations) => onChange({ aggregations })}
            />
          </div>
        </div>
      );
    case "sort":
      return (
        <div className="step-fields">
          <ColumnInput value={step.column || ""} onChange={(v) => onChange({ column: v })} suggestions={columns} placeholder="Колонка" />
          <label className="inline-checkbox">
            <input type="checkbox" checked={Boolean(step.descending)} onChange={(e) => onChange({ descending: e.target.checked })} />
            по убыванию
          </label>
        </div>
      );
    default:
      return null;
  }
}

// Пары «старое имя → новое имя» для rename
function MappingEditor({
  mapping,
  columns,
  onChange,
}: {
  mapping: Record<string, string>;
  columns: string[];
  onChange: (mapping: Record<string, string>) => void;
}) {
  const entries = Object.entries(mapping);

  return (
    <div className="step-fields-column">
      {entries.map(([from, to], i) => (
        <div key={i} className="step-fields">
          <ColumnInput
            value={from}
            onChange={(v) => {
              const next: Record<string, string> = {};
              entries.forEach(([f, t], j) => {
                next[j === i ? v : f] = t;
              });
              onChange(next);
            }}
            suggestions={columns}
            placeholder="Старое имя"
          />
          <span className="field-arrow">→</span>
          <input
            className="input"
            value={to}
            onChange={(e) => onChange({ ...mapping, [from]: e.target.value })}
            placeholder="Новое имя"
          />
          <button
            type="button"
            className="step-btn step-btn-danger"
            onClick={() => {
              const next = { ...mapping };
              delete next[from];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange({ ...mapping, "": "" })}
        disabled={"" in mapping}
      >
        + Переименование
      </button>
    </div>
  );
}

// Пары «колонка → функция» для группировки
export function AggregationsEditor({
  aggregations,
  columns,
  catalogAggs,
  onChange,
}: {
  aggregations: Record<string, string>;
  columns: string[];
  catalogAggs: { id: string; label: string }[];
  onChange: (aggregations: Record<string, string>) => void;
}) {
  const entries = Object.entries(aggregations);

  return (
    <div className="step-fields-column">
      {entries.map(([col, agg], i) => (
        <div key={i} className="step-fields">
          <ColumnInput
            value={col}
            onChange={(v) => {
              const next: Record<string, string> = {};
              entries.forEach(([c, a], j) => {
                next[j === i ? v : c] = a;
              });
              onChange(next);
            }}
            suggestions={columns}
            placeholder="Колонка"
          />
          <select className="input" value={agg} onChange={(e) => onChange({ ...aggregations, [col]: e.target.value })}>
            {catalogAggs.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="step-btn step-btn-danger"
            onClick={() => {
              const next = { ...aggregations };
              delete next[col];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange({ ...aggregations, "": "sum" })}
        disabled={"" in aggregations}
      >
        + Агрегация
      </button>
    </div>
  );
}
