import type { Locale } from "@/lib/i18n";
import { taramaText, type TaramaKey } from "./i18n";
import { techRating, type CsvColumn, type NumericField, type Row } from "./model";

type Header = { tr: string; en: string; fr: string };

/** Export headers carry the unit of the raw values (TL, not "Mr"). */
const NUMERIC_HEADERS: ReadonlyArray<[NumericField, Header]> = [
  ["close", { tr: "Fiyat (TL)", en: "Price (TRY)", fr: "Cours (TRY)" }],
  ["change_pct", { tr: "Günlük değişim (%)", en: "Daily change (%)", fr: "Variation du jour (%)" }],
  ["turnover", { tr: "İşlem hacmi (TL)", en: "Turnover (TRY)", fr: "Montant échangé (TRY)" }],
  ["avg_turnover", { tr: "Ort. günlük hacim 30G (TL)", en: "30-day avg. turnover (TRY)", fr: "Montant moyen 30 j (TRY)" }],
  ["market_cap", { tr: "Piyasa değeri (TL)", en: "Market cap (TRY)", fr: "Capitalisation (TRY)" }],
  ["pe", { tr: "F/K", en: "P/E", fr: "PER" }],
  ["pb", { tr: "PD/DD", en: "P/B", fr: "C/VC" }],
  ["ev_ebitda", { tr: "FD/FAVÖK", en: "EV/EBITDA", fr: "VE/EBITDA" }],
  ["dividend_yield", { tr: "Temettü verimi (%)", en: "Dividend yield (%)", fr: "Rendement du dividende (%)" }],
  ["roe", { tr: "ROE (%)", en: "ROE (%)", fr: "ROE (%)" }],
  ["net_margin", { tr: "Net kâr marjı (%)", en: "Net margin (%)", fr: "Marge nette (%)" }],
  ["rsi", { tr: "RSI (14)", en: "RSI (14)", fr: "RSI (14)" }],
  ["sma50_dist", { tr: "SMA 50 uzaklığı (%)", en: "vs SMA 50 (%)", fr: "Écart MM 50 (%)" }],
  ["sma200_dist", { tr: "SMA 200 uzaklığı (%)", en: "vs SMA 200 (%)", fr: "Écart MM 200 (%)" }],
  ["high_52w_dist", { tr: "52H zirveye uzaklık (%)", en: "vs 52-week high (%)", fr: "Écart + haut 52 s. (%)" }],
  ["low_52w_dist", { tr: "52H dibe uzaklık (%)", en: "vs 52-week low (%)", fr: "Écart + bas 52 s. (%)" }],
  ["rel_volume", { tr: "Göreli hacim (x)", en: "Relative volume (x)", fr: "Volume relatif (x)" }],
  ["perf_1w", { tr: "1 hafta (%)", en: "1 week (%)", fr: "1 semaine (%)" }],
  ["perf_1m", { tr: "1 ay (%)", en: "1 month (%)", fr: "1 mois (%)" }],
  ["perf_3m", { tr: "3 ay (%)", en: "3 months (%)", fr: "3 mois (%)" }],
  ["perf_ytd", { tr: "Yılbaşından beri (%)", en: "Year to date (%)", fr: "Depuis le 1er janvier (%)" }],
  ["perf_1y", { tr: "1 yıl (%)", en: "1 year (%)", fr: "1 an (%)" }],
  ["target_price", { tr: "Hedef fiyat (TL)", en: "Target price (TRY)", fr: "Objectif de cours (TRY)" }],
  ["upside", { tr: "Potansiyel (%)", en: "Upside (%)", fr: "Potentiel (%)" }],
  ["foreign_ratio", { tr: "Yabancı oranı (%)", en: "Foreign ownership (%)", fr: "Détention étrangère (%)" }],
];

const TEXT_HEADERS = {
  symbol: { tr: "Hisse", en: "Ticker", fr: "Code" },
  name: { tr: "Şirket", en: "Company", fr: "Société" },
  sector: { tr: "Sektör", en: "Sector", fr: "Secteur" },
  indices: { tr: "Endeksler", en: "Indices", fr: "Indices" },
  techRating: { tr: "Teknik görünüm", en: "Technical rating", fr: "Note technique" },
  recommendation: { tr: "Analist önerisi", en: "Analyst rating", fr: "Recommandation" },
} satisfies Record<string, Header>;

/** Every field, in a fixed order, for spreadsheet use. */
export function buildCsvColumns(locale: Locale, sectorName: (key: string) => string): CsvColumn[] {
  return [
    { header: TEXT_HEADERS.symbol[locale], value: (row: Row) => row.symbol },
    { header: TEXT_HEADERS.name[locale], value: (row: Row) => row.name },
    { header: TEXT_HEADERS.sector[locale], value: (row: Row) => (row.sector ? sectorName(row.sector) : undefined) },
    { header: TEXT_HEADERS.indices[locale], value: (row: Row) => row.indices?.join(" ") },
    ...NUMERIC_HEADERS.map(([field, header]) => ({ header: header[locale], value: (row: Row) => row[field] })),
    {
      header: TEXT_HEADERS.techRating[locale],
      value: (row: Row) => {
        const rating = techRating(row.tech_rating);
        return rating ? taramaText(`rating.${rating}` as TaramaKey, locale) : undefined;
      },
    },
    {
      header: TEXT_HEADERS.recommendation[locale],
      value: (row: Row) => (row.recommendation ? taramaText(`rec.${row.recommendation}` as TaramaKey, locale) : undefined),
    },
  ];
}

/** "hisse-tarama-2026-09-23.csv" (date of the data, Istanbul calendar day). */
export function csvFileName(asOf: string | undefined): string {
  const date = asOf ? new Date(asOf) : new Date();
  const day = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return day ? `hisse-tarama-${day}.csv` : "hisse-tarama.csv";
}
