export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(dateStr));
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
  return `%${Number(val).toFixed(decimals)}`;
}

export function formatCurrency(val?: number | null): string {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return Number(val).toLocaleString("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  });
}
