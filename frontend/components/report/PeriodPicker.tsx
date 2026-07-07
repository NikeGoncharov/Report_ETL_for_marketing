// Выбор периода отчёта: выпадающий список пресетов; для произвольного
// периода — интерактивный календарь с выбором диапазона (два месяца рядом).
import { useState } from "react";
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

  return (
    <div className="period-picker">
      <div className="period-row">
        <select
          className="input period-select"
          value={period.type}
          onChange={(e) => onChange({ ...period, type: e.target.value })}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {isCustom && (
          <span className="period-range-label">
            {period.date_from || period.date_to ? (
              <>
                с <b>{fmtHuman(period.date_from)}</b> по <b>{fmtHuman(period.date_to)}</b>
              </>
            ) : (
              "выберите даты в календаре"
            )}
          </span>
        )}
      </div>

      {isCustom && (
        <RangeCalendar
          from={period.date_from || null}
          to={period.date_to || null}
          onChange={(from, to) => onChange({ ...period, date_from: from, date_to: to })}
        />
      )}
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
