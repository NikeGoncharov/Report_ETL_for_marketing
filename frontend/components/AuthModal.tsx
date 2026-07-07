// Попап входа/регистрации поверх лендинга. Страницы /login и /register продолжают работать
// как самостоятельные (диплинки, 401-редиректы) — формы общие, см. components/auth/AuthForms.tsx.
import { useEffect, useRef } from "react";
import { LoginForm, RegisterForm } from "./auth/AuthForms";

export type AuthMode = "login" | "register";

export default function AuthModal({
  mode,
  onClose,
  onSwitchMode,
  onSuccess,
}: {
  mode: AuthMode;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  onSuccess: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Esc закрывает попап, скролл страницы под ним блокируется
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const isLogin = mode === "login";

  return (
    <div
      className="auth-modal-overlay"
      onMouseDown={(e) => {
        // Закрываем только по клику в подложку, не по карточке
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="auth-modal"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={isLogin ? "Вход" : "Регистрация"}
      >
        <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <img src="/logo.png" alt="Report" className="auth-logo" />

        <h2 className="auth-title">{isLogin ? "Вход" : "Регистрация"}</h2>
        <p className="auth-subtitle">{isLogin ? "Войдите в свой аккаунт Report" : "Создайте аккаунт Report"}</p>

        {isLogin ? (
          <LoginForm onSuccess={onSuccess} autoFocus />
        ) : (
          <RegisterForm onSuccess={onSuccess} autoFocus />
        )}

        <div className="auth-footer">
          {isLogin ? (
            <>
              Нет аккаунта?{" "}
              <button type="button" className="auth-switch" onClick={() => onSwitchMode("register")}>
                Зарегистрироваться
              </button>
            </>
          ) : (
            <>
              Уже есть аккаунт?{" "}
              <button type="button" className="auth-switch" onClick={() => onSwitchMode("login")}>
                Войти
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
