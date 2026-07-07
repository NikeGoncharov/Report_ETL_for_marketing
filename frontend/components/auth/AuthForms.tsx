// Формы входа и регистрации, общие для страниц /login, /register и попапа на лендинге.
import { useState } from "react";
import { authApi } from "../../lib/api";

type FormProps = {
  onSuccess: () => void;
  autoFocus?: boolean;
};

export function LoginForm({ onSuccess, autoFocus }: FormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authApi.login(email, password);
      onSuccess();
    } catch {
      setError("Неверный email или пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="input-group">
        <label htmlFor="auth-email" className="input-label">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          className="input"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={autoFocus}
          required
        />
      </div>

      <div className="input-group">
        <label htmlFor="auth-password" className="input-label">
          Пароль
        </label>
        <input
          id="auth-password"
          type="password"
          className="input"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: "100%" }}>
        {loading ? "Вход..." : "Войти"}
      </button>
    </form>
  );
}

export function RegisterForm({ onSuccess, autoFocus }: FormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    if (password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return;
    }

    setLoading(true);

    try {
      await authApi.register(email, password);
      await authApi.login(email, password);
      onSuccess();
    } catch (err) {
      const e = err as { status?: number; statusCode?: number; message?: unknown };
      const status = e?.status ?? e?.statusCode;
      const msg = typeof e?.message === "string" ? e.message : "";
      if (status === 403 || msg?.toLowerCase().includes("ограничена") || msg?.toLowerCase().includes("restricted")) {
        setError("Регистрация доступна только приглашённым пользователям. Обратитесь к администратору.");
      } else if (msg?.includes("already registered")) {
        setError("Этот email уже зарегистрирован");
      } else {
        setError("Ошибка регистрации. Попробуйте ещё раз.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="input-group">
        <label htmlFor="auth-email" className="input-label">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          className="input"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={autoFocus}
          required
        />
      </div>

      <div className="input-group">
        <label htmlFor="auth-password" className="input-label">
          Пароль
        </label>
        <input
          id="auth-password"
          type="password"
          className="input"
          placeholder="Минимум 6 символов"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>

      <div className="input-group">
        <label htmlFor="auth-confirm" className="input-label">
          Подтвердите пароль
        </label>
        <input
          id="auth-confirm"
          type="password"
          className="input"
          placeholder="Повторите пароль"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: "100%" }}>
        {loading ? "Регистрация..." : "Зарегистрироваться"}
      </button>
    </form>
  );
}
