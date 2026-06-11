// Этап 3: сшивка датасетов (кампании <-> UTM) и группировка результата.
import { useState } from "react";
import {
  Catalog, DatasetConfig, GroupingConfig, MergeConfig,
  PipelineStage, PreviewResult,
} from "../../types/report";
import { ColumnInput, ChipsInput } from "./fields";
import { AggregationsEditor } from "./StepsEditor";
import PreviewTable from "./PreviewTable";
import { formatApiError } from "./DatasetCard";

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
              <label className="input-label">
                Ключ слева
                <ColumnInput
                  value={merge.left_key || ""}
                  onChange={(v) => onMergeChange({ ...merge, left_key: v })}
                  suggestions={columnsHint.length ? columnsHint : ["campaignname", "campaignid"]}
                  placeholder="например campaignname"
                />
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
                Ключ справа
                <ColumnInput
                  value={merge.right_key || ""}
                  onChange={(v) => onMergeChange({ ...merge, right_key: v })}
                  suggestions={["UTMCampaign", "UTMSource", "utm_campaign"]}
                  placeholder="например UTMCampaign"
                />
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
            <div className="field-hint">
              Значения ключей сравниваются как строки без учёта регистра — названия кампаний
              из Директа сматчатся с UTM-метками.
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
