// === Page Renderers ===

const Pages = {

  // =============================================
  // OVERVIEW — Piyasa Ozeti
  // =============================================
  async overview() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <h1 class="page-title">Piyasa Ozeti</h1>
      <p class="page-subtitle">BIST piyasa verileri, doviz kurlari ve son haberler</p>
      <div class="metrics-grid" id="overview-metrics">${UI.skeleton(80)}</div>
      <div class="grid-2-1">
        <div class="card" id="overview-chart-card">
          <div class="card-header">
            <span class="card-title">BIST 100 Endeksi</span>
            <div class="flex gap-2">
              <button class="btn btn-ghost" onclick="Pages.loadIndexChart('1h')">1S</button>
              <button class="btn btn-ghost" onclick="Pages.loadIndexChart('1g')">1G</button>
              <button class="btn btn-ghost" onclick="Pages.loadIndexChart('1ay')">1Ay</button>
              <button class="btn btn-ghost" onclick="Pages.loadIndexChart('3ay')">3Ay</button>
            </div>
          </div>
          <div class="card-body">
            <div class="chart-container"><canvas id="index-chart"></canvas></div>
          </div>
        </div>
        <div class="card" id="overview-events-card">
          <div class="card-header">
            <span class="card-title">Son Olaylar</span>
            <span class="card-badge">Canli</span>
          </div>
          <div class="card-body no-pad" id="overview-events">${UI.loadingState()}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card" id="fx-card">
          <div class="card-header"><span class="card-title">Doviz Kurlari</span></div>
          <div class="card-body no-pad" id="fx-table">${UI.loadingState()}</div>
        </div>
        <div class="card" id="gainers-card">
          <div class="card-header"><span class="card-title">Sistem Durumu</span></div>
          <div class="card-body" id="system-status">${UI.loadingState()}</div>
        </div>
      </div>
    `;

    // Load data in parallel
    const [healthData, statsData, eventsData, indexData, fxUsd, fxEur, fxGbp, policyRate] = await Promise.all([
      API.health(),
      API.stats(),
      API.eventsLatest(),
      API.index("XU100", "1ay"),
      API.fx("USD"),
      API.fx("EUR"),
      API.fx("GBP"),
      API.policyRate(),
    ]);

    // Metrics
    const metricsEl = document.getElementById("overview-metrics");
    const totalEvents = statsData?.total_events || statsData?.total_normalized_events || 0;
    const totalPrices = statsData?.total_price_records || 0;
    const totalCompanies = statsData?.total_companies || 0;
    const rateVal = policyRate?.rate || policyRate?.policy_rate || "-";

    metricsEl.innerHTML = `
      ${UI.metricCard("Takip Edilen Hisse", totalCompanies, undefined)}
      ${UI.metricCard("Toplam Olay", UI.compact(totalEvents), undefined)}
      ${UI.metricCard("Fiyat Kaydi", UI.compact(totalPrices), undefined)}
      ${UI.metricCard("Politika Faizi", typeof rateVal === "number" ? UI.pct(rateVal) : rateVal, undefined)}
    `;

    // Index chart
    Pages.renderIndexChart(indexData);

    // Events
    const eventsEl = document.getElementById("overview-events");
    if (eventsData && Array.isArray(eventsData) && eventsData.length > 0) {
      const items = eventsData.slice(0, 8).map(e =>
        UI.eventItem(e.title, e.source_code, e.ticker, e.published_at, e.category)
      ).join("");
      eventsEl.innerHTML = `<div class="event-list">${items}</div>`;
    } else {
      eventsEl.innerHTML = UI.emptyState("Henuz olay kaydedilmemis. Polling calisinca olaylar burada gorunecek.");
    }

    // FX table
    const fxEl = document.getElementById("fx-table");
    const fxRows = [
      { name: "USD/TRY", data: fxUsd },
      { name: "EUR/TRY", data: fxEur },
      { name: "GBP/TRY", data: fxGbp },
    ].map(({ name, data }) => {
      if (!data) return "";
      const price = data.close || data.price || data.rate || "-";
      const change = data.change_pct || data.change_percent || 0;
      const cls = Number(change) >= 0 ? "up" : "down";
      return `<tr>
        <td class="font-bold">${name}</td>
        <td class="mono">${UI.num(price, 4)}</td>
        <td class="mono ${cls}">${Number(change) >= 0 ? "+" : ""}${UI.num(change)}%</td>
      </tr>`;
    }).join("");

    if (fxRows) {
      fxEl.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Parite</th><th>Kur</th><th>Degisim</th></tr></thead>
          <tbody>${fxRows}</tbody>
        </table>
      `;
    } else {
      fxEl.innerHTML = UI.emptyState("Doviz verileri yuklenemedi");
    }

    // System status
    const statusEl = document.getElementById("system-status");
    if (healthData) {
      const statusColor = healthData.status === "ok" || healthData.status === "healthy" ? "green" : "red";
      statusEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="flex items-center gap-3">
            <div style="width:12px;height:12px;border-radius:50%;background:var(--${statusColor})"></div>
            <span class="font-bold">API: ${healthData.status || "unknown"}</span>
          </div>
          <div style="font-size:12px;color:var(--text-3)">
            Versiyon: <span class="text-mono">${healthData.version || statsData?.version || "0.3.0"}</span>
          </div>
          <div style="font-size:12px;color:var(--text-3)">
            Sirketler: <span class="text-mono font-bold">${totalCompanies}</span> |
            Kaynaklar: <span class="text-mono font-bold">${statsData?.total_sources || "-"}</span>
          </div>
          <div style="font-size:12px;color:var(--text-3)">
            Olaylar: <span class="text-mono font-bold">${UI.compact(totalEvents)}</span> |
            Fiyatlar: <span class="text-mono font-bold">${UI.compact(totalPrices)}</span>
          </div>
        </div>
      `;
    } else {
      statusEl.innerHTML = `
        <div class="flex items-center gap-3">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--red)"></div>
          <span class="font-bold text-red">API baglantisi kurulamadi</span>
        </div>
        <p style="font-size:12px;color:var(--text-4);margin-top:8px">
          Sunucunun calisiyor oldugundan emin olun: <code>uvicorn src.api.app:app --reload</code>
        </p>
      `;
    }
  },

  _indexChart: null,

  renderIndexChart(data) {
    if (Pages._indexChart) { Pages._indexChart.destroy(); Pages._indexChart = null; }
    const canvas = document.getElementById("index-chart");
    if (!canvas || !data) return;

    let labels = [];
    let prices = [];

    if (Array.isArray(data)) {
      labels = data.map(d => d.date || d.Date || d.trading_date || "");
      prices = data.map(d => d.close || d.Close || d.price || 0);
    } else if (data.data && Array.isArray(data.data)) {
      labels = data.data.map(d => d.date || d.Date || d.trading_date || "");
      prices = data.data.map(d => d.close || d.Close || d.price || 0);
    } else if (data.dates && data.closes) {
      labels = data.dates;
      prices = data.closes;
    }

    // Shorten labels
    labels = labels.map(l => {
      if (!l) return "";
      const d = new Date(l);
      if (isNaN(d.getTime())) return String(l).substring(0, 10);
      return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
    });

    if (labels.length === 0) return;

    Pages._indexChart = UI.lineChart("index-chart", labels, [{
      label: "BIST 100",
      data: prices,
      borderColor: "#4f6ef7",
      backgroundColor: "rgba(79,110,247,0.08)",
      fill: true,
      borderWidth: 2,
    }]);
  },

  async loadIndexChart(period) {
    const data = await API.index("XU100", period);
    Pages.renderIndexChart(data);
  },

  // =============================================
  // STOCKS — Hisse Listesi
  // =============================================
  async stocks() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <h1 class="page-title">Hisseler</h1>
      <p class="page-subtitle">Takip edilen tum hisseler</p>
      <div class="search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="text" id="stock-search" placeholder="Hisse ara (ornegin THYAO, GARAN...)" oninput="Pages.filterStocks()" />
      </div>
      <div class="stock-grid" id="stock-grid">${UI.loadingState("Hisse verileri yukleniyor...")}</div>
    `;

    const companies = await API.companies();
    Pages._stocksData = companies || [];
    Pages.renderStocks(Pages._stocksData);
  },

  _stocksData: [],

  renderStocks(companies) {
    const grid = document.getElementById("stock-grid");
    if (!companies || companies.length === 0) {
      grid.innerHTML = UI.emptyState("Hisse bulunamadi. Seed scripti calistirilmis mi?");
      return;
    }

    const cards = companies.map(c => {
      const ticker = c.ticker || c.code || "";
      const name = c.display_name || c.legal_name || c.name || ticker;
      return UI.stockCard(ticker, name, "-", 0, 0, "-", "-");
    }).join("");

    grid.innerHTML = cards;

    // Load live prices for all tickers
    const tickers = companies.map(c => c.ticker || c.code).filter(Boolean);
    if (tickers.length > 0) {
      Pages.loadStockPrices(tickers);
    }
  },

  async loadStockPrices(tickers) {
    // Try snapshot endpoint first
    const snapshot = await API.snapshot(tickers.join(","));
    if (snapshot && typeof snapshot === "object") {
      const data = Array.isArray(snapshot) ? snapshot : (snapshot.data || []);
      if (data.length > 0) {
        Pages.updateStockCards(data);
        return;
      }
    }

    // Fallback: load prices individually (first 10)
    const limited = tickers.slice(0, 10);
    const results = await Promise.all(limited.map(t => API.pricesLatest(t)));
    const priceData = limited.map((ticker, i) => {
      const r = results[i];
      if (!r) return null;
      const item = Array.isArray(r) ? r[0] : r;
      if (!item) return null;
      return { ticker, ...item };
    }).filter(Boolean);

    Pages.updateStockCards(priceData);
  },

  updateStockCards(priceData) {
    const cards = document.querySelectorAll(".stock-card");
    cards.forEach(card => {
      const tickerEl = card.querySelector(".stock-ticker");
      if (!tickerEl) return;
      const ticker = tickerEl.textContent.trim();

      const match = priceData.find(p =>
        (p.ticker || p.symbol || "").toUpperCase() === ticker.toUpperCase()
      );
      if (!match) return;

      const price = match.close || match.price || match.last || 0;
      const change = match.change_pct || match.change_percent || match.changePercent || 0;
      const volume = match.volume || 0;
      const high = match.high || match.dayHigh || "-";
      const low = match.low || match.dayLow || "-";

      const priceEl = card.querySelector(".stock-price");
      if (priceEl) priceEl.textContent = UI.num(price);

      const changeEl = card.querySelector(".stock-change-badge");
      if (changeEl) {
        const cls = Number(change) >= 0 ? "up" : "down";
        const arrow = Number(change) >= 0 ? "+" : "";
        changeEl.className = `stock-change-badge ${cls}`;
        changeEl.textContent = `${arrow}${UI.num(change)}%`;
      }

      const metaValues = card.querySelectorAll(".meta-value");
      if (metaValues[0]) metaValues[0].textContent = UI.compact(volume);
      if (metaValues[1]) metaValues[1].textContent = UI.num(high);
      if (metaValues[2]) metaValues[2].textContent = UI.num(low);
    });
  },

  filterStocks() {
    const q = (document.getElementById("stock-search")?.value || "").toUpperCase();
    const filtered = Pages._stocksData.filter(c => {
      const t = (c.ticker || c.code || "").toUpperCase();
      const n = (c.display_name || c.legal_name || c.name || "").toUpperCase();
      return t.includes(q) || n.includes(q);
    });
    Pages.renderStocks(filtered);
  },

  // =============================================
  // DETAIL — Hisse Detay
  // =============================================
  async detail(ticker) {
    ticker = ticker || "THYAO";
    const main = document.getElementById("main");
    main.innerHTML = `
      <div class="flex items-center justify-between mb-6">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="page-title">${ticker}</h1>
            <span id="detail-price" class="text-mono" style="font-size:24px;font-weight:700">-</span>
            <span id="detail-change"></span>
          </div>
          <p class="page-subtitle" id="detail-name">Yukleniyor...</p>
        </div>
        <div class="flex gap-2">
          <select class="select-input" id="detail-ticker-select" onchange="Pages.detail(this.value)">
            <option value="${ticker}">${ticker}</option>
          </select>
        </div>
      </div>

      <div class="tab-bar" id="detail-tabs">
        <div class="tab-item active" data-tab="price" onclick="Pages.detailTab('price', '${ticker}')">Fiyat</div>
        <div class="tab-item" data-tab="technical" onclick="Pages.detailTab('technical', '${ticker}')">Teknik</div>
        <div class="tab-item" data-tab="fundamental" onclick="Pages.detailTab('fundamental', '${ticker}')">Temel</div>
        <div class="tab-item" data-tab="news" onclick="Pages.detailTab('news', '${ticker}')">Haberler</div>
      </div>

      <div id="detail-content">${UI.loadingState()}</div>
    `;

    // Load companies for dropdown
    const companies = await API.companies();
    const select = document.getElementById("detail-ticker-select");
    if (companies && select) {
      select.innerHTML = companies.map(c => {
        const t = c.ticker || c.code;
        return `<option value="${t}" ${t === ticker ? "selected" : ""}>${t} - ${c.display_name || c.legal_name || ""}</option>`;
      }).join("");
    }

    // Load header info
    const [infoData, priceData] = await Promise.all([
      API.fastInfo(ticker),
      API.pricesLatest(ticker),
    ]);

    // Update name
    const nameEl = document.getElementById("detail-name");
    if (infoData) {
      const info = infoData.fast_info || infoData.info || infoData;
      nameEl.textContent = info.longName || info.shortName || info.name || ticker;
    }

    // Update price
    if (priceData) {
      const p = Array.isArray(priceData) ? priceData[0] : priceData;
      if (p) {
        const price = p.close || p.price || 0;
        const change = p.change_pct || p.change_percent || 0;
        document.getElementById("detail-price").textContent = UI.num(price);
        document.getElementById("detail-change").innerHTML = UI.changeBadge(change);
      }
    }

    // Show price tab by default
    Pages.detailTab("price", ticker);
  },

  _detailChart: null,

  async detailTab(tab, ticker) {
    // Update tab visual
    document.querySelectorAll("#detail-tabs .tab-item").forEach(t => t.classList.remove("active"));
    document.querySelector(`#detail-tabs .tab-item[data-tab="${tab}"]`)?.classList.add("active");

    const content = document.getElementById("detail-content");
    content.innerHTML = UI.loadingState();

    switch (tab) {
      case "price":
        await Pages.detailPrice(ticker, content);
        break;
      case "technical":
        await Pages.detailTechnical(ticker, content);
        break;
      case "fundamental":
        await Pages.detailFundamental(ticker, content);
        break;
      case "news":
        await Pages.detailNews(ticker, content);
        break;
    }
  },

  async detailPrice(ticker, el) {
    const prices = await API.prices({ ticker, limit: 60 });
    if (!prices || (Array.isArray(prices) && prices.length === 0)) {
      el.innerHTML = UI.emptyState("Fiyat verisi bulunamadi. Polling calisinca veriler gorunecek.");
      return;
    }

    const data = Array.isArray(prices) ? prices : (prices.data || []);
    const sorted = [...data].sort((a, b) => new Date(a.trading_date || a.date) - new Date(b.trading_date || b.date));

    const labels = sorted.map(d => {
      const dt = new Date(d.trading_date || d.date);
      return dt.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
    });
    const closes = sorted.map(d => d.close || d.price || 0);
    const volumes = sorted.map(d => d.volume || 0);

    el.innerHTML = `
      <div class="card mb-4">
        <div class="card-header">
          <span class="card-title">${ticker} Fiyat Grafigi</span>
          <span class="card-badge">${sorted.length} gun</span>
        </div>
        <div class="card-body">
          <div class="chart-container tall"><canvas id="detail-price-chart"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Hacim</span>
        </div>
        <div class="card-body">
          <div class="chart-container"><canvas id="detail-volume-chart"></canvas></div>
        </div>
      </div>
    `;

    if (Pages._detailChart) { Pages._detailChart.destroy(); Pages._detailChart = null; }

    Pages._detailChart = UI.lineChart("detail-price-chart", labels, [{
      label: "Kapanis",
      data: closes,
      borderColor: "#4f6ef7",
      backgroundColor: "rgba(79,110,247,0.06)",
      fill: true,
      borderWidth: 2,
    }]);

    // Volume bar chart
    new Chart(document.getElementById("detail-volume-chart"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Hacim",
          data: volumes,
          backgroundColor: "rgba(79,110,247,0.3)",
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#565a6e", font: { size: 11 }, maxTicksLimit: 10 } },
          y: { grid: { color: "rgba(42,45,62,0.5)" }, ticks: { color: "#565a6e", font: { size: 11 }, callback: v => UI.compact(v) } },
        },
      },
    });
  },

  async detailTechnical(ticker, el) {
    const [signalData, rsiData, macdData] = await Promise.all([
      API.signals(ticker),
      API.rsi(ticker, 14),
      API.macd(ticker),
    ]);

    let signalHtml = UI.emptyState("Sinyal verisi alinamadi");
    if (signalData) {
      const signals = signalData.signals || signalData;
      if (typeof signals === "object" && !Array.isArray(signals)) {
        const rows = Object.entries(signals).map(([key, val]) => {
          const signal = typeof val === "string" ? val : (val?.signal || val?.action || "-");
          return `<tr>
            <td class="font-bold">${key}</td>
            <td>${UI.signalBadge(signal)}</td>
          </tr>`;
        }).join("");
        signalHtml = `<table class="data-table"><thead><tr><th>Gosterge</th><th>Sinyal</th></tr></thead><tbody>${rows}</tbody></table>`;
      }
    }

    let rsiValue = "-";
    if (rsiData) {
      const rsiArr = rsiData.rsi || rsiData.data || rsiData;
      if (Array.isArray(rsiArr) && rsiArr.length > 0) {
        const last = rsiArr[rsiArr.length - 1];
        rsiValue = typeof last === "number" ? last.toFixed(1) : (last?.rsi || last?.value || "-");
      } else if (typeof rsiArr === "number") {
        rsiValue = rsiArr.toFixed(1);
      }
    }

    const rsiNum = Number(rsiValue);
    const rsiColor = rsiNum > 70 ? "red" : rsiNum < 30 ? "green" : "accent";

    el.innerHTML = `
      <div class="metrics-grid">
        ${UI.metricCard("RSI (14)", rsiValue, undefined, rsiColor)}
        ${UI.metricCard("MACD", macdData?.macd || macdData?.value || "-", undefined)}
        ${UI.metricCard("Sinyal", macdData?.signal || "-", undefined)}
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><span class="card-title">Teknik Sinyaller</span></div>
          <div class="card-body no-pad">${signalHtml}</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">RSI Grafigi</span></div>
          <div class="card-body">
            <div class="chart-container"><canvas id="rsi-chart"></canvas></div>
          </div>
        </div>
      </div>
    `;

    // RSI chart
    if (rsiData) {
      const rsiArr = rsiData.rsi || rsiData.data || rsiData;
      if (Array.isArray(rsiArr)) {
        const rsiValues = rsiArr.map(r => typeof r === "number" ? r : (r?.rsi || r?.value || 0));
        const rsiLabels = rsiArr.map((r, i) => r?.date ? new Date(r.date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) : `${i + 1}`);

        UI.lineChart("rsi-chart", rsiLabels.slice(-30), [
          { label: "RSI", data: rsiValues.slice(-30), borderColor: "#a78bfa", borderWidth: 2, fill: false },
          { label: "Asiri Alim", data: Array(30).fill(70), borderColor: "rgba(239,68,68,0.4)", borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false },
          { label: "Asiri Satim", data: Array(30).fill(30), borderColor: "rgba(34,197,94,0.4)", borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false },
        ]);
      }
    }
  },

  async detailFundamental(ticker, el) {
    const [info, ratios] = await Promise.all([
      API.companyInfo(ticker),
      API.financialRatios(ticker),
    ]);

    let infoHtml = "";
    if (info) {
      const d = info.info || info;
      const fields = [
        ["Sektor", d.sector || d.industry || "-"],
        ["Piyasa Degeri", UI.compact(d.marketCap || d.market_cap || 0)],
        ["Calisan Sayisi", UI.compact(d.fullTimeEmployees || d.employees || 0)],
        ["Web Sitesi", d.website || "-"],
      ];
      infoHtml = fields.map(([k, v]) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text-3);font-size:13px">${k}</span>
          <span class="text-mono font-bold" style="font-size:13px">${v}</span>
        </div>
      `).join("");
    }

    let ratioHtml = UI.emptyState("Finansal oran verisi yok. Polling ile veriler toplaninca hesaplanacak.");
    if (ratios && Array.isArray(ratios) && ratios.length > 0) {
      const r = ratios[0];
      ratioHtml = `
        ${UI.ratioBar("ROE", r.roe ? r.roe * 100 : null, 50)}
        ${UI.ratioBar("ROA", r.roa ? r.roa * 100 : null, 30)}
        ${UI.ratioBar("Net Margin", r.net_margin ? r.net_margin * 100 : null, 40)}
        ${UI.ratioBar("Gross Margin", r.gross_margin ? r.gross_margin * 100 : null, 60)}
        ${UI.ratioBar("EBITDA Margin", r.ebitda_margin ? r.ebitda_margin * 100 : null, 50)}
        ${UI.ratioBar("Borc/Ozsermaye", r.debt_to_equity ? r.debt_to_equity * 100 : null, 200)}
        ${UI.ratioBar("Cari Oran", r.current_ratio ? r.current_ratio * 100 : null, 300)}
      `;
    }

    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><span class="card-title">Sirket Bilgileri</span></div>
          <div class="card-body">${infoHtml || UI.emptyState("Sirket bilgisi alinamadi")}</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Finansal Oranlar</span></div>
          <div class="card-body">${ratioHtml}</div>
        </div>
      </div>
    `;
  },

  async detailNews(ticker, el) {
    const events = await API.events({ ticker, limit: 20 });
    if (!events || (Array.isArray(events) && events.length === 0)) {
      el.innerHTML = UI.emptyState("Bu hisse icin olay bulunamadi.");
      return;
    }

    const data = Array.isArray(events) ? events : (events.data || events.events || []);
    const items = data.map(e =>
      UI.eventItem(e.title, e.source_code, e.ticker || ticker, e.published_at, e.category)
    ).join("");

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${ticker} Haberleri & Bildirimleri</span>
          <span class="card-badge">${data.length} kayit</span>
        </div>
        <div class="card-body no-pad">
          <div class="event-list">${items}</div>
        </div>
      </div>
    `;
  },

  // =============================================
  // SCREENER — Tarama
  // =============================================
  async screener() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <h1 class="page-title">Hisse Tarama</h1>
      <p class="page-subtitle">BIST hisselerini filtrele ve tara</p>
      <div class="flex gap-3 mb-6">
        <button class="btn btn-primary" onclick="Pages.runScreener()">Tarama Baslat</button>
        <select class="select-input" id="screener-template" onchange="Pages.applyTemplate()">
          <option value="">Sablon Sec...</option>
        </select>
      </div>
      <div id="screener-results">${UI.emptyState("Tarama baslatmak icin butona tiklayin")}</div>
    `;

    // Load templates
    const templates = await API.screenerTemplates();
    const select = document.getElementById("screener-template");
    if (templates && Array.isArray(templates)) {
      templates.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.name || t.id || "";
        opt.textContent = t.name || t.title || "";
        select.appendChild(opt);
      });
    }
  },

  async runScreener() {
    const results = document.getElementById("screener-results");
    results.innerHTML = UI.loadingState("Tarama yapiliyor...");

    const data = await API.screener();
    if (!data) {
      results.innerHTML = UI.emptyState("Tarama sonucu alinamadi");
      return;
    }

    const stocks = Array.isArray(data) ? data : (data.data || data.results || []);
    if (stocks.length === 0) {
      results.innerHTML = UI.emptyState("Sonuc bulunamadi");
      return;
    }

    const rows = stocks.slice(0, 50).map(s => {
      const ticker = s.ticker || s.symbol || s.code || "";
      const price = s.close || s.price || s.last || "-";
      const change = s.change_pct || s.change_percent || s.changePercent || 0;
      const volume = s.volume || 0;
      const cls = Number(change) >= 0 ? "up" : "down";
      return `<tr>
        <td><span class="ticker" onclick="App.navigate('detail', '${ticker}')">${ticker}</span></td>
        <td class="mono">${UI.num(price)}</td>
        <td class="mono ${cls}">${Number(change) >= 0 ? "+" : ""}${UI.num(change)}%</td>
        <td class="mono">${UI.compact(volume)}</td>
      </tr>`;
    }).join("");

    results.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Tarama Sonuclari</span>
          <span class="card-badge">${stocks.length} hisse</span>
        </div>
        <div class="card-body no-pad">
          <table class="data-table">
            <thead><tr><th>Ticker</th><th>Fiyat</th><th>Degisim</th><th>Hacim</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  // =============================================
  // NEWS — Haberler
  // =============================================
  async news() {
    const main = document.getElementById("main");
    main.innerHTML = `
      <h1 class="page-title">Haberler & Olaylar</h1>
      <p class="page-subtitle">Tum KAP bildirimleri ve haberler</p>
      <div class="filter-bar" id="news-filters">
        <span class="filter-chip active" data-filter="" onclick="Pages.filterNews('')">Tumu</span>
        <span class="filter-chip" data-filter="kap" onclick="Pages.filterNews('kap')">KAP</span>
        <span class="filter-chip" data-filter="official_news" onclick="Pages.filterNews('official_news')">Haberler</span>
        <span class="filter-chip" data-filter="price" onclick="Pages.filterNews('price')">Fiyat</span>
      </div>
      <div id="news-list">${UI.loadingState("Olaylar yukleniyor...")}</div>
    `;

    Pages._newsFilter = "";
    await Pages.loadNews();
  },

  _newsFilter: "",

  async loadNews() {
    const container = document.getElementById("news-list");
    const params = { limit: 50 };
    if (Pages._newsFilter) params.source_code = Pages._newsFilter;

    const events = await API.events(params);
    if (!events || (Array.isArray(events) && events.length === 0)) {
      container.innerHTML = UI.emptyState("Henuz olay kaydedilmemis.");
      return;
    }

    const data = Array.isArray(events) ? events : (events.data || events.events || []);
    const items = data.map(e =>
      UI.eventItem(e.title, e.source_code, e.ticker, e.published_at, e.category)
    ).join("");

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Olaylar</span>
          <span class="card-badge">${data.length} kayit</span>
        </div>
        <div class="card-body no-pad">
          <div class="event-list">${items}</div>
        </div>
      </div>
    `;
  },

  filterNews(filter) {
    Pages._newsFilter = filter;
    document.querySelectorAll("#news-filters .filter-chip").forEach(c => {
      c.classList.toggle("active", c.dataset.filter === filter);
    });
    Pages.loadNews();
  },
};
