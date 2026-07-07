import { useRouter } from "next/router";
import Link from "next/link";
import { LoginForm } from "../components/auth/AuthForms";

export default function Login() {
  const router = useRouter();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="Report" className="auth-logo" />

        <h1 className="auth-title">Вход</h1>
        <p className="auth-subtitle">Войдите в свой аккаунт Report</p>

        <LoginForm onSuccess={() => router.push("/dashboard")} />

        <div className="auth-footer">
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </div>
      </div>
    </div>
  );
}
