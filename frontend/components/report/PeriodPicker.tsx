// Выбор периода отчёта: пресеты как в Мастере отчётов Яндекса + произвольный.
import { PeriodConfig } from "../../types/report";

export default function PeriodPicker({
  period,
  presets,
  onChange,
}: {
  period: PeriodConfig;
  presets: { id: string; label: string }[];
  onChange: (period: PeriodConfig) => void;
}) {
  return (
    <div className="period-picker">
      <div className="period-presets">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`period-preset ${period.type === p.id ? "active" : ""}`}
            onClick={() => onChange({ ...period, type: p.id })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period.type === "custom" && (
        <div className="period-custom">
          <label className="input-label">
            с
            <input
              type="date"
              className="input"
              value={period.date_from || ""}
              onChange={(e) => onChange({ ...period, date_from: e.target.value })}
            />
          </label>
          <label className="input-label">
            по
            <input
              type="date"
              className="input"
              value={period.date_to || ""}
              onChange={(e) => onChange({ ...period, date_to: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
