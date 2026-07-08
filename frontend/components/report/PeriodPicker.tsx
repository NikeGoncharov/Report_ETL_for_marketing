// Выбор периода отчёта: выпадающий список фиксированных пресетов, рядом —
// кнопка «Произвольный период», открывающая календарь-попап. Диапазон
// применяется, когда выбраны обе даты, после чего календарь закрывается сам.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PeriodConfig } from "../../types/report";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function fmtHuman(iso?: string | null): string {
  if (!iso) return "…";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export default function PeriodPicker({
  period,
  presets,
  onChange,
}: {
  period: PeriodConfig;
  presets: { id: string; label: string }[];
  onChange: (period: PeriodConfig) => void;
}) {
  const isCustom = period.type === "custom";
  const hasRange = Boolean(period.date_from && period.date_to);

  const [open, setOpen] = useState(false);
  // Черновик диапазона живёт, пока открыт календарь; в конфиг попадает только
  // полный диапазон — брошенный на полпути выбор ничего не меняет.
  const [draft, setDraft] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const customRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const customLabel = presets.find((p) => p.id === "custom")?.label || "Произвольный период";
  const fixedPresets = presets.filter((p) => p.id !== "custom");

  // Попап прижимается к правому краю кнопки, если справа не хватает места.
  // Правка DOM напрямую: попап размонтируется при закрытии, класс уйдёт с ним.
  useLayoutEffect(() => {
    if (!open) return;
    const pop = popoverRef.current;
    const anchor = customRef.current;
    if (!pop || !anchor) return;
    const overflowsRight = pop.getBoundingClientRect().right > window.innerWidth - 12;
    const fitsWhenRight = anchor.getBoundingClientRect().right - pop.offsetWidth >= 12;
    if (overflowsRight && fitsWhenRight) pop.classList.add("align-right");
  }, [open]);

  const toggleCalendar = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setDraft({
      from: isCustom ? period.date_from || null : null,
      to: isCustom ? period.date_to || null : null,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (customRef.current && !customRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickDraft = (from: string | null, to: string | null) => {
    setDraft({ from, to });
    if (from && to) {
      onChange({ ...period, type: "custom", date_from: from, date_to: to });
      setOpen(false);
    }
  };

  return (
    <div className="period-picker">
      <div className="period-row">
        <select
          className="input period-select"
          value={isCustom ? "custom" : period.type}
          onChange={(e) => {
            setOpen(false);
            onChange({ ...period, type: e.target.value });
          }}
        >
          {fixedPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {isCustom && (
            <option value="custom" hidden>
              {customLabel}
            </option>
          )}
        </select>

        <div className="period-custom" ref={customRef}>
          <button
            type="button"
            className={
              "period-custom-btn" + (isCustom ? " is-active" : "") + (open ? " is-open" : "")
            }
            onClick={toggleCalendar}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M3 10h18" />
            </svg>
            {isCustom && hasRange ? (
              <span>
                с <b>{fmtHuman(period.date_from)}</b> по <b>{fmtHuman(period.date_to)}</b>
              </span>
            ) : (
              <span>{customLabel}</span>
            )}
          </button>

          {open && (
            <div className="period-popover" ref={popoverRef} role="dialog" aria-label={customLabel}>
              <RangeCalendar from={draft.from} to={draft.to} onChange={pickDraft} />
              <div className="period-popover-hint">
                {!draft.from ? (
                  "Выберите первый день периода"
                ) : !draft.to ? (
                  <span>
                    с <b>{fmtHuman(draft.from)}</b> — теперь выберите последний день
                  </span>
                ) : (
                  "Клик по любой дате начнёт выбор заново"
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Календарь диапазона: клик — начало, второй клик — конец.
// Будущие даты недоступны (отчётные API отдают только прошлое).
function RangeCalendar({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const todayISO = toISO(new Date());
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // Левый из двух видимых месяцев; правый не листается дальше текущего
  const [view, setView] = useState<Date>(() => {
    const maxLeft = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1);
    if (!from) return maxLeft;
    const base = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1);
    return base > maxLeft ? maxLeft : base;
  });
  const [hover, setHover] = useState<string | null>(null);

  const shift = (delta: number) => {
    const next = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    const maxLeft = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1);
    setView(next > maxLeft ? maxLeft : next);
  };

  const pick = (iso: string) => {
    if (!from || (from && to)) {
      onChange(iso, null);
    } else if (iso < from) {
      onChange(iso, null);
    } else {
      onChange(from, iso);
    }
  };

  // Подсветка диапазона: выбранный from..to, а пока конец не выбран — from..hover
  const rangeEnd = to || (from && hover && hover > from ? hover : null);
  const inRange = (iso: string) =>
    Boolean(from && rangeEnd && iso > from && iso < rangeEnd);

  const months = [view, new Date(view.getFullYear(), view.getMonth() + 1, 1)];

  return (
    <div className="cal" onMouseLeave={() => setHover(null)}>
      {months.map((month, mi) => {
        const y = month.getFullYear();
        const m = month.getMonth();
        const offset = (new Date(y, m, 1).getDay() + 6) % 7; // неделя с понедельника
        const days = new Date(y, m + 1, 0).getDate();
        const nextDisabled = months[1].getTime() >= thisMonth.getTime();

        return (
          <div className="cal-month" key={`${y}-${m}`}>
            <div className="cal-head">
              {mi === 0 ? (
                <button type="button" className="step-btn" onClick={() => shift(-1)} title="Раньше">
                  ‹
                </button>
              ) : (
                <span className="cal-nav-spacer" />
              )}
              <span className="cal-title">
                {MONTHS[m]} {y}
              </span>
              {mi === 1 ? (
                <button
                  type="button"
                  className="step-btn"
                  onClick={() => shift(1)}
                  disabled={nextDisabled}
                  title="Позже"
                >
                  ›
                </button>
              ) : (
                <span className="cal-nav-spacer" />
              )}
            </div>
            <div className="cal-grid">
              {DOW.map((d) => (
                <span key={d} className="cal-dow">
                  {d}
                </span>
              ))}
              {Array.from({ length: offset }).map((_, i) => (
                <span key={`b${i}`} />
              ))}
              {Array.from({ length: days }).map((_, i) => {
                const iso = `${y}-${pad(m + 1)}-${pad(i + 1)}`;
                const disabled = iso > todayISO;
                const isStart = iso === from;
                const isEnd = iso === (to || rangeEnd);
                const cls = [
                  "cal-day",
                  isStart || (isEnd && to) ? "is-edge" : "",
                  isEnd && !to ? "is-hover-edge" : "",
                  inRange(iso) ? "is-range" : "",
                  iso === todayISO ? "is-today" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={iso}
                    type="button"
                    className={cls}
                    disabled={disabled}
                    onClick={() => pick(iso)}
                    onMouseEnter={() => setHover(iso)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
