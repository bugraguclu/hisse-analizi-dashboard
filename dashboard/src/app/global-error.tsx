"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="tr">
      <body>
        <title>Bir hata oluştu | Hisse Analizi</title>
        <style>{`
          :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #111827; }
          main { width: min(420px, calc(100% - 32px)); box-sizing: border-box; padding: 32px; border: 1px solid #e5e7eb; border-radius: 20px; background: #fff; text-align: center; box-shadow: 0 16px 48px rgba(15, 23, 42, .08); }
          h1 { margin: 0; font-size: 22px; }
          p { margin: 12px 0 0; color: #64748b; line-height: 1.55; }
          button { margin-top: 24px; border: 0; border-radius: 10px; padding: 11px 18px; background: #4f46e5; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
          button:hover { background: #4338ca; }
          .digest { margin-top: 16px; font-family: ui-monospace, monospace; font-size: 11px; }
          @media (prefers-color-scheme: dark) {
            body { background: #0f1117; color: #f3f4f6; }
            main { background: #171923; border-color: #303443; box-shadow: none; }
            p { color: #9ca3af; }
          }
        `}</style>
        <main role="alert">
          <h1>Uygulama yüklenemedi</h1>
          <p>Beklenmeyen bir sorun oluştu. Verileriniz etkilenmedi; sayfayı güvenle yeniden deneyebilirsiniz.</p>
          <button type="button" onClick={retry}>Yeniden dene</button>
          {error.digest && <p className="digest">Hata kodu: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
