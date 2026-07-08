// Попап «Обновить выгрузку»: календарь дат (без пресетов) + запуск отчёта
// по сохранённым правилам. Меняются только даты — трансформации и экспорт
// остаются как настроены.
import { useEffect, useState } from "react";
import { RangeCalendar } from "./PeriodPicker";
import { PeriodConfig } from "../../types/report";

function fmtHuman(iso?: string | null): string {
  if (!iso) return "…";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export type RunRange = { from: string; to: string };

export default function RunReportModal({
  reportName,
  period,
  lastRunFrom,
  lastRunTo,
  onConfirm,
  onClose,
}: {
  reportName: string;
  // текущий период из конфига отчёта
  period?: PeriodConfig | null;
  // период последнего запуска — преселект, когда в конфиге пресет, а не даты
  lastRunFrom?: string | null;
  lastRunTo?: string | null;
  // range=null: даты не менялись — выгрузить по сохранённому периоду
  onConfirm: (range: RunRange | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<{ from: string | null; to: string | null }>(() => {
    if (period?.type === "custom" && period.date_from && period.date_to) {
      return { from: period.date_from, to: period.date_to };
    }
    if (lastRunFrom && lastRunTo) {
      return { from: lastRunFrom, to: lastRunTo };
    }
    return { from: null, to: null };
  });
  const [touched, setTouched] = useState(false);

  // Esc закрывает окно, скролл страницы блокируется (как в остальных модалках)
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

  const complete = Boolean(draft.from && draft.to);
  const halfPicked = Boolean(draft.from && !draft.to);

  return (
    <div
      className="tmodal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tmodal tmodal-run"
        role="dialog"
        aria-modal="true"
        aria-label={`Обновить выгрузку: ${reportName}`}
      >
        <div className="tmodal-head">
          <div>
            <div className="run-modal-title">Задать даты обновления</div>
            <div className="run-modal-range">
              {complete || halfPicked ? (
                <>
                  <b>{fmtHuman(draft.from)}</b> – <b>{fmtHuman(draft.to)}</b>
                </>
              ) : (
                "Период из сохранённых настроек отчёта"
              )}
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Закрыть">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="run-modal-body">
          <RangeCalendar
            from={draft.from}
            to={draft.to}
            monthsCount={3}
            onChange={(from, to) => {
              setDraft({ from, to });
              setTouched(true);
            }}
          />
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

        <div className="tmodal-foot run-modal-foot">
          <span className="run-modal-note">
            Правила отчёта сохранятся: обновятся только даты, выгрузка повторится
            по прежним настройкам.
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={halfPicked}
            title={halfPicked ? "Выберите последний день периода" : undefined}
            onClick={() => onConfirm(touched && complete ? { from: draft.from!, to: draft.to! } : null)}
          >
            Обновить
          </button>
        </div>
      </div>
    </div>
  );
}
