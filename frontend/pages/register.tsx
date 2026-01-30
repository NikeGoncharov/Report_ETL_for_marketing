import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { authApi } from "../lib/api";

export default function Register() {
  const router = useRouter();
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
      // Auto-login after registration
      await authApi.login(email, password);
      router.push("/dashboard");
    } catch (err: any) {
      if (err.message?.includes("already registered")) {
        setError("Этот email уже зарегистрирован");
      } else {
        setError("Ошибка регистрации. Попробуйте ещё раз.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "100px auto", padding: "0 20px" }}>
      <h1 style={{ marginBottom: 10 }}>RePort</h1>
      <p style={{ color: "#666", marginBottom: 30 }}>
        Аналитика рекламных кампаний
      </p>

      <h2 style={{ marginBottom: 20 }}>Регистрация</h2>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="email" style={{ display: "block", marginBottom: 5 }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "10px",
              fontSize: 16,
              border: "1px solid #ccc",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label htmlFor="password" style={{ display: "block", marginBottom: 5 }}>
            Пароль
          </label>
          <input
            id="password"
            type="password"
            placeholder="Минимум 6 символов"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{
              width: "100%",
              padding: "10px",
              fontSize: 16,
              border: "1px solid #ccc",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="confirmPassword" style={{ display: "block", marginBottom: 5 }}>
            Подтвердите пароль
          </label>
          <input
            id="confirmPassword"
            type="password"
            placeholder="Повторите пароль"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "10px",
              fontSize: 16,
              border: "1px solid #ccc",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px",
            fontSize: 16,
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Регистрация..." : "Зарегистрироваться"}
        </button>
      </form>

      {error && (
        <p style={{ color: "red", marginTop: 15, textAlign: "center" }}>
          {error}
        </p>
      )}

      <p style={{ marginTop: 30, textAlign: "center", color: "#666" }}>
        Уже есть аккаунт?{" "}
        <Link href="/login" style={{ color: "#0070f3" }}>
          Войти
        </Link>
      </p>
    </div>
  );
}
