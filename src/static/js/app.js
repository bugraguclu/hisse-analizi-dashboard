// === Hisse Analizi Dashboard — Developer Test UI ===

const API_BASE = window.location.origin;

// === ENDPOINT DEFINITIONS ===
const ENDPOINTS = {
  overview: [
    { method: "GET", path: "/health", desc: "Sistem durumu" },
    { method: "GET", path: "/admin/stats", desc: "Istatistikler" },
  ],
  technical: [
    { method: "GET", path: "/technical/{ticker}/rsi", desc: "RSI", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "period", type: "query", default: "14" },
    ]},
    { method: "GET", path: "/technical/{ticker}/macd", desc: "MACD", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/technical/{ticker}/bollinger", desc: "Bollinger Bands", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "period", type: "query", default: "20" },
    ]},
    { method: "GET", path: "/technical/{ticker}/sma", desc: "SMA", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "period", type: "query", default: "20" },
    ]},
    { method: "GET", path: "/technical/{ticker}/ema", desc: "EMA", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "period", type: "query", default: "20" },
    ]},
    { method: "GET", path: "/technical/{ticker}/supertrend", desc: "SuperTrend", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/technical/{ticker}/stochastic", desc: "Stochastic", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/technical/{ticker}/signals", desc: "Teknik Sinyal Ozeti", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/technical/{ticker}/signals/all-timeframes", desc: "Tum Zaman Dilimleri", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
  ],
  fundamentals: [
    { method: "GET", path: "/fundamentals/{ticker}/info", desc: "Sirket Bilgileri", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/fast-info", desc: "Hizli Ozet", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/balance-sheet", desc: "Bilanco", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "quarterly", type: "query", default: "false", options: ["false", "true"] },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/income-statement", desc: "Gelir Tablosu", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "quarterly", type: "query", default: "false", options: ["false", "true"] },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/cashflow", desc: "Nakit Akis", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "quarterly", type: "query", default: "false", options: ["false", "true"] },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/dividends", desc: "Temettu Gecmisi", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/holders", desc: "Buyuk Ortaklar", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/recommendations", desc: "Analist Tavsiyeleri", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/price-targets", desc: "Hedef Fiyatlar", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
    { method: "GET", path: "/fundamentals/{ticker}/earnings-dates", desc: "Kazanc Tarihleri", params: [
      { name: "ticker", type: "path", default: "AEFES" },
    ]},
  ],
  macro: [
    { method: "GET", path: "/macro/tcmb", desc: "TCMB Faiz Oranlari" },
    { method: "GET", path: "/macro/policy-rate", desc: "Politika Faizi" },
    { method: "GET", path: "/macro/inflation", desc: "Enflasyon Verileri" },
    { method: "GET", path: "/macro/fx/{currency}", desc: "Doviz Kuru", params: [
      { name: "currency", type: "path", default: "USD", options: ["USD","EUR","GBP","CHF","JPY","AUD","CAD","SEK","NOK","DKK","CNY","KRW","SAR","RUB"] },
    ]},
    { method: "GET", path: "/macro/calendar", desc: "Ekonomik Takvim" },
  ],
  market: [
    { method: "GET", path: "/market/screener", desc: "Hisse Tarama (Varsayilan)" },
    { method: "GET", path: "/market/screener/templates", desc: "Tarama Sablonlari" },
    { method: "GET", path: "/market/scanner", desc: "Teknik Sinyal Tarama", params: [
      { name: "condition", type: "query", default: "" },
    ]},
    { method: "GET", path: "/market/indices", desc: "Tum BIST Endeksleri" },
    { method: "GET", path: "/market/index/{symbol}", desc: "Endeks Fiyat Verisi", params: [
      { name: "symbol", type: "path", default: "XU100", options: ["XU100","XU030","XBANK","XUSIN","XHOLD","XTRZM","XGIDA","XILTM"] },
      { name: "period", type: "query", default: "1ay" },
    ]},
    { method: "GET", path: "/market/index/{symbol}/info", desc: "Endeks Bilgileri", params: [
      { name: "symbol", type: "path", default: "XU100" },
    ]},
    { method: "GET", path: "/market/search", desc: "Sembol Arama", params: [
      { name: "q", type: "query", default: "THYAO" },
    ]},
    { method: "GET", path: "/market/companies/all", desc: "Tum BIST Sirketleri" },
    { method: "GET", path: "/market/tweets/{ticker}", desc: "Twitter/X", params: [
      { name: "ticker", type: "path", default: "AEFES" },
      { name: "limit", type: "query", default: "10" },
    ]},
    { method: "GET", path: "/market/snapshot", desc: "Anlik Fiyat Snapshot", params: [
      { name: "symbols", type: "query", default: "AEFES,THYAO,GARAN" },
    ]},
  ],
  financials: [
    { method: "GET", path: "/financials", desc: "Finansal Tablolar (DB)", params: [
      { name: "ticker", type: "query", default: "AEFES" },
      { name: "statement_type", type: "query", default: "", options: ["", "balance_sheet", "income_stmt", "cash_flow"] },
    ]},
    { method: "GET", path: "/financials/ratios", desc: "Finansal Oranlar (DB)", params: [
      { name: "ticker", type: "query", default: "AEFES" },
    ]},
  ],
  events: [
    { method: "GET", path: "/events/latest", desc: "Son 10 Olay" },
    { method: "GET", path: "/events", desc: "Olay Listesi (Filtreli)", params: [
      { name: "limit", type: "query", default: "20" },
      { name: "source_code", type: "query", default: "" },
    ]},
    { method: "GET", path: "/prices/latest", desc: "Son Fiyat", params: [
      { name: "ticker", type: "query", default: "AEFES" },
    ]},
    { method: "GET", path: "/prices", desc: "Fiyat Gecmisi", params: [
      { name: "ticker", type: "query", default: "AEFES" },
      { name: "limit", type: "query", default: "30" },
    ]},
    { method: "GET", path: "/companies", desc: "Kayitli Sirketler" },
    { method: "GET", path: "/sources", desc: "Veri Kaynaklari" },
    { method: "GET", path: "/polling-state", desc: "Polling Durumu" },
    { method: "GET", path: "/notifications", desc: "Bildirimler" },
    { method: "GET", path: "/outbox", desc: "Outbox Durumu" },
  ],
};

