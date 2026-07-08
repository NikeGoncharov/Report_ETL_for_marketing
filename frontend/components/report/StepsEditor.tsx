// Формы шагов трансформации. Используются контейнерами workflow
// в TransformModal; AggregationsEditor также нужен этапу сшивки/группировки.
import { Catalog, StepConfig, StepType } from "../../types/report";
import { ColumnInput, ChipsInput } from "./fields";

export const DEFAULT_STEPS: Record<StepType, StepConfig> = {
  filter: { type: "filter", column: "", operator: "eq", value: "" },
  extract: { type: "extract", column: "", pattern: "", output_column: "" },
  rename: { type: "rename", mapping: {} },
  calculate: { type: "calculate", output_column: "", formula: "" },
  group_by: { type: "group_by", columns: [], aggregations: {} },
  sort: { type: "sort", column: "", descending: false },
  find_replace: { type: "find_replace", column: "", find: "", replace: "" },
  merge_rows: { type: "merge_rows", mode: "condition", column: "", operator: "contains", value: "", group_name: "", aggregations: {} },
  columns: { type: "columns", columns: [] },
};

// Подмножество операторов для «Объединения по признаку» (текстовые условия)
const MERGE_OPERATOR_IDS = ["contains", "startswith", "endswith", "eq"];

export function StepForm({
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
    case "find_replace":
      return (
        <div className="step-fields-column">
          <ColumnInput value={step.column || ""} onChange={(v) => onChange({ column: v })} suggestions={columns} placeholder="Колонка" />
          <div className="step-fields">
            <input
              className="input"
              value={step.find || ""}
              onChange={(e) => onChange({ find: e.target.value })}
              placeholder="Найти (напр. _*)"
            />
            <span className="field-arrow">→</span>
            <input
              className="input"
              value={step.replace || ""}
              onChange={(e) => onChange({ replace: e.target.value })}
              placeholder="Заменить на (пусто = удалить)"
            />
          </div>
          <div className="field-hint">
            Как в Excel: <code>*</code> — любые символы. «Найти <code>_*</code>, заменить на пусто» удалит
            «_» и всё после него. Регистр не учитывается.
          </div>
        </div>
      );
    case "merge_rows": {
      const mode = step.mode === "values" ? "values" : "condition";
      return (
        <div className="step-fields-column">
          <select
            className="input"
            value={mode}
            onChange={(e) => onChange({ mode: e.target.value as "condition" | "values" })}
          >
            <option value="condition">Объединить строки по условию</option>
            <option value="values">Сгруппировать по значениям среза</option>
          </select>
          <ColumnInput
            value={step.column || ""}
            onChange={(v) => onChange({ column: v })}
            suggestions={columns}
            placeholder="Срез (напр. adnetworktype)"
          />
          {mode === "condition" ? (
            <>
              <div className="step-fields">
                <select className="input" value={step.operator || "contains"} onChange={(e) => onChange({ operator: e.target.value })}>
                  {catalog.filter_operators
                    .filter((op) => MERGE_OPERATOR_IDS.includes(op.id))
                    .map((op) => (
                      <option key={op.id} value={op.id}>{op.label}</option>
                    ))}
                </select>
                <input
                  className="input"
                  value={String(step.value ?? "")}
                  onChange={(e) => onChange({ value: e.target.value })}
                  placeholder="Признак (напр. search)"
                />
              </div>
              <input
                className="input"
                value={step.group_name || ""}
                onChange={(e) => onChange({ group_name: e.target.value })}
                placeholder="Название объединённой строки (напр. Search-кампании)"
              />
              <div className="field-hint">
                Совпавшие строки объединятся в одну, несовпавшие останутся как есть.
              </div>
            </>
          ) : (
            <div className="field-hint">
              Каждое уникальное значение среза станет одной строкой: было 3 кампании
              Поиска и 2 Сетей — станет две строки, числа просуммируются.
            </div>
          )}
          <div>
            <div className="field-hint">Числа суммируются автоматически — здесь можно выбрать другую функцию:</div>
            <AggregationsEditor
              aggregations={step.aggregations || {}}
              columns={columns}
              catalogAggs={catalog.aggregations}
              onChange={(aggregations) => onChange({ aggregations })}
            />
          </div>
        </div>
      );
    }
    case "columns":
      return (
        <div className="step-fields-column">
          <ChipsInput values={step.columns || []} onChange={(v) => onChange({ columns: v })} suggestions={columns} />
          <div className="field-hint">
            Перечисленные колонки идут первыми, остальные — следом. Проще всего перетащить
            заголовки в итоговой таблице — шаг обновится сам.
          </div>
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
        <div key={i} className="agg-row agg-row-map">
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

// Пары «колонка → функция» для группировки и объединения. Компактные строки.
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
        <div key={i} className="agg-row">
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
