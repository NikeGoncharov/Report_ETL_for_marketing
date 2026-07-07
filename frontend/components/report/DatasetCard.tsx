// Компактная карточка датасета в ленте пайплайна. Показывает состояние
// («выгружено / не выгружено», число шагов) и открывает панель настройки.
// Вся конфигурация — в DatasetDrawer.
import { DatasetConfig } from "../../types/report";
import { DrawerTab } from "./DatasetDrawer";

export type DatasetFetchState = {
  stage: "fetched" | "transformed";
  rows: number;
};

export default function DatasetCard({
  dataset,
  fetchState,
  onOpen,
  onRemove,
}: {
  dataset: DatasetConfig;
  fetchState?: DatasetFetchState;
  onOpen: (tab: DrawerTab) => void;
  onRemove: () => void;
}) {
  const isDirect = dataset.type === "direct";
  const fetched = Boolean(fetchState);
  const stepsCount = dataset.steps.length;

  return (
    <div className={`ds-card${fetched ? " is-fetched" : ""}`}>
      <div className="ds-card-head">
        <span className={`dataset-badge dataset-badge-${dataset.type}`}>
          {isDirect ? "Директ" : "Метрика"}
        </span>
        <span className="ds-card-title" title={dataset.label || dataset.id}>
          {dataset.label || (isDirect ? "Яндекс.Директ" : "Яндекс.Метрика")}
        </span>
        <button type="button" className="step-btn step-btn-danger" onClick={onRemove} title="Удалить источник">
          ×
        </button>
      </div>

      <button type="button" className="ds-row" onClick={() => onOpen("params")}>
        <span className="step-num">1</span>
        <span className="ds-row-body">
          <b>Выгрузка</b>
          {fetched ? (
            <small className="ds-ok">✓ {fetchState!.rows} строк</small>
          ) : (
            <small>настройте срезы и выгрузите</small>
          )}
        </span>
        <span className="ds-row-action">{fetched ? "Изменить" : "Настроить"}</span>
      </button>

      <button
        type="button"
        className="ds-row"
        onClick={() => onOpen("steps")}
        disabled={!fetched}
        title={fetched ? "" : "Сначала сделайте предварительную выгрузку"}
      >
        <span className="step-num">2</span>
        <span className="ds-row-body">
          <b>Трансформация</b>
          {fetched ? (
            <small>
              {stepsCount > 0 ? `${stepsCount} ${stepsWord(stepsCount)}` : "шагов пока нет"}
              {fetchState!.stage === "transformed" ? " · проверено" : ""}
            </small>
          ) : (
            <small className="ds-locked">откроется после выгрузки</small>
          )}
        </span>
        <span className="ds-row-action">{fetched ? "Открыть" : "🔒"}</span>
      </button>
    </div>
  );
}

function stepsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "шаг";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "шага";
  return "шагов";
}
