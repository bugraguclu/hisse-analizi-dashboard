import type { Locale } from "@/lib/i18n";

/**
 * English names for the Turkish line items KAP (industrial + bank summaries)
 * and İş Yatırım (cash flow) return. Unknown items keep their official
 * Turkish label. French falls back to English.
 */
const EN: Record<string, string> = {
  // Balance sheet — industrial
  "Dönen Varlıklar": "Current Assets",
  "Duran Varlıklar": "Non-current Assets",
  "Toplam Varlıklar": "Total Assets",
  "TOPLAM VARLIKLAR": "Total Assets",
  "Kısa Vadeli Yükümlülükler": "Current Liabilities",
  "Uzun Vadeli Yükümlülükler": "Non-current Liabilities",
  "Toplam Yükümlülükler": "Total Liabilities",
  "Ana Ortaklığa Ait Özkaynaklar": "Equity Attributable to Parent",
  "Ödenmiş Sermaye": "Paid-in Capital",
  "Kontrol Gücü Olmayan Paylar": "Non-controlling Interests",
  "Toplam Özkaynaklar": "Total Equity",
  "Toplam Kaynaklar": "Total Liabilities & Equity",
  "Nakit ve Nakit Benzerleri": "Cash & Cash Equivalents",
  // Balance sheet — banks
  "Finansal Varlıklar (Net)": "Financial Assets (Net)",
  "İtfa Edilmiş Maliyeti ile Ölçülen Finansal Varlıklar (Net)": "Financial Assets at Amortised Cost (Net)",
  "Satış Amaçlı Elde Tutulan ve Durdurulan Faaliyetlere İlişkin Duran Varlıklar (Net)": "Assets Held for Sale & Discontinued Ops (Net)",
  "Ortaklık Yatırımları": "Equity Investments",
  "Maddi Duran Varlıklar (Net)": "Property & Equipment (Net)",
  "Maddi Olmayan Duran Varlıklar (Net)": "Intangible Assets (Net)",
  "Yatırım Amaçlı Gayrimenkuller (Net)": "Investment Property (Net)",
  "Cari Vergi Varlığı": "Current Tax Assets",
  "Ertelenmiş Vergi Varlığı": "Deferred Tax Assets",
  "Diğer Aktifler (Net)": "Other Assets (Net)",
  "Varlıklar Toplamı": "Total Assets",
  Mevduat: "Deposits",
  "Alınan Krediler": "Borrowings",
  "Para Piyasalarına Borçlar": "Money Market Funding",
  "İhraç Edilen Menkul Kıymetler (Net)": "Debt Securities Issued (Net)",
  Fonlar: "Funds",
  "Gerçeğe Uygun Değer Farkı Kâr Zarara Yansıtılan Finansal Yükümlülükler": "Financial Liabilities at FVTPL",
  "Türev Finansal Yükümlülükler": "Derivative Financial Liabilities",
  "Faktoring Yükümlülükleri": "Factoring Payables",
  "Kiralama İşlemlerinden Yükümlülükler (Net)": "Lease Liabilities (Net)",
  Karşılıklar: "Provisions",
  "Cari Vergi Borcu": "Current Tax Liabilities",
  "Ertelenmiş Vergi Borcu": "Deferred Tax Liabilities",
  "Satış Amaçlı Elde Tutulan ve Durdurulan Faaliyetlere İlişkin Duran Varlık Borçları (Net)": "Liabilities Held for Sale & Discontinued Ops (Net)",
  "Sermaye Benzeri Borçlanma Araçları": "Subordinated Debt",
  "Diğer Yükümlülükler": "Other Liabilities",
  Özkaynaklar: "Equity",
  "Yükümlülükler Toplamı": "Total Liabilities & Equity",
  // Income statement — industrial
  Hasılat: "Revenue",
  "Satışların Maliyeti": "Cost of Sales",
  "Ticari Faaliyetlerden Brüt Kar (Zarar)": "Gross Profit from Trading Activities",
  "Finans Sektörü Faaliyetleri Hasılatı": "Revenue from Finance Sector Activities",
  "Finans Sektörü Faaliyetleri Maliyeti": "Cost of Finance Sector Activities",
  "Finans Sektörü Faaliyetlerinden Brüt Kâr (Zarar)": "Gross Profit from Finance Sector Activities",
  "Brüt Kâr (Zarar)": "Gross Profit",
  "Esas Faaliyet Kârı (Zararı)": "Operating Profit",
  "Finansman Geliri (Gideri) Öncesi Faaliyet Kârı (Zararı)": "Profit Before Financing Income/Expense",
  "Sürdürülen Faaliyetler Vergi Öncesi Kârı (Zararı)": "Profit Before Tax (Continuing Ops)",
  "Sürdürülen Faaliyetler Dönem Kârı (Zararı)": "Profit for the Period (Continuing Ops)",
  "Net Dönem Kârı (Zararı)": "Net Profit",
  "Dönem Kârının (Zararının) Dağılımı, Kontrol Gücü Olmayan Paylar": "Net Profit — Non-controlling Interests",
  "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları": "Net Profit — Attributable to Parent",
  "Diğer Kapsamlı Gelir (Gider)": "Other Comprehensive Income",
  "Toplam Kapsamlı Gelir (Gider)": "Total Comprehensive Income",
  "Toplam Kapsamlı Gelirin Dağılımı, Kontrol Gücü Olmayan Paylar": "Comprehensive Income — Non-controlling Interests",
  "Toplam Kapsamlı Gelirin Dağılımı, Ana Ortaklık Payları": "Comprehensive Income — Attributable to Parent",
  // Income statement — banks
  "Net Faiz Geliri veya Gideri": "Net Interest Income",
  "Net Ücret ve Komisyon Gelirleri veya Giderleri": "Net Fee & Commission Income",
  "Temettü Gelirleri": "Dividend Income",
  "Ticari Kâr veya Zarar (Net)": "Trading Profit/Loss (Net)",
  "Diğer Faaliyet Gelirleri": "Other Operating Income",
  "Faaliyet Brüt Kârı": "Gross Operating Profit",
  "Net Faaliyet Kârı (zararı)": "Net Operating Profit",
  "Sürdürülen Faaliyetler Dönem Net Kârı (Zararı)": "Net Profit (Continuing Ops)",
  "Durdurulan Faaliyetler Dönem Net Kârı (Zararı)": "Net Profit (Discontinued Ops)",
  "Dönem Kârının (Zararının) Dağılımı, Grubun Kârı (Zararı)": "Net Profit — Group Share",
  "Dönem Kârının (Zararının) Dağılımı, Azınlık Payları Kârı (Zararı)": "Net Profit — Minority Share",
  // Cash flow (İş Yatırım)
  "Amortisman Giderleri": "Depreciation Expense",
  "Kıdem Tazminatı": "Severance Pay",
  "Finansman Giderleri": "Finance Costs",
  "Yurtiçi Satışlar": "Domestic Sales",
  "Yurtdışı Satışlar": "Export Sales",
  "Net Yabancı Para Pozisyonu": "Net FX Position",
  "Parasal net yabancı para varlık/(yükümlülük) pozisyonu": "Net Monetary FX Asset/(Liability) Position",
  "Net YPP (Hedge Dahil)": "Net FX Position (incl. Hedges)",
  "İşletme Faaliyetlerinden Kaynaklanan Net Nakit": "Net Cash from Operating Activities",
  "Düzeltme Öncesi Kar": "Profit Before Adjustments",
  "Düzeltmeler:": "Adjustments:",
  "Amortisman & İtfa Payları": "Depreciation & Amortisation",
  "Karşılıklardaki Değişim": "Change in Provisions",
  "Diğer Gelir/ Gider": "Other Income/Expense",
  "İşletme Sermayesinde Değişikler Öncesi Faaliyet Karı (+)": "Operating Profit Before Working Capital Changes",
  "İşletme Sermayesindeki Değişiklikler": "Change in Working Capital",
  "Esas Faaliyet ile İlgili Oluşan Nakit (+)": "Cash from Core Operations",
  "Diğer İşletme Faaliyetlerinden Nakit": "Other Operating Cash Flows",
  "Sabit Sermaye Yatırımları": "Capital Expenditure",
  "Diğer Yatırım Faaliyetlerinden Nakit": "Other Investing Cash Flows",
  "Yatırım Faaliyetlerinden Kaynaklanan Nakit": "Net Cash from Investing Activities",
  "Serbest Nakit Akım": "Free Cash Flow",
  "Finansal Borçlardaki Değişim": "Change in Financial Debt",
  "Temettü Ödemeleri": "Dividends Paid",
  "Sermaye Artırımı": "Capital Increase",
  "Diğer Finansman Faaliyetlerinden Nakit": "Other Financing Cash Flows",
  "Finansman Faaliyetlerden Kaynaklanan Nakit": "Net Cash from Financing Activities",
  "Yab. Para Çev. Fark. Etk. Önc.Nak.Ve Nak. Benz. Net Artış/Azalış": "Net Change in Cash Before FX Effect",
  "Yab.ı Para Çevrim Fark. Nakit Ve Nakit Benz. Üzerindeki Etkisi": "FX Translation Effect on Cash",
  "Diğer Nakit Girişi/Çıkışı": "Other Cash Inflows/Outflows",
  "Nakit ve Benzerlerindeki Değişim": "Net Change in Cash",
  "Diğer Nakit ve Nakit Benzerlerindeki Artış": "Other Increase in Cash",
  "Dönem Başı Nakit Değerler": "Cash at Beginning of Period",
  "Dönem Sonu Nakit": "Cash at End of Period",
};

