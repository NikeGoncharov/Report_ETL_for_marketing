// Легаси-маршрут: редактирование теперь живёт в рабочем пространстве отчёта.
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function EditReportRedirect() {
  const router = useRouter();
  const { id, reportId } = router.query;

  useEffect(() => {
    if (id && reportId) {
      router.replace(`/projects/${id}/reports/${reportId}`);
    }
  }, [id, reportId]);

  return null;
}
