// === API Client — Hisse Analizi Dashboard ===

const API = {
  base: window.location.origin,

  async get(path, params) {
    const url = new URL(this.base + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, v);
        }
      });
    }
    try {
      const resp = await fetch(url.toString());
      if (!resp.ok) {
        console.warn(`API ${resp.status}: ${path}`);
        return null;
      }
      return await resp.json();
    } catch (err) {
      console.error(`API error: ${path}`, err);
      return null;
    }
  },

  // Health & Stats
  health() { return this.get("/health"); },
  stats() { return this.get("/admin/stats"); },

  // Companies
  companies() { return this.get("/companies"); },
  company(ticker) { return this.get(`/companies/${ticker}`); },

  // Events
  events(params) { return this.get("/events", params); },
  eventsLatest() { return this.get("/events/latest"); },

  // Prices
  prices(params) { return this.get("/prices", params); },
  pricesLatest(ticker) { return this.get("/prices/latest", { ticker }); },

  // Financials (DB)
  financials(ticker, type) { return this.get("/financials", { ticker, statement_type: type }); },
  financialRatios(ticker) { return this.get("/financials/ratios", { ticker }); },

  // Technical
  rsi(ticker, period) { return this.get(`/technical/${ticker}/rsi`, { period }); },
  macd(ticker) { return this.get(`/technical/${ticker}/macd`); },
  bollinger(ticker, period) { return this.get(`/technical/${ticker}/bollinger`, { period }); },
  signals(ticker) { return this.get(`/technical/${ticker}/signals`); },
  signalsAllTimeframes(ticker) { return this.get(`/technical/${ticker}/signals/all-timeframes`); },

  // Fundamentals
  companyInfo(ticker) { return this.get(`/fundamentals/${ticker}/info`); },
  fastInfo(ticker) { return this.get(`/fundamentals/${ticker}/fast-info`); },
  balanceSheet(ticker, quarterly) { return this.get(`/fundamentals/${ticker}/balance-sheet`, { quarterly }); },
  incomeStatement(ticker, quarterly) { return this.get(`/fundamentals/${ticker}/income-statement`, { quarterly }); },
  cashflow(ticker, quarterly) { return this.get(`/fundamentals/${ticker}/cashflow`, { quarterly }); },
  dividends(ticker) { return this.get(`/fundamentals/${ticker}/dividends`); },
  holders(ticker) { return this.get(`/fundamentals/${ticker}/holders`); },
  recommendations(ticker) { return this.get(`/fundamentals/${ticker}/recommendations`); },

  // Macro
  tcmb() { return this.get("/macro/tcmb"); },
  policyRate() { return this.get("/macro/policy-rate"); },
  inflation() { return this.get("/macro/inflation"); },
  fx(currency) { return this.get(`/macro/fx/${currency}`); },

  // Market
  screener(params) { return this.get("/market/screener", params); },
  screenerTemplates() { return this.get("/market/screener/templates"); },
  scanner(params) { return this.get("/market/scanner", params); },
  indices() { return this.get("/market/indices"); },
  index(symbol, period) { return this.get(`/market/index/${symbol}`, { period }); },
  snapshot(symbols) { return this.get("/market/snapshot", { symbols }); },
  search(q) { return this.get("/market/search", { q }); },

  // Polling
  pollingState() { return this.get("/polling-state"); },
};
