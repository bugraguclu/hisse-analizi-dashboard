/**
 * Every indicator the chart can draw: menu text (tr/en/fr), parameters, how it is
 * presented (price pane or own pane, scale, reference levels, value format) and
 * its maths. FinancialChart renders any `IndicatorOutput` generically, so all
 * indicator-specific knowledge lives here. Formulas follow TradingView's built-in
 * indicators (see indicators.ts).
 */

import type {
  IndicatorDef,
  IndicatorInput,
  IndicatorOutput,
  IndicatorParamSpec,
  IndicatorTone,
  Localized,
} from "./indicator-types";
import {
  atr,
  bollinger,
  cci,
  dmi,
  ema,
  macd,
  mfi,
  obv,
  parabolicSar,
  roc,
  rsi,
  sma,
  stochastic,
  stochRsi,
  supertrend,
  vwap,
  williamsR,
  type IndicatorSeries,
} from "./indicators";
import { toChartTime } from "./time";
import type { ChartBar, IndicatorConfig, IndicatorKind, IntervalKind } from "./types";

/** Longest lookback a parameter may ask for: the chart fetches 250 warmup bars before the window. */
const MAX_LENGTH = 250;

const LENGTH: Localized = { tr: "Periyot", en: "Length", fr: "Période" };

function lengthParam(key: string, value: number, min = 1, label: Localized = LENGTH): IndicatorParamSpec {
  return { key, label, default: value, min, max: MAX_LENGTH, step: 1 };
}

function multiplierParam(key: string, value: number, label: Localized): IndicatorParamSpec {
  return { key, label, default: value, min: 0.1, max: 10, step: 0.1 };
}

function accelerationParam(key: string, value: number, label: Localized): IndicatorParamSpec {
  return { key, label, default: value, min: 0.001, max: 1, step: 0.001 };
}

/** Parameter value in a label: no trailing zeros, decimal comma like the rest of the Turkish-first UI ("0,02"). */
function formatParam(value: number): string {
  return String(value).replace(".", ",");
}

/** Adds the instance label: the abbreviation followed by every parameter value ("MACD 12 26 9", "VWAP"). */
function define(spec: Omit<IndicatorDef, "label">): IndicatorDef {
  return {
    ...spec,
    label: (params) => [spec.abbr, ...spec.params.map((param) => formatParam(params[param.key] ?? param.default))].join(" "),
  };
}

function singleLine(key: string, values: IndicatorSeries): IndicatorOutput {
  return { lines: [{ key, label: null, values }] };
}

const K_LINE: Localized = { tr: "%K", en: "%K", fr: "%K" };
const D_LINE: Localized = { tr: "%D", en: "%D", fr: "%D" };
const K_SMOOTHING: Localized = { tr: "%K yumuşatma", en: "%K smoothing", fr: "Lissage %K" };
const D_SMOOTHING: Localized = { tr: "%D yumuşatma", en: "%D smoothing", fr: "Lissage %D" };

/** Overbought / oversold guides of the 0–100 oscillators (Stochastic, Stoch RSI, MFI). */
const LEVELS_80_20: IndicatorDef["levels"] = [
  { value: 80, tone: "down" },
  { value: 20, tone: "up" },
];

const ZERO_LEVEL: IndicatorDef["levels"] = [{ value: 0, tone: "muted" }];