// === STATE ===
const state = {
  results: {},
  activeSection: "overview",
};

// === JSON SYNTAX HIGHLIGHTER ===
function highlightJSON(json) {
  if (typeof json !== "string") json = JSON.stringify(json, null, 2);
  return json
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="key">"$1"</span>')
    .replace(/:\s*"([^"]*?)"/g, ': <span class="str">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="num">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="bool">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="null">$1</span>');
}

// === URL BUILDER ===
function buildURL(endpoint, panelId) {
  let path = endpoint.path;
  const queryParams = [];

  if (endpoint.params) {
    for (const p of endpoint.params) {
      const input = document.getElementById(`${panelId}-${p.name}`);
      const val = input ? input.value : p.default;
      if (p.type === "path") {
        path = path.replace(`{${p.name}}`, encodeURIComponent(val));
      } else if (val && val.trim()) {
        queryParams.push(`${p.name}=${encodeURIComponent(val)}`);
      }
    }
  }

  const qs = queryParams.length > 0 ? "?" + queryParams.join("&") : "";
  return API_BASE + path + qs;
}

// === API CALLER ===
async function callEndpoint(endpoint, panelId) {
  const panel = document.getElementById(panelId);
  const badge = panel.querySelector(".status-badge");
  const metaEl = panel.querySelector(".response-meta");
  const bodyEl = panel.querySelector(".response-body");

  badge.className = "status-badge loading";
  badge.textContent = "loading...";
  metaEl.innerHTML = '<span class="spinner"></span>';
  bodyEl.innerHTML = "";

  const url = buildURL(endpoint, panelId);
  const startMs = performance.now();

  try {
    const resp = await fetch(url);
    const elapsed = Math.round(performance.now() - startMs);
    const data = await resp.json();

    const isOk = resp.ok && !data.error;
    badge.className = `status-badge ${isOk ? "success" : "error"}`;
    badge.textContent = isOk ? `${resp.status} OK` : `${resp.status} ERR`;

    const statusClass = resp.ok ? "ok" : "err";
    metaEl.innerHTML = `
      <span class="status-code ${statusClass}">${resp.status} ${resp.statusText}</span>
      <span class="ms">${elapsed}ms</span>
      <span>${url.replace(API_BASE, "")}</span>
    `;
    bodyEl.innerHTML = highlightJSON(data);

    state.results[panelId] = { ok: isOk, status: resp.status, ms: elapsed, data };
  } catch (err) {
    const elapsed = Math.round(performance.now() - startMs);
    badge.className = "status-badge error";
    badge.textContent = "FAIL";
    metaEl.innerHTML = `<span class="status-code err">Network Error</span> <span class="ms">${elapsed}ms</span>`;
    bodyEl.textContent = err.message;
    state.results[panelId] = { ok: false, status: 0, ms: elapsed, error: err.message };
  }

  updateSummary();
}

// === RUN ALL IN SECTION ===
async function runAllInSection(sectionName) {
  const endpoints = ENDPOINTS[sectionName];
  if (!endpoints) return;

  const progressBar = document.querySelector(`#section-${sectionName} .progress-bar`);
  if (progressBar) progressBar.style.width = "0%";

  for (let i = 0; i < endpoints.length; i++) {
    const panelId = `panel-${sectionName}-${i}`;
    const panel = document.getElementById(panelId);
    if (!panel.classList.contains("open")) {
      panel.classList.add("open");
    }
    await callEndpoint(endpoints[i], panelId);
    if (progressBar) {
      progressBar.style.width = `${Math.round(((i + 1) / endpoints.length) * 100)}%`;
    }
  }
}

// === RUN ALL TESTS ===
async function runAllTests() {
  const allBtn = document.getElementById("btn-run-all");
  allBtn.disabled = true;
  allBtn.textContent = "Calisiyor...";

  for (const section of Object.keys(ENDPOINTS)) {
    switchSection(section);
    await runAllInSection(section);
  }

  allBtn.disabled = false;
  allBtn.textContent = "Tum Testleri Calistir";
  updateSummary();
}

