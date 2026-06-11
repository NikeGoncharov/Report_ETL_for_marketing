// Создание отчёта: имя + стартовые датасеты. Вся настройка пайплайна —
// в рабочем пространстве отчёта, куда происходит редирект после создания.
import { useRouter } from "next/router";
import { useState } from "react";
import Link from "next/link";
import Layout from "../../../../components/Layout";
import { reportsApi } from "../../../../lib/api";
import { defaultConfig, defaultDataset } from "../../../../types/report";
import { formatApiError } from "../../../../components/report/DatasetCard";

export default function NewReportPage() {
  const router = useRouter();
  const { id } = router.query;
  const projectId = Number(id);

  const [name, setName] = useState("");
  const [withDirect, setWithDirect] = useState(true);
  const [withMetrika, setWithMetrika] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) {
      setError("Укажите название отчёта");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const config = defaultConfig();
      if (withDirect) {
        config.datasets.push(defaultDataset("direct", []));
      }
      if (withMetrika) {
        config.datasets.push(defaultDataset("metrika", config.datasets.map((d) => d.id)));
      }
      const report = await reportsApi.create(projectId, {
        name: name.trim(),
        config: config as unknown as Record<string, unknown>,
      });
      router.push(`/projects/${projectId}/reports/${report.id}`);
    } catch (e) {
      setError(formatApiError(e));
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="breadcrumb">
        <Link href="/dashboard">Аккаунт</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href={`/projects/${id}`}>Проект</Link>
        <span className="breadcrumb-separator">/</span>
        <span>Новый отчёт</span>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-header">
          <h3>Новый отчёт</h3>
        </div>
        <div className="card-body">
          {error && <div className="alert alert-danger">{error}</div>}

          <label className="input-label">
            Название
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Сводка по бренду"
              autoFocus
            />
          </label>

          <div className="field-hint" style={{ margin: "16px 0 8px" }}>
            С каких источников начать (датасеты можно добавить и позже):
          </div>
          <label className="inline-checkbox">
            <input type="checkbox" checked={withDirect} onChange={(e) => setWithDirect(e.target.checked)} />
            Яндекс.Директ — расход, показы, клики
          </label>
          <label className="inline-checkbox">
            <input type="checkbox" checked={withMetrika} onChange={(e) => setWithMetrika(e.target.checked)} />
            Яндекс.Метрика — визиты, отказы, конверсии
          </label>

          <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              {creating ? "Создание..." : "Создать и настроить"}
            </button>
            <Link href={`/projects/${id}`} className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