/** Every indicator by kind; `INDICATOR_ORDER` gives the menu order. */
export const INDICATORS: Readonly<Record<IndicatorKind, IndicatorDef>> = {
  sma: define({
    kind: "sma",
    placement: "overlay",
    group: "trend",
    abbr: "SMA",
    name: { tr: "Basit hareketli ortalama", en: "Simple moving average", fr: "Moyenne mobile simple" },
    description: {
      tr: "Son N kapanışın ortalaması; fiyatın ortalamanın üstünde kalması yükseliş eğilimine işaret eder.",
      en: "Average of the last N closes; price holding above it points to an uptrend.",
      fr: "Moyenne des N dernières clôtures ; un cours qui reste au-dessus indique une tendance haussière.",
    },
    keywords: ["sma", "ma", "ortalama", "hareketli ortalama", "moving average", "trend"],
    params: [lengthParam("length", 20)],
    format: "price",
    compute: (input, params) => singleLine("sma", sma(input.close, params.length)),
  }),
  ema: define({
    kind: "ema",
    placement: "overlay",
    group: "trend",
    abbr: "EMA",
    name: { tr: "Üssel hareketli ortalama", en: "Exponential moving average", fr: "Moyenne mobile exponentielle" },
    description: {
      tr: "Son fiyatları daha ağırlıklı hesaba katar; basit ortalamadan daha hızlı tepki verir.",
      en: "Weights recent prices more, so it reacts faster than the simple average.",
      fr: "Pondère davantage les cours récents et réagit plus vite que la moyenne simple.",
    },
    keywords: ["ema", "ussel", "ortalama", "hareketli ortalama", "exponential", "moving average", "trend"],
    params: [lengthParam("length", 20)],
    format: "price",
    compute: (input, params) => singleLine("ema", ema(input.close, params.length)),
  }),
  bb: define({
    kind: "bb",
    placement: "overlay",
    group: "volatility",
    abbr: "BB",
    name: { tr: "Bollinger bantları", en: "Bollinger bands", fr: "Bandes de Bollinger" },
    description: {
      tr: "Ortalamanın iki yanında standart sapma bantları; bantların daralması sert bir hareketin habercisi olabilir.",
      en: "Standard-deviation bands around an average; a squeeze often precedes a sharp move.",
      fr: "Bandes d'écart-type autour d'une moyenne ; un resserrement précède souvent un mouvement marqué.",
    },
    keywords: ["bollinger", "bb", "bant", "band", "standart sapma", "volatilite", "volatility"],
    params: [
      lengthParam("length", 20, 2),
      multiplierParam("mult", 2, { tr: "Standart sapma", en: "Std. deviation", fr: "Écart-type" }),
    ],
    format: "price",
    compute: (input, params) => {
      const bands = bollinger(input.close, params.length, params.mult);
      return {
        lines: [
          { key: "upper", label: { tr: "Üst", en: "Upper", fr: "Haute" }, values: bands.upper, colorOffset: 0 },
          { key: "basis", label: { tr: "Orta", en: "Middle", fr: "Médiane" }, values: bands.middle, colorOffset: 0, style: "dashed" },
          { key: "lower", label: { tr: "Alt", en: "Lower", fr: "Basse" }, values: bands.lower, colorOffset: 0 },
        ],
        band: { upper: "upper", lower: "lower" },
      };
    },
  }),
  vwap: define({
    kind: "vwap",
    placement: "overlay",
    group: "volume",
    abbr: "VWAP",
    name: {
      tr: "Hacim ağırlıklı ortalama fiyat (VWAP)",
      en: "Volume-weighted average price (VWAP)",
      fr: "Prix moyen pondéré par le volume (VWAP)",
    },
    description: {
      tr: "Seans boyunca hacimle ağırlıklandırılmış ortalama fiyat; her gün sıfırlanır, gün içi grafiklerde anlamlıdır.",
      en: "Volume-weighted average price of the session; resets daily and is meant for intraday charts.",
      fr: "Prix moyen de la séance pondéré par le volume ; repart chaque jour, pensé pour l'intrajournalier.",
    },
    keywords: ["vwap", "hacim agirlikli", "ortalama fiyat", "volume weighted", "gun ici", "intraday"],
    params: [],
    requires: { volume: true, intraday: true },
    format: "price",
    compute: (input) => singleLine("vwap", vwap(input.high, input.low, input.close, input.volume, input.sessions)),
  }),
  supertrend: define({
    kind: "supertrend",
    placement: "overlay",
    group: "trend",
    abbr: "Supertrend",
    name: { tr: "Supertrend", en: "Supertrend", fr: "Supertrend" },
    description: {
      tr: "ATR tabanlı iz süren stop çizgisi; fiyatın altındayken yükseliş, üstündeyken düşüş eğilimini gösterir.",
      en: "ATR-based trailing stop; below price in an uptrend, above it in a downtrend.",
      fr: "Stop suiveur fondé sur l'ATR ; sous le cours en tendance haussière, au-dessus en baissière.",
    },
    keywords: ["supertrend", "super trend", "atr", "iz suren stop", "trailing stop", "trend"],
    params: [
      lengthParam("length", 10, 1, { tr: "ATR periyodu", en: "ATR length", fr: "Période ATR" }),
      multiplierParam("factor", 3, { tr: "Çarpan", en: "Factor", fr: "Facteur" }),
    ],
    format: "price",
    compute: (input, params) => {
      const series = supertrend(input.high, input.low, input.close, params.length, params.factor);
      return {
        lines: [
          { key: "up", label: { tr: "Yükseliş", en: "Uptrend", fr: "Haussier" }, values: series.up, tone: "up" },
          { key: "down", label: { tr: "Düşüş", en: "Downtrend", fr: "Baissier" }, values: series.down, tone: "down" },
        ],
      };
    },
  }),
  psar: define({
    kind: "psar",
    placement: "overlay",
    group: "trend",
    abbr: "SAR",
    name: { tr: "Parabolik SAR", en: "Parabolic SAR", fr: "SAR parabolique" },
    description: {
      tr: "Fiyatın altındaki noktalar yükselişi, üstündekiler düşüşü gösterir; noktaların taraf değiştirmesi dönüş sinyalidir.",
      en: "Dots below price mark an uptrend, dots above a downtrend; a switch signals a reversal.",
      fr: "Points sous le cours : tendance haussière, au-dessus : baissière ; un changement de côté signale un retournement.",
    },
    keywords: ["sar", "psar", "parabolik", "parabolic", "stop and reverse", "donus", "reversal"],
    params: [
      accelerationParam("start", 0.02, { tr: "Başlangıç", en: "Start", fr: "Départ" }),
      accelerationParam("increment", 0.02, { tr: "Artış", en: "Increment", fr: "Incrément" }),
      accelerationParam("max", 0.2, { tr: "Maksimum", en: "Maximum", fr: "Maximum" }),
    ],
    format: "price",
    compute: (input, params) => {
      const series = parabolicSar(input.high, input.low, input.close, params.start, params.increment, params.max);
      const tones = series.uptrend.map((up): IndicatorTone | null => (up === null ? null : up ? "up" : "down"));
      return { lines: [{ key: "psar", label: null, values: series.sar, tones, shape: "dots" }] };
    },
  }),
  rsi: define({
    kind: "rsi",
    placement: "pane",
    group: "momentum",
    abbr: "RSI",
    name: { tr: "Göreceli güç endeksi (RSI)", en: "Relative strength index (RSI)", fr: "Indice de force relative (RSI)" },
    description: {
      tr: "70 üstü aşırı alım, 30 altı aşırı satım bölgesi.",
      en: "Above 70 is overbought territory, below 30 oversold.",
      fr: "Au-dessus de 70 zone de surachat, sous 30 zone de survente.",
    },
    keywords: ["rsi", "goreceli guc", "relative strength", "asiri alim", "asiri satim", "overbought", "oversold"],
    params: [lengthParam("length", 14, 2)],
    range: { min: 0, max: 100 },
    levels: [
      { value: 70, tone: "down" },
      { value: 50, tone: "muted" },
      { value: 30, tone: "up" },
    ],
    format: "fixed2",
    compute: (input, params) => singleLine("rsi", rsi(input.close, params.length)),
  }),
  macd: define({
    kind: "macd",
    placement: "pane",
    group: "momentum",
    abbr: "MACD",
    name: { tr: "MACD", en: "MACD", fr: "MACD" },
    description: {
      tr: "Hızlı ve yavaş üssel ortalamaların farkı; sinyal çizgisini yukarı kesmesi alım işareti sayılır.",
      en: "Gap between a fast and a slow EMA; crossing above the signal line is read as bullish.",
      fr: "Écart entre une moyenne exponentielle rapide et une lente ; franchir le signal à la hausse est haussier.",
    },
    keywords: ["macd", "yakinsama", "iraksama", "convergence", "divergence", "sinyal", "histogram"],
    params: [
      lengthParam("fast", 12, 1, { tr: "Hızlı periyot", en: "Fast length", fr: "Période rapide" }),
      lengthParam("slow", 26, 1, { tr: "Yavaş periyot", en: "Slow length", fr: "Période lente" }),
      lengthParam("signal", 9, 1, { tr: "Sinyal periyodu", en: "Signal length", fr: "Période du signal" }),
    ],
    levels: ZERO_LEVEL,
    format: "auto",
    compute: (input, params) => {
      const series = macd(input.close, params.fast, params.slow, params.signal);
      return {
        lines: [
          { key: "macd", label: { tr: "MACD", en: "MACD", fr: "MACD" }, values: series.macd, colorOffset: 0 },
          { key: "signal", label: { tr: "Sinyal", en: "Signal", fr: "Signal" }, values: series.signal, colorOffset: 1 },
        ],
        histogram: {
          key: "histogram",
          label: { tr: "Histogram", en: "Histogram", fr: "Histogramme" },
          values: series.histogram,
          colorMode: "sign-strength",
        },
      };
    },
  }),
  stoch: define({
    kind: "stoch",
    placement: "pane",
    group: "momentum",
    abbr: "Stoch",
    name: { tr: "Stokastik", en: "Stochastic", fr: "Stochastique" },
    description: {
      tr: "Kapanışın son N periyodun en yüksek–en düşük aralığındaki yeri; 80 üstü aşırı alım, 20 altı aşırı satım.",
      en: "Where the close sits in the last N bars' high–low range; above 80 overbought, below 20 oversold.",
      fr: "Position de la clôture dans la fourchette haut–bas des N dernières barres ; au-dessus de 80 surachat, sous 20 survente.",
    },
    keywords: ["stokastik", "stochastic", "stoch", "%k", "%d", "asiri alim", "overbought"],
    params: [
      lengthParam("k", 14, 1, { tr: "%K periyodu", en: "%K length", fr: "Période %K" }),
      lengthParam("smoothK", 3, 1, K_SMOOTHING),
      lengthParam("d", 3, 1, D_SMOOTHING),
    ],
    range: { min: 0, max: 100 },
    levels: LEVELS_80_20,
    format: "fixed2",
    compute: (input, params) => {
      const series = stochastic(input.high, input.low, input.close, params.k, params.smoothK, params.d);
      return {
        lines: [
          { key: "k", label: K_LINE, values: series.k, colorOffset: 0 },
          { key: "d", label: D_LINE, values: series.d, colorOffset: 1 },
        ],
      };
    },
  }),
  stochrsi: define({
    kind: "stochrsi",
    placement: "pane",
    group: "momentum",
    abbr: "Stoch RSI",
    name: { tr: "Stokastik RSI", en: "Stochastic RSI", fr: "RSI stochastique" },
    description: {
      tr: "Stokastik formülünü RSI'ya uygular; RSI'dan daha hızlı ve hassastır, 80/20 eşikleriyle okunur.",
      en: "Applies the stochastic formula to RSI; faster and more sensitive than RSI, read with 80/20 thresholds.",
      fr: "Applique la formule stochastique au RSI ; plus rapide et plus sensible, lu avec les seuils 80/20.",
    },
    keywords: ["stoch rsi", "stochrsi", "stokastik rsi", "stochastic rsi", "rsi"],
    params: [
      lengthParam("rsiLength", 14, 2, { tr: "RSI periyodu", en: "RSI length", fr: "Période RSI" }),
      lengthParam("stochLength", 14, 1, { tr: "Stokastik periyodu", en: "Stochastic length", fr: "Période stochastique" }),
      lengthParam("smoothK", 3, 1, K_SMOOTHING),
      lengthParam("d", 3, 1, D_SMOOTHING),
    ],
    range: { min: 0, max: 100 },
    levels: LEVELS_80_20,
    format: "fixed2",
    compute: (input, params) => {
      const series = stochRsi(input.close, params.rsiLength, params.stochLength, params.smoothK, params.d);
      return {
        lines: [
          { key: "k", label: K_LINE, values: series.k, colorOffset: 0 },
          { key: "d", label: D_LINE, values: series.d, colorOffset: 1 },
        ],
      };
    },
  }),
  cci: define({
    kind: "cci",
    placement: "pane",
    group: "momentum",
    abbr: "CCI",
    name: { tr: "Emtia kanal endeksi (CCI)", en: "Commodity channel index (CCI)", fr: "Commodity Channel Index (CCI)" },
    description: {
      tr: "Tipik fiyatın ortalamasından sapması; +100 üstü güçlü yükseliş, −100 altı güçlü düşüş bölgesi.",
      en: "How far the typical price strays from its average; above +100 strong, below −100 weak.",
      fr: "Écart du prix typique à sa moyenne ; au-dessus de +100 fort, sous −100 faible.",
    },
    keywords: ["cci", "emtia kanal", "commodity channel", "sapma"],
    params: [lengthParam("length", 20, 2)],
    levels: [
      { value: 100, tone: "down" },
      { value: 0, tone: "muted" },
      { value: -100, tone: "up" },
    ],
    format: "fixed2",
    compute: (input, params) => singleLine("cci", cci(input.high, input.low, input.close, params.length)),
  }),
  willr: define({
    kind: "willr",
    placement: "pane",
    group: "momentum",
    abbr: "%R",
    name: { tr: "Williams %R", en: "Williams %R", fr: "Williams %R" },
    description: {
      tr: "Kapanışın son N periyodun zirvesine uzaklığı; −20 üstü aşırı alım, −80 altı aşırı satım.",
      en: "Distance of the close from the N-bar high; above −20 overbought, below −80 oversold.",
      fr: "Distance de la clôture au plus haut des N barres ; au-dessus de −20 surachat, sous −80 survente.",
    },
    keywords: ["williams", "%r", "wr", "williams r", "asiri alim", "overbought"],
    params: [lengthParam("length", 14)],
    range: { min: -100, max: 0 },
    levels: [
      { value: -20, tone: "down" },
      { value: -80, tone: "up" },
    ],
    format: "fixed2",
    compute: (input, params) => singleLine("willr", williamsR(input.high, input.low, input.close, params.length)),
  }),
  adx: define({
    kind: "adx",
    placement: "pane",
    group: "trend",
    abbr: "DMI",
    name: {
      tr: "Yönsel hareket endeksi (DMI / ADX)",
      en: "Directional movement index (DMI / ADX)",
      fr: "Indice de mouvement directionnel (DMI / ADX)",
    },
    description: {
      tr: "ADX eğilimin gücünü (25 üstü güçlü), +DI ile −DI yönünü gösterir.",
      en: "ADX gauges trend strength (above 25 is strong); +DI and −DI show its direction.",
      fr: "L'ADX mesure la force de la tendance (forte au-dessus de 25) ; +DI et −DI indiquent sa direction.",
    },
    keywords: ["adx", "dmi", "di", "yonsel hareket", "directional movement", "trend gucu", "trend strength"],
    params: [lengthParam("length", 14)],
    levels: [{ value: 25, tone: "muted" }],
    format: "fixed2",
    compute: (input, params) => {
      // DI length and ADX smoothing share one parameter (both 14 on TradingView).
      const series = dmi(input.high, input.low, input.close, params.length, params.length);
      return {
        lines: [
          { key: "adx", label: { tr: "ADX", en: "ADX", fr: "ADX" }, values: series.adx, colorOffset: 0, width: 2 },
          { key: "plus", label: { tr: "+DI", en: "+DI", fr: "+DI" }, values: series.plus, tone: "up" },
          { key: "minus", label: { tr: "−DI", en: "−DI", fr: "−DI" }, values: series.minus, tone: "down" },
        ],
      };
    },
  }),
  atr: define({
    kind: "atr",
    placement: "pane",
    group: "volatility",
    abbr: "ATR",
    name: { tr: "Ortalama gerçek aralık (ATR)", en: "Average true range (ATR)", fr: "Average True Range (ATR)" },
    description: {
      tr: "Periyot başına ortalama fiyat oynaklığı (fiyat biriminde); stop mesafesi belirlemede kullanılır.",
      en: "Average price range per bar, in price units; used to size stop distances.",
      fr: "Amplitude moyenne par barre, en unités de prix ; sert à calibrer les stops.",
    },
    keywords: ["atr", "gercek aralik", "true range", "oynaklik", "volatilite", "volatility", "stop"],
    params: [lengthParam("length", 14)],
    format: "price",
    compute: (input, params) => singleLine("atr", atr(input.high, input.low, input.close, params.length)),
  }),
  obv: define({
    kind: "obv",
    placement: "pane",
    group: "volume",
    abbr: "OBV",
    name: { tr: "Denge hacmi (OBV)", en: "On-balance volume (OBV)", fr: "On-Balance Volume (OBV)" },
    description: {
      tr: "Yükselen periyotların hacmini ekler, düşenlerinkini çıkarır; fiyattan ayrışması erken uyarı sayılır.",
      en: "Adds volume on up bars and subtracts it on down bars; a divergence from price is an early warning.",
      fr: "Ajoute le volume des barres haussières et retranche celui des baissières ; une divergence avec le cours alerte tôt.",
    },
    keywords: ["obv", "denge hacmi", "on balance volume", "hacim", "volume"],
    params: [],
    requires: { volume: true },
    format: "compact",
    compute: (input) => singleLine("obv", obv(input.close, input.volume)),
  }),
  mfi: define({
    kind: "mfi",
    placement: "pane",
    group: "volume",
    abbr: "MFI",
    name: { tr: "Para akışı endeksi (MFI)", en: "Money flow index (MFI)", fr: "Money Flow Index (MFI)" },
    description: {
      tr: "Hacimle ağırlıklandırılmış RSI; 80 üstü aşırı alım, 20 altı aşırı satım.",
      en: "Volume-weighted RSI; above 80 overbought, below 20 oversold.",
      fr: "RSI pondéré par le volume ; au-dessus de 80 surachat, sous 20 survente.",
    },
    keywords: ["mfi", "para akisi", "money flow", "hacim", "volume", "asiri alim"],
    params: [lengthParam("length", 14)],
    requires: { volume: true },
    range: { min: 0, max: 100 },
    levels: LEVELS_80_20,
    format: "fixed2",
    compute: (input, params) => singleLine("mfi", mfi(input.high, input.low, input.close, input.volume, params.length)),
  }),
  roc: define({
    kind: "roc",
    placement: "pane",
    group: "momentum",
    abbr: "ROC",
    name: { tr: "Değişim oranı (ROC)", en: "Rate of change (ROC)", fr: "Taux de variation (ROC)" },
    description: {
      tr: "Kapanışın N periyot önceki kapanışa göre yüzde değişimi; sıfırın üstü yukarı yönlü ivme demektir.",
      en: "Percent change of the close versus N bars ago; above zero means upward momentum.",
      fr: "Variation en % de la clôture par rapport à N barres plus tôt ; au-dessus de zéro, l'élan est haussier.",
    },
    keywords: ["roc", "degisim orani", "rate of change", "momentum", "yuzde degisim"],
    params: [lengthParam("length", 9)],
    levels: ZERO_LEVEL,
    format: "auto",
    compute: (input, params) => singleLine("roc", roc(input.close, params.length)),
  }),
};

