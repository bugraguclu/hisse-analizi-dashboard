export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    // KAP timestamps are DD.MM.YYYY HH:mm:ss. Passing that string directly
    // to Date swaps day/month on WebKit/Chromium for values such as
    // 02.07.2026, turning 2 July into 7 February.
    const kapMatch = dateStr.trim().match(
      /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    const date = kapMatch
      ? new Date(
          Number(kapMatch[3]),
          Number(kapMatch[2]) - 1,
          Number(kapMatch[1]),
          Number(kapMatch[4] ?? 0),
          Number(kapMatch[5] ?? 0),
          Number(kapMatch[6] ?? 0),
        )
      : new Date(dateStr);
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return dateStr;
  }
}

export function formatNumber(val?: number | null, decimals = 2): string {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return Number(val).toLocaleString("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCompact(val?: number | null): string {
  if (val === null || val === undefined || isNaN(val)) return "-";
  const n = Number(val);
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

export function formatPercent(val?: number | null, decimals = 2): string {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return `%${Number(val).toLocaleString("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatCurrency(val?: number | null): string {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return Number(val).toLocaleString("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  });
}