export function statementLabel(label: string, locale: Locale): string {
  if (locale === "tr") return label;
  return EN[label] ?? label;
}

/** Key lines of the (long) İş Yatırım cash-flow statement shown in summary mode. */
export const CASHFLOW_SUMMARY = new Set([
  "İşletme Faaliyetlerinden Kaynaklanan Net Nakit",
  "Amortisman & İtfa Payları",
  "İşletme Sermayesindeki Değişiklikler",
  "Sabit Sermaye Yatırımları",
  "Yatırım Faaliyetlerinden Kaynaklanan Nakit",
  "Serbest Nakit Akım",
  "Finansal Borçlardaki Değişim",
  "Temettü Ödemeleri",
  "Finansman Faaliyetlerden Kaynaklanan Nakit",
  "Nakit ve Benzerlerindeki Değişim",
  "Dönem Sonu Nakit",
]);

/** Totals and headline lines rendered in bold. */
export function isEmphasisLine(label: string): boolean {
  return /toplam|^hasılat$|^brüt kâr \(zarar\)$|^esas faaliyet kârı|^net dönem kârı|^özkaynaklar$|^net faiz geliri|^faaliyet brüt kârı|^net faaliyet kârı|kaynaklanan (net )?nakit$|^serbest nakit akım$|^dönem sonu nakit$/i.test(
    label,
  );
}
