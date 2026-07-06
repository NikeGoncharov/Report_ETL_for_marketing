import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        {/* дефолтный заголовок вкладки; страницы могут переопределять своим <title> */}
        <title>Report — ETL-платформа для маркетинга</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
