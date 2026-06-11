// Мелкие переиспользуемые поля конструктора отчётов.
import { useId, useState } from "react";

type Option = { id: string; label: string };

// Текстовый инпут с подсказками колонок (datalist)
export function ColumnInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        className="input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

// Набор выбранных значений-чипов + инпут с подсказками для добавления
export function ChipsInput({
  values,
  onChange,
  suggestions,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  const listId = useId();
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const value = raw.trim();
    if (value && !values.includes(value)) {
      onChange([...values, value]);
    }
    setDraft("");
  };

  return (
    <div className="chips-input">
      {values.map((v) => (
        <span key={v} className="chip">
          {v}
          <button
            type="button"
            className="chip-remove"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Убрать ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="chips-input-field"
        list={listId}
        value={draft}
        placeholder={placeholder || "+ добавить"}
        onChange={(e) => {
          // выбор из datalist приходит как change с полным значением
          if (suggestions.includes(e.target.value)) {
            add(e.target.value);
          } else {
            setDraft(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !values.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}

// Сетка чекбоксов для выбора из каталога (срезы, показатели, метрики)
export function CheckboxGrid({
  options,
  selected,
  onChange,
  columns = 3,
}: {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columns?: number;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="checkbox-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {options.map((opt) => (
        <label key={opt.id} className="checkbox-grid-item" title={opt.id}>
          <input
            type="checkbox"
            checked={selected.includes(opt.id)}
            onChange={() => toggle(opt.id)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}