/** Menu order: price-pane overlays first, then the indicators with their own pane. */
export const INDICATOR_ORDER: readonly IndicatorKind[] = [
  "sma",
  "ema",
  "bb",
  "vwap",
  "supertrend",
  "psar",
  "rsi",
  "macd",
  "stoch",
  "stochrsi",
  "cci",
  "willr",
  "adx",
  "atr",
  "obv",
  "mfi",
  "roc",
];

/** Guard for stored or URL values: `sanitizeParams`/`computeIndicator` need a kind the catalog knows. */
export function isIndicatorKind(value: unknown): value is IndicatorKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INDICATORS, value);
}

/** Parameters of a freshly added indicator (a new object on every call). */
export function defaultParams(kind: IndicatorKind): Record<string, number> {
  return Object.fromEntries(INDICATORS[kind].params.map((param) => [param.key, param.default]));
}

/** Decimals of a step (0.1 → 1, 0.001 → 3), to strip float noise such as 0.30000000000000004. */
function stepDecimals(step: number): number {
  for (let decimals = 0; decimals <= 10; decimals += 1) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return decimals;
  }
  return 10;
}

/** A stored or typed value as a number; numeric strings (also with a decimal comma) count. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeValue(spec: IndicatorParamSpec, value: unknown): number {
  const number = toNumber(value);
  if (number === null) return spec.default;
  const clamp = (x: number) => Math.min(spec.max, Math.max(spec.min, x));
  const stepped = Math.round(clamp(number) / spec.step) * spec.step;
  return clamp(Number(stepped.toFixed(stepDecimals(spec.step))));
}

/**
 * Parameters safe to compute with, from anything (stored prefs, a settings form):
 * only the kind's own keys, missing or invalid values → default, then clamped to
 * [min, max] and rounded to the step.
 */
