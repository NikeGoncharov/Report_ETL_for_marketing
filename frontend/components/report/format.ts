// Человекочитаемые ошибки API для конструктора отчётов.
import { ApiError } from "../../lib/api";

export function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.message);
      if (typeof parsed.detail === "string") return parsed.detail;
      if (Array.isArray(parsed.detail)) {
        return parsed.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join("; ");
      }
    } catch {
      // не JSON — показываем как есть, но укорачиваем
    }
    return e.message.length > 300 ? `${e.message.slice(0, 300)}…` : e.message;
  }
  return e instanceof Error ? e.message : "Неизвестная ошибка";
}
