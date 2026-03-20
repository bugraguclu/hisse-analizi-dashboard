// === App Router & Init ===

const App = {
  currentPage: "overview",

  pages: {
    overview: () => Pages.overview(),
    stocks: () => Pages.stocks(),
    detail: (param) => Pages.detail(param),
    screener: () => Pages.screener(),
    news: () => Pages.news(),
  },

  navigate(page, param) {
    this.currentPage = page;

    // Update nav
    document.querySelectorAll(".nav-link").forEach(link => {
      link.classList.toggle("active", link.dataset.page === page);
    });

    // Update hash
    const hash = param ? `#${page}/${param}` : `#${page}`;
    if (window.location.hash !== hash) {
      history.pushState(null, "", hash);
    }

    // Render page
    const renderer = this.pages[page];
    if (renderer) {
      renderer(param);
    }
  },

  parseHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return { page: "overview", param: null };

    const parts = hash.split("/");
    return { page: parts[0] || "overview", param: parts[1] || null };
  },

  init() {
    // Nav click handlers
    document.querySelectorAll(".nav-link[data-page]").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        App.navigate(link.dataset.page);
      });
    });

    // Hash change
    window.addEventListener("hashchange", () => {
      const { page, param } = App.parseHash();
      App.navigate(page, param);
    });

    // Initial load
    const { page, param } = this.parseHash();
    this.navigate(page, param);
  },
};

// Boot
document.addEventListener("DOMContentLoaded", () => App.init());
