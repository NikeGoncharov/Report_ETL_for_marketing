// Этап 3: сшивка датасетов (кампании <-> UTM) и группировка результата.
import { useState } from "react";
import {
  Catalog, DatasetConfig, GroupingConfig, MergeConfig,
  PipelineStage, PreviewResult,
} from "../../types/report";
import { ColumnInput, ChipsInput } from "./fields";
import { AggregationsEditor } from "./StepsEditor";
import PreviewTable from "./PreviewTable";
import { formatApiError } from "./format";

export default function StageThreePanel({
  merge,
  grouping,
  datasets,
  columnsHint,
  catalog,
  onMergeChange,
  onGroupingChange,
  onPreview,
}: {
  merge: MergeConfig;
  grouping: GroupingConfig;
  datasets: DatasetConfig[];
  // последние известные колонки результата (для подсказок группировки/ключей)
  columnsHint: string[];
  catalog: Catalog;
  onMergeChange: (merge: MergeConfig) => void;
  onGroupingChange: (grouping: GroupingConfig) => void;
  onPreview: (stage: PipelineStage) => Promise<PreviewResult>;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [stageShown, setStageShown] = useState<PipelineStage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = async (stage: PipelineStage) => {
    setLoading(true);
    setError(null);
    try {
      const result = await onPreview(stage);
      setPreview(result);
      setStageShown(stage);
    } catch (e) {
      setPreview(null);
      setStageShown(null);
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const datasetOptions = datasets.map((d) => ({
    id: d.id,
    label: d.label || d.id,
  }));

  // Ключи сшивки: работаем со списком пар. Старые конфиги хранят одиночные
  // left_key/right_key — разворачиваем их в список из одной пары.
  const keyPairs: Array<{ left: string; right: string }> = (() => {
    const left = merge.left_keys ?? (merge.left_key ? [merge.left_key] : [""]);
    const right = merge.right_keys ?? (merge.right_key ? [merge.right_key] : [""]);
    const count = Math.max(left.length, right.length, 1);
    return Array.from({ length: count }, (_, i) => ({
      left: left[i] ?? "",
      right: right[i] ?? "",
    }));
  })();

  const writeKeyPairs = (pairs: Array<{ left: string; right: string }>) => {
    // Полностью пустые пары в конфиг не уходят: бэкенд их отбрасывает, и
    // расхождение «в UI три пары, реально сшивка по одной» только путает.
    const meaningful = pairs.filter((p) => p.left.trim() || p.right.trim());
    const left_keys = meaningful.map((p) => p.left);
    const right_keys = meaningful.map((p) => p.right);
    onMergeChange({
      ...merge,
      left_keys,
      right_keys,
      // одиночные поля держим синхронными с первой парой (обратная совместимость)
      left_key: left_keys[0] || "",
      right_key: right_keys[0] || "",
    });
  };

  // Наполовину заполненная пара — ошибка: бэкенд такую сшивку отклонит
  const halfFilledPair = keyPairs.some(
    (p) => Boolean(p.left.trim()) !== Boolean(p.right.trim()),
  );

  const setKeyPair = (index: number, pair: { left: string; right: string }) =>
    writeKeyPairs(keyPairs.map((p, i) => (i === index ? pair : p)));

  const addKeyPair = () => writeKeyPairs([...keyPairs, { left: "", right: "" }]);

  const removeKeyPair = (index: number) =>
    writeKeyPairs(keyPairs.filter((_, i) => i !== index));

  return (
    <div className="stage-three">
      {/* Сшивка */}
      <div className="panel-block">
        <label className="inline-checkbox panel-toggle">
          <input
            type="checkbox"
            checked={merge.enabled}
            onChange={(e) => onMergeChange({ ...merge, enabled: e.target.checked })}
            disabled={datasets.length < 2}
          />
          <strong>Сшивка датасетов</strong>
          {datasets.length < 2 && <span className="field-hint">— нужно минимум два датасета</span>}
        </label>

        {merge.enabled && (
          <div className="merge-fields">
            <div className="step-fields">
              <label className="input-label">
                Левый (основа)
                <select
                  className="input"
                  value={merge.left || ""}
                  onChange={(e) => onMergeChange({ ...merge, left: e.target.value })}
                >
                  <option value="">—</option>
                  {datasetOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="step-fields">
              <label className="input-label">
                Правый (присоединяем)
                <select
                  className="input"
                  value={merge.right || ""}
                  onChange={(e) => onMergeChange({ ...merge, right: e.target.value })}
                >
                  <option value="">—</option>
                  {datasetOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
              <label className="input-label">
                Тип
                <select
                  className="input"
                  value={merge.how}
                  onChange={(e) => onMergeChange({ ...merge, how: e.target.value as MergeConfig["how"] })}
                >
                  <option value="left">left — все строки слева</option>
                  <option value="inner">inner — только совпавшие</option>
                  <option value="right">right — все строки справа</option>
                  <option value="outer">outer — все строки</option>
                </select>
              </label>
            </div>

            {/* Ключи сшивки: пар может быть несколько. Для дневных датасетов
                в ключ обязательно добавлять дату, иначе каждый день слева
                склеится с каждым днём справа и суммы будут завышены. */}
            {keyPairs.map((pair, index) => (
              <div className="step-fields" key={index}>
                <label className="input-label">
                  {index === 0 ? "Ключ слева" : `Ключ слева ${index + 1}`}
                  <ColumnInput
                    value={pair.left}
                    onChange={(v) => setKeyPair(index, { ...pair, left: v })}
                    suggestions={columnsHint.length ? columnsHint : ["campaignname", "campaignid", "date"]}
                    placeholder={index === 0 ? "например campaignname" : "например date"}
                  />
                </label>
                <label className="input-label">
                  {index === 0 ? "Ключ справа" : `Ключ справа ${index + 1}`}
                  <ColumnInput
                    value={pair.right}
                    onChange={(v) => setKeyPair(index, { ...pair, right: v })}
                    suggestions={["UTMCampaign", "UTMSource", "utm_campaign", "date"]}
                    placeholder={index === 0 ? "например UTMCampaign" : "например date"}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => removeKeyPair(index)}
                  disabled={keyPairs.length === 1 && !pair.left && !pair.right}
                >
                  Убрать
                </button>
              </div>
            ))}
            <div className="step-fields">
              <button type="button" className="btn btn-secondary btn-sm" onClick={addKeyPair}>
                + Добавить ключ
              </button>
            </div>

            {halfFilledPair && (
              <div className="field-hint" style={{ color: "var(--danger)" }}>
                В одной из пар заполнена только половина — укажите колонку с обеих
                сторон или уберите пару, иначе сшивка не выполнится.
              </div>
            )}

            <div className="field-hint">
              Значения ключей сравниваются как строки без учёта регистра — названия кампаний
              из Директа сматчатся с UTM-метками. Если оба датасета выгружены по дням,
              добавьте вторым ключом дату: иначе каждый день слева склеится с каждым днём
              справа и расход в отчёте будет завышен кратно числу дней.
            </div>
          </div>
        )}
      </div>

      {/* Группировка */}
      <div className="panel-block">
        <label className="inline-checkbox panel-toggle">
          <input
            type="checkbox"
            checked={grouping.enabled}
            onChange={(e) => onGroupingChange({ ...grouping, enabled: e.target.checked })}
          />
          <strong>Группировка результата</strong>
          <span className="field-hint">— например, по типу площадки: Поиск и РСЯ отдельно</span>
        </label>

        {grouping.enabled && (
          <div className="merge-fields">
            <div>
              <div className="field-hint">Группировать по колонкам:</div>
              <ChipsInput
                values={grouping.columns}
                onChange={(columns) => onGroupingChange({ ...grouping, columns })}
                suggestions={columnsHint}
              />
            </div>
            <div>
              <div className="field-hint">Агрегации (что делать с остальными колонками):</div>
              <AggregationsEditor
                aggregations={grouping.aggregations}
                columns={columnsHint}
                catalogAggs={catalog.aggregations}
                onChange={(aggregations) => onGroupingChange({ ...grouping, aggregations })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="dataset-preview-actions">
        {merge.enabled && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => runPreview("merged")} disabled={loading}>
            Превью сшивки
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => runPreview("final")} disabled={loading}>
          {loading ? "Загрузка..." : "Превью результата"}
        </button>
        {stageShown && !loading && !error && (
          <span className="preview-stage-label">
            {stageShown === "merged" ? "После сшивки (до группировки)" : "Итоговый результат"}
          </span>
        )}
      </div>

      <PreviewTable preview={preview} loading={loading} error={error} />
    </div>
  );
}
