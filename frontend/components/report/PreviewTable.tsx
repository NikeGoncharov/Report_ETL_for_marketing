// Таблица предпросмотра данных на любой стадии пайплайна.
import { PreviewResult } from "../../types/report";

export default function PreviewTable({
  preview,
  loading,
  error,
  maxRows = 10,
}: {
  preview: PreviewResult | null;
  loading?: boolean;
  error?: string | null;
  maxRows?: number;
}) {
  if (loading) {
    return <div className="preview-status">Загрузка данных...</div>;
  }
  if (error) {
    return <div className="alert alert-danger preview-error">{error}</div>;
  }
  if (!preview) {
    return null;
  }
  if (preview.row_count === 0) {
    return <div className="preview-status">Данных за выбранный период нет.</div>;
  }

  const rows = preview.data.slice(0, maxRows);

  return (
    <div className="preview-wrap">
      <div className="preview-scroll">
        <table className="table preview-table">
          <thead>
            <tr>
              {preview.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {preview.columns.map((col) => (
                  <td key={col}>{formatCell(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="preview-status">
        Строк всего: {preview.row_count}
        {preview.row_count > maxRows ? ` (показаны первые ${maxRows})` : ""}
      </div>
    </div>
  );
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}
