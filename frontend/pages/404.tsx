import Head from "next/head";
import Link from "next/link";

export default function Custom404() {
  return (
    <>
      <Head>
        <title>Страница не найдена — Report</title>
      </Head>
      <div className="not-found-page">
        <div className="not-found-content">
          <h1 className="not-found-title">404</h1>
          <p className="not-found-text">Страница не найдена</p>
          <Link href="/" className="not-found-link">
            На главную
          </Link>
        </div>
      </div>
      <style jsx>{`
        .not-found-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--gray-900, #111827);
          padding: 24px;
        }
        .not-found-content {
          text-align: center;
        }
        .not-found-title {
          font-size: 4rem;
          font-weight: 700;
          color: #fff;
          margin: 0 0 16px;
          line-height: 1;
        }
        .not-found-text {
          font-size: 1.25rem;
          color: #fff;
          margin: 0 0 24px;
          opacity: 0.95;
        }
        .not-found-link {
          display: inline-block;
          padding: 12px 24px;
          background: transparent;
          color: #fff;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          border: 1px solid rgba(255, 255, 255, 0.6);
          transition: opacity 0.2s;
        }
        .not-found-link:hover {
          opacity: 0.9;
          border-color: #fff;
        }
      `}</style>
    </>
  );
}
