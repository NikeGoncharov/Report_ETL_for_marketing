import { useEffect } from "react";
import { useRouter } from "next/router";
import { authApi } from "../lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated
    authApi.me()
      .then(() => {
        // User is authenticated, redirect to dashboard
        router.push("/dashboard");
      })
      .catch(() => {
        // User is not authenticated, redirect to login
        router.push("/login");
      });
  }, []);

  return (
    <div style={{ 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center", 
      height: "100vh",
      flexDirection: "column"
    }}>
      <h1>RePort</h1>
      <p style={{ color: "#666" }}>Загрузка...</p>
    </div>
  );
}
