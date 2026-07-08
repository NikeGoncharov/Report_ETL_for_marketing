import { integrationsApi } from "./api";

export type OAuthDone = { success: boolean; error?: string };

// Открывает OAuth-авторизацию интеграции в popup.
// Пользователь остаётся на странице (в браузере он уже залогинен в Яндекс/Google),
// popup после callback постит `oauth-done` родительскому окну и закрывается.
// onDone вызывается ровно один раз: по сообщению либо по закрытию окна вручную.
export async function connectIntegrationPopup(
  projectId: number,
  type: string,
  onDone: (result: OAuthDone) => void,
): Promise<void> {
  const data =
    type === "google_sheets"
      ? await integrationsApi.googleAuthUrl(projectId)
      : await integrationsApi.yandexAuthUrl(projectId, type);

  const width = 520;
  const height = 640;
  const left = Math.round((window.screen.width - width) / 2);
  const top = Math.round((window.screen.height - height) / 2);
  const popup = window.open(
    data.auth_url,
    "oauth",
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );

  let settled = false;
  const finish = (result: OAuthDone) => {
    if (settled) return;
    settled = true;
    window.removeEventListener("message", handleMessage);
    clearInterval(timer);
    onDone(result);
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "oauth-done") return;
    finish({ success: !event.data.error, error: event.data.error ?? undefined });
  };

  window.addEventListener("message", handleMessage);
  const timer = setInterval(() => {
    if (!popup || popup.closed) {
      finish({ success: false });
    }
  }, 300);
}

// Человекочитаемое сообщение об ошибке подключения
export function oauthErrorMessage(error?: string): string | null {
  if (!error) return null;
  return error === "token_exchange_failed"
    ? "Не удалось получить токен. Проверьте Redirect URI в настройках приложения и переменные на сервере."
    : "Ошибка подключения интеграции";
}