export function sanitizeParams(kind: IndicatorKind, raw: unknown): Record<string, number> {
  const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const params: Record<string, number> = {};
  for (const spec of INDICATORS[kind].params) {
    const value = Object.prototype.hasOwnProperty.call(source, spec.key) ? source[spec.key] : undefined;
    params[spec.key] = sanitizeValue(spec, value);
  }
  return params;
}

/** Legend / menu label of one indicator instance, e.g. "SMA 20", "BB 20 2", "SAR 0,02 0,02 0,2", "VWAP". */
export function indicatorLabel(config: Pick<IndicatorConfig, "kind" | "params">): string {
  return INDICATORS[config.kind].label(sanitizeParams(config.kind, config.params));
}

/**
 * The columns the maths needs, built once per bar set and shared by every
 * indicator. A missing high/low falls back to the close; each bar gets its
 * Istanbul trading day so VWAP resets per session whatever the viewer's time zone.
 */
export function buildIndicatorInput(bars: readonly ChartBar[], interval: IntervalKind): IndicatorInput {
  const times: number[] = [];
  const sessions: string[] = [];
  const open: (number | null)[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: (number | null)[] = [];
  for (const bar of bars) {
    times.push(bar.time);
    // toChartTime is the Istanbul wall clock encoded as UTC, so the UTC date is the local trading day.
    sessions.push(new Date(toChartTime(bar.time) * 1000).toISOString().slice(0, 10));
    open.push(bar.open);
    high.push(bar.high ?? bar.close);
    low.push(bar.low ?? bar.close);
    close.push(bar.close);
    volume.push(bar.volume);
  }
  return { times, sessions, open, high, low, close, volume, interval };
}

/** Series of one configured indicator; parameters are sanitized first, so stale prefs cannot break the maths. */
export function computeIndicator(config: Pick<IndicatorConfig, "kind" | "params">, input: IndicatorInput): IndicatorOutput {
  return INDICATORS[config.kind].compute(input, sanitizeParams(config.kind, config.params));
}
