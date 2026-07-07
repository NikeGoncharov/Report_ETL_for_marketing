import { useRouter } from "next/router";
import Link from "next/link";
import { RegisterForm } from "../components/auth/AuthForms";

export default function Register() {
  const router = useRouter();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="Report" className="auth-logo" />

        <h1 className="auth-title">Регистрация</h1>
        <p className="auth-subtitle">Создайте аккаунт Report</p>

        <RegisterForm onSuccess={() => router.push("/dashboard")} />

        <div className="auth-footer">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </div>
      </div>
    </div>
  );
}