// === UPDATE SUMMARY ===
function updateSummary() {
  const total = Object.keys(state.results).length;
  const passed = Object.values(state.results).filter(r => r.ok).length;
  const failed = total - passed;

  const el = document.getElementById("global-summary");
  if (el) {
    el.innerHTML = `
      <div class="test-summary-item"><div class="test-dot pass"></div> ${passed} Basarili</div>
      <div class="test-summary-item"><div class="test-dot fail"></div> ${failed} Basarisiz</div>
      <div class="test-summary-item"><div class="test-dot pending"></div> ${countTotal() - total} Bekliyor</div>
    `;
  }
}

function countTotal() {
  let n = 0;
  for (const eps of Object.values(ENDPOINTS)) n += eps.length;
  return n;
}

// === NAV ===
function switchSection(name) {
  state.activeSection = name;
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const section = document.getElementById(`section-${name}`);
  const nav = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (section) section.classList.add("active");
  if (nav) nav.classList.add("active");
}

// === TOGGLE PANEL ===
function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  panel.classList.toggle("open");
}

// === BUILD PARAM INPUTS ===
function buildParamInputs(endpoint, panelId) {
  if (!endpoint.params || endpoint.params.length === 0) return "";

  let html = '<div class="param-row">';
  for (const p of endpoint.params) {
    const inputId = `${panelId}-${p.name}`;
    if (p.options) {
      const opts = p.options.map(o =>
        `<option value="${o}" ${o === p.default ? "selected" : ""}>${o}</option>`
      ).join("");
      html += `
        <div class="param-group">
          <label>${p.name}</label>
          <select id="${inputId}">${opts}</select>
        </div>`;
    } else {
      html += `
        <div class="param-group">
          <label>${p.name}</label>
          <input id="${inputId}" value="${p.default}" placeholder="${p.name}" />
        </div>`;
    }
  }
  html += `</div>`;
  return html;
}

// === RENDER ===
function renderEndpointPanel(endpoint, sectionName, index) {
  const panelId = `panel-${sectionName}-${index}`;
  const methodClass = endpoint.method === "POST" ? "post" : "";

  return `
    <div class="test-panel" id="${panelId}">
      <div class="test-panel-header" onclick="togglePanel('${panelId}')">
        <div class="test-panel-title">
          <span class="method ${methodClass}">${endpoint.method}</span>
          <span class="path">${endpoint.path}</span>
          <span class="desc">${endpoint.desc}</span>
        </div>
        <div class="test-panel-status">
          <span class="status-badge idle">idle</span>
          <span class="toggle-arrow">&#9654;</span>
        </div>
      </div>
      <div class="test-panel-body">
        ${buildParamInputs(endpoint, panelId)}
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); callEndpoint(ENDPOINTS['${sectionName}'][${index}], '${panelId}')">
          Calistir
        </button>
        <div class="response-container">
          <div class="response-meta"></div>
          <div class="response-body"></div>
        </div>
      </div>
    </div>
  `;
}

function renderSection(name, title, description, icon) {
  const endpoints = ENDPOINTS[name];
  const panels = endpoints.map((ep, i) => renderEndpointPanel(ep, name, i)).join("");

  return `
    <div class="section" id="section-${name}">
      <div class="page-header">
        <h2>${icon} ${title}</h2>
        <p>${description}</p>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="test-summary" id="summary-${name}"></div>
        <button class="btn btn-primary" onclick="runAllInSection('${name}')">
          Hepsini Calistir (${endpoints.length})
        </button>
      </div>
      <div class="progress-bar-container"><div class="progress-bar"></div></div>
      ${panels}
    </div>
  `;
}

function init() {
  const main = document.getElementById("main-content");

  main.innerHTML = `
    ${renderSection("overview", "Genel Bakis", "Sistem durumu ve istatistikler", "")}
    ${renderSection("technical", "Teknik Analiz", "RSI, MACD, Bollinger, SMA, EMA, SuperTrend, Stochastic, sinyaller", "")}
    ${renderSection("fundamentals", "Temel Analiz", "Sirket bilgileri, finansallar, temettu, ortaklik, analist tavsiyeleri", "")}
    ${renderSection("financials", "Finansal Tablolar", "DB'deki finansal tablolar ve hesaplanmis oranlar (ROE, ROA, margin vb.)", "")}
    ${renderSection("macro", "Makro Ekonomi", "TCMB faiz, enflasyon, doviz kurlari, ekonomik takvim", "")}
    ${renderSection("market", "Piyasa Verileri", "Hisse tarama, sinyal tarama, endeksler, arama, Twitter, snapshot", "")}
    ${renderSection("events", "Olaylar & Veriler", "KAP bildirimleri, fiyatlar, bildirimler, polling durumu", "")}
  `;

  // Nav click handlers
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => switchSection(item.dataset.section));
  });

  // Run all button
  document.getElementById("btn-run-all").addEventListener("click", runAllTests);

  switchSection("overview");
  updateSummary();
}

document.addEventListener("DOMContentLoaded", init);
