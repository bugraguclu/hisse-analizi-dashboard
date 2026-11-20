import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "iPhone Widget ve Cihazlar · Hisse Analizi",
  description: "QR kod ile iPhone ana ekran ve kilit ekranı widget'larını eşleştirin, takvim hatırlatıcılarını ve Siri kestirmelerini yönetin.",
};

export default function DevicesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
