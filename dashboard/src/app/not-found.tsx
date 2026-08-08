import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <section className="min-h-[60vh] flex items-center justify-center">
      <div className="max-w-md w-full rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
          <SearchX className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">404</p>
        <h1 className="mt-2 text-xl font-bold text-foreground">Sayfa bulunamadı</h1>
        <p className="mt-2 text-sm text-muted-foreground">Aradığınız sayfa taşınmış veya kaldırılmış olabilir.</p>
        <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <ArrowLeft className="h-4 w-4" /> Dashboard&apos;a dön
        </Link>
      </div>
    </section>
  );
}
