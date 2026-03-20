// === Reusable UI Components ===

const UI = {
  // Format number with locale
  num(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return "-";
    return Number(val).toLocaleString("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  // Format percentage
  pct(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return "-";
    return `%${Number(val).toFixed(decimals)}`;
  },

  // Format large numbers (1.2M, 3.4B)
  compact(val) {
    if (val === null || val === undefined || isNaN(val)) return "-";
    const n = Number(val);
    if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "T";
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toFixed(0);
  },

  // Change badge (up/down)
  changeBadge(val, suffix = "%") {
    if (val === null || val === undefined || isNaN(val)) return `<span class="metric-change neutral">-</span>`;
    const n = Number(val);
    const cls = n > 0 ? "up" : n < 0 ? "down" : "neutral";
    const arrow = n > 0 ? "+" : "";
    return `<span class="metric-change ${cls}">${arrow}${n.toFixed(2)}${suffix}</span>`;
  },

  // Signal badge
  signalBadge(signal) {
    if (!signal) return "";
    const s = signal.toUpperCase();
    if (s === "AL" || s === "BUY" || s === "STRONG_BUY") return `<span class="signal-badge buy">AL</span>`;
    if (s === "SAT" || s === "SELL" || s === "STRONG_SELL") return `<span class="signal-badge sell">SAT</span>`;
    return `<span class="signal-badge neutral">NOTR</span>`;
  },

  // Metric card
  metricCard(label, value, change, colorClass) {
    const valueClass = colorClass ? ` style="color:var(--${colorClass})"` : "";
    const changeHtml = change !== undefined ? this.changeBadge(change) : "";
    return `
      <div class="metric-card">
        <div class="metric-label">${label}</div>
        <div class="metric-value"${valueClass}>${value}</div>
        ${changeHtml}
      </div>
    `;
  },

  // Card wrapper
  card(title, bodyHtml, badge, bodyClass) {
    const badgeHtml = badge ? `<span class="card-badge">${badge}</span>` : "";
    const cls = bodyClass ? ` ${bodyClass}` : "";
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${title}</span>
          ${badgeHtml}
        </div>
        <div class="card-body${cls}">
          ${bodyHtml}
        </div>
      </div>
    `;
  },

  // Loading skeleton
  skeleton(height = 200) {
    return `<div class="loading-skeleton" style="height:${height}px"></div>`;
  },

  // Loading state
  loadingState(text = "Yukleniyor...") {
    return `<div class="loading-state"><div class="spinner"></div><span>${text}</span></div>`;
  },

  // Empty state
  emptyState(text = "Veri bulunamadi") {
    return `<div class="empty-state"><span>${text}</span></div>`;
  },

  // Stock card for grid view
  stockCard(ticker, name, price, change, volume, high, low) {
    const changeCls = Number(change) >= 0 ? "up" : "down";
    const arrow = Number(change) >= 0 ? "+" : "";
    return `
      <div class="stock-card" onclick="App.navigate('detail', '${ticker}')">
        <div class="stock-card-header">
          <div>
            <div class="stock-ticker">${ticker}</div>
            <div class="stock-name">${name || ticker}</div>
          </div>
          <span class="stock-change-badge ${changeCls}">${arrow}${this.num(change)}%</span>
        </div>
        <div class="stock-price">${this.num(price)}</div>
        <div class="stock-meta">
          <div class="stock-meta-item">
            <span class="meta-label">Hacim</span>
            <span class="meta-value">${this.compact(volume)}</span>
          </div>
          <div class="stock-meta-item">
            <span class="meta-label">Yuksek</span>
            <span class="meta-value">${this.num(high)}</span>
          </div>
          <div class="stock-meta-item">
            <span class="meta-label">Dusuk</span>
            <span class="meta-value">${this.num(low)}</span>
          </div>
        </div>
      </div>
    `;
  },

  // Event list item
  eventItem(title, source, ticker, date, category) {
    const dotClass = source || "kap";
    const badgeHtml = category ? `<span class="event-badge ${category}">${category}</span>` : "";
    const dateStr = date ? new Date(date).toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div class="event-item">
        <div class="event-dot ${dotClass}"></div>
        <div class="event-content">
          <div class="event-title">${title || "Baslik yok"}</div>
          <div class="event-meta">
            <span>${ticker || ""}</span>
            <span>${dateStr}</span>
            ${badgeHtml}
          </div>
        </div>
      </div>
    `;
  },

  // Ratio bar visualization
  ratioBar(label, value, maxValue) {
    if (value === null || value === undefined) return "";
    const pctWidth = Math.min(Math.abs(Number(value)) / maxValue * 100, 100);
    const color = Number(value) >= 0 ? "var(--accent)" : "var(--red)";
    return `
      <div class="ratio-row">
        <span class="ratio-label">${label}</span>
        <div class="ratio-bar-bg">
          <div class="ratio-bar-fill" style="width:${pctWidth}%;background:${color}"></div>
        </div>
        <span class="ratio-value">${this.pct(value)}</span>
      </div>
    `;
  },

  // Create a Chart.js line chart
  lineChart(canvasId, labels, datasets, options = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    return new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: datasets.length > 1,
            labels: { color: "#808499", font: { family: "'Inter', sans-serif", size: 12 } },
          },
          tooltip: {
            backgroundColor: "#1c1f2e",
            titleColor: "#f0f1f5",
            bodyColor: "#c0c3d0",
            borderColor: "#2a2d3e",
            borderWidth: 1,
            padding: 10,
            titleFont: { family: "'Inter', sans-serif", size: 13, weight: "600" },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(42,45,62,0.5)", drawBorder: false },
            ticks: { color: "#565a6e", font: { size: 11 }, maxTicksLimit: 10 },
          },
          y: {
            grid: { color: "rgba(42,45,62,0.5)", drawBorder: false },
            ticks: { color: "#565a6e", font: { family: "'JetBrains Mono', monospace", size: 11 } },
            ...(options.yAxis || {}),
          },
        },
        elements: {
          point: { radius: 0, hoverRadius: 4 },
          line: { tension: 0.3 },
        },
        ...options,
      },
    });
  },
};
